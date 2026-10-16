import { useState } from 'preact/hooks';

import { formatDate, matchDate, ratingHistory, shortName, wtnAfter } from '../data';
import type { Data, Match } from '../types';

const result = (m: Match) => (m.won === true ? 'W' : m.won === false ? 'L' : 'N');
const names = (players: Match['partners']) => players.map((p) => shortName(p.name)).join(' / ');
export const matchHref = (m: Match) => `#/match/${encodeURIComponent(m.id)}`;

/** Compact row for Home's recent results. */
export function MatchRow({ m }: { m: Match }) {
  return (
    <a class="item" href={matchHref(m)}>
      <span class={`badge ${result(m)}`}>{result(m) === 'N' ? '–' : result(m)}</span>
      <div class="grow">
        <div class="ellipsis" style={{ fontWeight: 600 }}>
          {m.event}
        </div>
        <div class="muted" style={{ fontSize: '13px' }}>
          {formatDate(matchDate(m))}
          {m.partners.length ? ` · w/ ${names(m.partners)}` : ''}
        </div>
      </div>
      <span class="score">{m.score}</span>
    </a>
  );
}

export function Matches({ data }: { data: Data }) {
  const [query, setQuery] = useState('');
  const points = ratingHistory(data.ratings, data.matches);
  const q = query.trim().toLowerCase();
  const shown = data.matches.filter(
    (m) => !q || [m.event, ...m.partners.map((p) => p.name), ...m.opponents.map((p) => p.name)].some((s) => s.toLowerCase().includes(q)),
  );
  let year = '';

  return (
    <main class="screen">
      <h1 class="title">Matches</h1>
      <label>
        <span class="sr-only">Search</span>
        <input type="search" placeholder="Search partner, opponent, event" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      </label>
      {shown.length === 0 && <p class="muted">No matches{q ? ' match your search' : ' yet'}.</p>}
      {shown.map((m) => {
        const y = matchDate(m).slice(0, 4);
        const header = y !== year ? <h2 class="year">{(year = y)}</h2> : null;
        const after = wtnAfter(points, m);
        return (
          <>
            {header}
            <a class="match" href={matchHref(m)}>
              <div class="row" style={{ gap: '10px' }}>
                <span class={`badge ${result(m)}`}>{result(m) === 'N' ? '–' : result(m)}</span>
                <div class="grow">
                  <div class="ellipsis" style={{ fontWeight: 700 }}>
                    {m.event}
                  </div>
                  <div class="muted" style={{ fontSize: '13px' }}>
                    {formatDate(matchDate(m))}
                  </div>
                </div>
                <span class="score">{m.score}</span>
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
    </main>
  );
}
