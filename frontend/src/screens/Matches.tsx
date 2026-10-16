import { useState } from 'preact/hooks';

import { formatDate, matchDate, ratingHistory, shortName, wtnAfter } from '../data';
import { UpcomingCard } from '../components/Upcoming';
import type { Data, Match } from '../types';

const result = (m: Match) => (m.won === true ? 'W' : m.won === false ? 'L' : 'N');
const names = (players: Match['partners']) => players.map((p) => shortName(p.name)).join(' / ');
export const matchHref = (m: Match) => `#/match/${encodeURIComponent(m.id)}`;

/** Result badge, event, date line and score: shared by Home's rows and the Matches cards. */
function MatchHeader({ m, detail }: { m: Match; detail: string }) {
  return (
    <>
      <span class={`badge ${result(m)}`}>{result(m) === 'N' ? '–' : result(m)}</span>
      <div class="grow">
        <div class="ellipsis" style={{ fontWeight: 700 }}>
          {m.event}
        </div>
        <div class="muted" style={{ fontSize: '13px' }}>
          {detail}
        </div>
      </div>
      <span class="score">{m.score}</span>
    </>
  );
}

/** Compact row for Home's recent results. */
export function MatchRow({ m }: { m: Match }) {
  return (
    <a class="item" href={matchHref(m)}>
      <MatchHeader m={m} detail={`${formatDate(matchDate(m))}${m.partners.length ? ` · w/ ${names(m.partners)}` : ''}`} />
    </a>
  );
}

export function Matches({ data, upcomingTab = false, upsetsOnly = false, filter = '' }: { data: Data; upcomingTab?: boolean; upsetsOnly?: boolean; filter?: string }) {
  const [query, setQuery] = useState(filter);
  const points = ratingHistory(data.ratings, data.matches);
  const q = query.trim().toLowerCase();
  const shown = data.matches.filter(
    (m) => (!upsetsOnly || m.upsetGap !== null) && (!q || [m.event, ...m.partners.map((p) => p.name), ...m.opponents.map((p) => p.name)].some((s) => s.toLowerCase().includes(q))),
  );
  let year = '';

  return (
    <main class="screen">
      {(upsetsOnly || filter) && (
        <a class="back" href={filter ? '#/stats' : '#/'}>
          {filter ? '‹ Stats' : '‹ Home'}
        </a>
      )}
      <h1 class="title">{upsetsOnly ? 'Upset wins' : 'Matches'}</h1>
      {!upsetsOnly && (
      <nav class="segmented" aria-label="Played or upcoming">
        <a href="#/matches" aria-current={upcomingTab ? undefined : 'page'}>
          Played · {data.matches.length}
        </a>
        <a href="#/upcoming" aria-current={upcomingTab ? 'page' : undefined}>
          Upcoming · {data.upcoming.length}
        </a>
      </nav>
      )}
      {upcomingTab ? (
        <>
          {data.upcoming.length === 0 && <p class="muted">Nothing coming up. Add matches to your Tennis calendar, and connect it under Me.</p>}
          {data.upcoming.map((u) => (
            <UpcomingCard u={u} />
          ))}
        </>
      ) : (
        <>
      <label>
        <span class="sr-only">Search</span>
        <input type="search" placeholder="Search partner, opponent, event" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      </label>
      {shown.length === 0 && <p class="muted">{upsetsOnly && !q ? 'No upset wins yet.' : `No matches${q ? ' match your search' : ' yet'}.`}</p>}
      {shown.map((m) => {
        const y = matchDate(m).slice(0, 4);
        const header = y !== year ? <h2 class="year">{(year = y)}</h2> : null;
        const after = wtnAfter(points, m);
        return (
          <>
            {header}
            <a class="match" href={matchHref(m)}>
              <div class="row" style={{ gap: '10px' }}>
                <MatchHeader m={m} detail={formatDate(matchDate(m))} />
              </div>
              <span style={{ fontSize: '14px', color: '#c9d2cc' }}>
                {m.partners.length ? `w/ ${names(m.partners)} · ` : ''}vs {m.opponents.length ? names(m.opponents) : 'default'}
              </span>
              <div class="row" style={{ gap: '8px', fontSize: '13px' }}>
                {after !== null && (
                  <span class="muted">
                    WTN after <strong style={{ color: 'var(--text)' }}>{after.toFixed(2)}</strong>
                  </span>
                )}
                {m.upsetGap !== null && <span class="pill">Upset win</span>}
                {m.starred && <span aria-label="Best match">★</span>}
                {m.note && <span class="muted">· note</span>}
              </div>
            </a>
          </>
        );
      })}
        </>
      )}
    </main>
  );
}
