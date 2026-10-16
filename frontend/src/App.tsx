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
  const [profile, ratings, matches] = await Promise.all([api.profile(), api.ratings(), api.matches()]);
  return { profile, ratings, matches };
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
    setState({ kind: 'ready', data: { ...data, matches: data.matches.map((m) => (m.id === id ? { ...m, ...saved } : m)) } });
  };
  const detailId = hash.match(/^#\/match\/(.+)$/)?.[1];
  const screen = detailId ? (
    <MatchDetail key={detailId} data={data} id={decodeURIComponent(detailId)} onSave={onSave} />
  ) : hash === '#/matches' ? (
    <Matches data={data} />
  ) : hash === '#/me' ? (
    <Me data={data} />
  ) : (
    <Home data={data} />
  );
  return (
    <div class="page">
      {screen}
      <TabBar active={detailId ? '#/matches' : ['#/matches', '#/me'].includes(hash) ? hash : '#/'} />
    </div>
  );
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
