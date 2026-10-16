import { useEffect, useState } from 'preact/hooks';

import { api, initApi } from './api';
import { initAuth } from './auth';
import { TabBar } from './components/TabBar';
import { loadConfig } from './config';
import { Home } from './screens/Home';
import { MatchDetail } from './screens/MatchDetail';
import { Matches } from './screens/Matches';
import { Me } from './screens/Me';
import type { Data } from './types';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: Data };

const useHash = () => {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const onChange = () => {
      setHash(location.hash || '#/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
};

// Dev only (`npm run dev`, then /?mock): made-up data, no sign-in. Removed from production builds.
const isMock = () => import.meta.env.DEV && new URLSearchParams(location.search).has('mock');

async function loadData(): Promise<Data | null> {
  if (import.meta.env.DEV && isMock()) {
    return (await import('./mock')).mockData;
  }
  const config = await loadConfig();
  if (!(await initAuth(config))) return null; // redirecting to sign-in
  initApi(config);
  const [profile, ratings, matches, upcoming] = await Promise.all([api.profile(), api.ratings(), api.matches(), api.upcoming()]);
  return { profile, ratings, matches, upcoming, vapidKey: config.vapidPublicKey ?? '' };
}

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const hash = useHash();

  useEffect(() => {
    loadData()
      .then((data) => data && setState({ kind: 'ready', data }))
      .catch((e: Error) => setState({ kind: 'error', message: e.message }));
  }, []);

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
  const detailId = hash.match(/^#\/match\/(.+)$/)?.[1];
  const screen = detailId ? (
    <MatchDetail key={detailId} data={data} id={safeDecode(detailId)} onSave={onSave} />
  ) : hash === '#/matches' ? (
    <Matches data={data} />
  ) : hash === '#/upcoming' ? (
    <Matches data={data} upcomingTab />
  ) : hash === '#/me' ? (
    <Me data={data} onCalendar={onCalendar} />
  ) : (
    <Home data={data} />
  );
  return (
    <div class="page">
      {screen}
      <TabBar active={detailId ? '#/matches' : hash === '#/upcoming' ? '#/matches' : ['#/matches', '#/me'].includes(hash) ? hash : '#/'} />
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
