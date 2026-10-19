import { useEffect, useRef, useState } from 'preact/hooks';

import { api, initApi } from './api';
import { initAuth } from './auth';
import { TabBar } from './components/TabBar';
import { loadConfig } from './config';
import { isMock } from './env';
import { Home } from './screens/Home';
import { MatchDetail } from './screens/MatchDetail';
import { Matches } from './screens/Matches';
import { Me } from './screens/Me';
import { Stats } from './screens/Stats';
import { WtnHistory } from './screens/WtnHistory';
import type { Data } from './types';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: Data };

const useHash = () => {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const onChange = () => {
      setHash(location.hash || '#/');
      // Picking a match from the list beside it (wide window) keeps the list where it is.
      if (!(location.hash.startsWith('#/match/') && window.matchMedia('(min-width: 1100px)').matches)) window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
};

/** True on a desktop-width window: Matches then shows the list and the selected match side by side. */
const useWide = () => {
  const query = '(min-width: 1100px)';
  const [wide, setWide] = useState(window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide;
};

/** The match shown beside the list on a wide window: the opened one, else the newest. */
export function splitMatchId(hash: string, matches: { id: string }[]): string | null {
  const opened = hash.match(/^#\/match\/(.+)$/)?.[1];
  if (opened) return safeDecode(opened);
  return hash === '#/matches' ? (matches[0]?.id ?? null) : null;
}

async function loadData(): Promise<Data | null> {
  if (import.meta.env.DEV && isMock()) {
    return (await import('./mock')).mockData;
  }
  const config = await loadConfig();
  if (!(await initAuth(config))) return null; // redirecting to sign-in
  initApi(config);
  return { ...(await fetchAll()), vapidKey: config.vapidPublicKey ?? '' };
}

async function fetchAll(): Promise<Omit<Data, 'vapidKey'>> {
  const [profile, ratings, matches, upcoming, trophies, photos] = await Promise.all([
    api.profile(),
    api.ratings(),
    api.matches(),
    api.upcoming(),
    api.trophies().catch(() => ({ trophies: [], suggestions: [] })),
    api.photos().catch(() => []),
  ]);
  return { profile, ratings, matches, upcoming, trophies, photos };
}

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const hash = useHash();
  const wide = useWide();

  useEffect(() => {
    loadData()
      .then((data) => data && (setLoadedAt(Date.now()), setState({ kind: 'ready', data })))
      .catch((e: Error) => setState({ kind: 'error', message: e.message }));
  }, []);

  // Photo links last 15 minutes: refresh when you come back to the app and every 10 minutes while it is open.
  const photosAt = useRef(Date.now()); // last successful fetch
  const errorAt = useRef(0); // last refresh caused by a broken image
  const loadPhotos = async () => {
    const photos = await api.photos().catch(() => null); // a failed reload keeps the current list
    if (!photos) return;
    photosAt.current = Date.now();
    setState((prev) => (prev.kind === 'ready' ? { kind: 'ready', data: { ...prev.data, photos } } : prev));
  };
  const ready = state.kind === 'ready';
  // Reload everything (Home's Refresh button, and when you come back to the app after 5 minutes).
  const refresh = async () => {
    if (!isMock()) {
      const fresh = await fetchAll();
      setState((prev) => (prev.kind === 'ready' ? { kind: 'ready', data: { ...fresh, vapidKey: prev.data.vapidKey } } : prev));
    }
    setLoadedAt(Date.now());
  };
  const loadedRef = useRef(loadedAt);
  loadedRef.current = loadedAt;
  useEffect(() => {
    const onBack = () => document.visibilityState === 'visible' && Date.now() - loadedRef.current > 5 * 60_000 && void refresh().catch(() => undefined);
    if (ready && !isMock()) document.addEventListener('visibilitychange', onBack);
    return () => document.removeEventListener('visibilitychange', onBack);
  }, [ready]);
  useEffect(() => {
    if (!ready || isMock()) return;
    const visible = () => document.visibilityState === 'visible';
    const onVisible = () => visible() && Date.now() - photosAt.current > 60_000 && void loadPhotos();
    const timer = setInterval(() => visible() && void loadPhotos(), 10 * 60_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready]);

  if (state.kind === 'loading') return <Centered>Loading…</Centered>;
  if (state.kind === 'error')
    return (
      <Centered>
        <p>{state.message}</p>
        <button class="button" type="button" onClick={() => location.assign('/')}>
          Try again
        </button>
      </Centered>
    );

  const { data } = state;
  const onSave = async (id: string, note: string, starred: boolean) => {
    const saved = import.meta.env.DEV && isMock() ? { note, starred } : await api.saveExtras(id, note, starred);
    // From the latest state, so two quick saves (star + note) don't overwrite each other.
    setState((prev) =>
      prev.kind === 'ready' ? { kind: 'ready', data: { ...prev.data, matches: prev.data.matches.map((m) => (m.id === id ? { ...m, ...saved } : m)) } } : prev,
    );
  };
  const onCalendar = async (url: string) => {
    const { connected } = import.meta.env.DEV && isMock() ? { connected: Boolean(url) } : await api.saveCalendar(url);
    // The server syncs right away; give it a moment, then refresh the list.
    await new Promise((resolve) => setTimeout(resolve, connected ? 3000 : 0));
    const [profile, upcoming] = import.meta.env.DEV && isMock() ? [data.profile, data.upcoming] : await Promise.all([api.profile(), api.upcoming()]);
    setState((prev) => (prev.kind === 'ready' ? { kind: 'ready', data: { ...prev.data, profile, upcoming } } : prev));
  };
  // WTN syncs in the background: poll until the sync time changes (up to 40 s), then reload ratings and matches.
  const onWtnSync = async () => {
    const before = data.profile.sync.lastRunAt;
    if (import.meta.env.DEV && isMock()) return true;
    await api.syncWtn();
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const profile = await api.profile().catch(() => null);
      if (!profile || profile.sync.lastRunAt === before) continue;
      const [ratings, matches] = await Promise.all([api.ratings(), api.matches()]);
      setState((prev) => (prev.kind === 'ready' ? { kind: 'ready', data: { ...prev.data, profile, ratings, matches } } : prev));
      return profile.sync.status === 'ok';
    }
    return false;
  };
  const onRatings = async (ratings: { utr: number | null; ntrp: number | null }) => {
    const saved = import.meta.env.DEV && isMock() ? ratings : await api.saveRatings(ratings);
    setState((prev) => (prev.kind === 'ready' ? { kind: 'ready', data: { ...prev.data, profile: { ...prev.data.profile, ...saved } } } : prev));
  };
  // Trophy changes can add, remove or hide suggestions, so reload the list from the server.
  const onTrophies = async (change: () => Promise<unknown>) => {
    await change();
    const trophies = await api.trophies().catch(() => null); // the save worked; don't report a failed reload as a failed save
    if (trophies) setState((prev) => (prev.kind === 'ready' ? { kind: 'ready', data: { ...prev.data, trophies } } : prev));
  };
  // Logging, editing or deleting a match reloads the list from the server.
  const onMatches = async <T,>(change: () => Promise<T>): Promise<T> => {
    const result = await change();
    const matches = await api.matches().catch(() => null);
    if (matches) setState((prev) => (prev.kind === 'ready' ? { kind: 'ready', data: { ...prev.data, matches } } : prev));
    return result;
  };
  // Photo changes reload the list; a failed image calls this with no change to get fresh links (at most once a minute).
  const onPhotos = async (change?: () => Promise<unknown>) => {
    if (isMock()) return;
    if (change) await change();
    else if (Date.now() - errorAt.current < 60_000) return;
    else errorAt.current = Date.now();
    await loadPhotos();
  };
  const withName = hash.match(/^#\/with\/(.+)$/)?.[1];
  const detailId = hash.match(/^#\/match\/(.+)$/)?.[1];
  const splitId = state.kind === 'ready' && wide ? splitMatchId(hash, state.data.matches) : null;
  const screen = splitId ? (
    <div class="split">
      <Matches data={data} selectedId={splitId} onPhotos={onPhotos} onMatches={onMatches} />
      <MatchDetail key={splitId} data={data} id={splitId} onSave={onSave} onPhotos={onPhotos} onMatches={onMatches} />
    </div>
  ) : detailId ? (
    <MatchDetail key={detailId} data={data} id={safeDecode(detailId)} onSave={onSave} onPhotos={onPhotos} onMatches={onMatches} />
  ) : withName ? (
    <Matches key={withName} data={data} person={safeDecode(withName)} onPhotos={onPhotos} />
  ) : hash === '#/stats' ? (
    <Stats data={data} />
  ) : hash === '#/matches' ? (
    <Matches data={data} onPhotos={onPhotos} onMatches={onMatches} />
  ) : hash === '#/upsets' ? (
    <Matches data={data} upsetsOnly onPhotos={onPhotos} />
  ) : hash === '#/upcoming' ? (
    <Matches data={data} upcomingTab />
  ) : hash === '#/wtn' ? (
    <WtnHistory data={data} />
  ) : hash === '#/me' ? (
    <Me data={data} onCalendar={onCalendar} onWtnSync={onWtnSync} onRatings={onRatings} onTrophies={onTrophies} onPhotos={onPhotos} />
  ) : (
    <Home data={data} loadedAt={loadedAt} onRefresh={refresh} />
  );
  return (
    <div class="page">
      {screen}
      <TabBar active={detailId || withName ? '#/matches' : hash === '#/stats' ? '#/' : hash === '#/upcoming' || hash === '#/upsets' ? '#/matches' : ['#/matches', '#/me'].includes(hash) ? hash : '#/'} />
    </div>
  );
}

/** A hand-edited or badly encoded link shows "Match not found" instead of a blank screen. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function Centered({ children }: { children: preact.ComponentChildren }) {
  return (
    <div class="page">
      <main class="center">
        <svg width="72" height="72" viewBox="0 0 96 96" aria-hidden="true">
          <circle cx="48" cy="48" r="44" fill="var(--accent)" />
          <path d="M14 30c16 6 22 22 18 40M82 30c-16 6-22 22-18 40" fill="none" stroke="var(--ground)" stroke-width="4" stroke-linecap="round" />
        </svg>
        {children}
      </main>
    </div>
  );
}
