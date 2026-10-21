import { useState } from 'preact/hooks';

import { api } from '../api';
import { MatchForm, blankMatch } from '../components/MatchForm';
import { formatDate, matchDate, ratingHistory, shortName, wtnAfter } from '../data';
import { UpcomingCard } from '../components/Upcoming';
import { forOwner } from '../photos';
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

export function Matches({ data, upcomingTab = false, upsetsOnly = false, person = '', role, selectedId = '', onPhotos, onMatches }: { data: Data; upcomingTab?: boolean; upsetsOnly?: boolean; person?: string; role?: 'partner' | 'opponent'; selectedId?: string; onPhotos?: () => Promise<void>; onMatches?: <T>(change: () => Promise<T>) => Promise<T> }) {
  const [query, setQuery] = useState('');
  const [event, setEvent] = useState('');
  const [logging, setLogging] = useState(false);
  const points = ratingHistory(data.ratings, data.matches);
  const q = query.trim().toLowerCase();
  const events = new Map<string, { count: number; latest: string }>();
  for (const m of data.matches) {
    const e = events.get(m.event);
    events.set(m.event, { count: (e?.count ?? 0) + 1, latest: e && e.latest > matchDate(m) ? e.latest : matchDate(m) });
  }
  const tournaments = [...events].sort((a, b) => b[1].latest.localeCompare(a[1].latest));
  const shown = data.matches.filter(
    (m) => (!upsetsOnly || m.upsetGap !== null) && (!event || m.event === event) && (!person || (m.kind === 'DOUBLE' && m.won !== null && (role === 'partner' ? m.partners : role === 'opponent' ? m.opponents : [...m.partners, ...m.opponents]).some((p) => shortName(p.name) === person))) && (!q || [m.event, ...m.partners.map((p) => p.name), ...m.opponents.map((p) => p.name)].some((s) => s.toLowerCase().includes(q))),
  );
  let year = '';

  return (
    <main class="screen">
      {(upsetsOnly || person) && (
        <a class="back" href={person ? '#/stats' : '#/'}>
          {person ? '‹ Stats' : '‹ Home'}
        </a>
      )}
      <h1 class="title">{upsetsOnly ? 'Upset wins' : person || 'Matches'}</h1>
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
      {onMatches && !upsetsOnly && !person &&
        (logging ? (
          <MatchForm
            initial={blankMatch()}
            onCancel={() => setLogging(false)}
            onSave={async (m) => {
              const { id } = await onMatches(() => api.addMatch(m));
              location.hash = `#/match/${encodeURIComponent(id)}`; // add photos and a note there
            }}
          />
        ) : (
          <button class="button" type="button" onClick={() => setLogging(true)}>
            + Log match
          </button>
        ))}
      <label>
        <span class="sr-only">Search</span>
        <input type="search" placeholder="Search partner, opponent, event" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      </label>
      <label>
        <span class="sr-only">Tournament</span>
        <select value={event} onChange={(e) => setEvent(e.currentTarget.value)}>
          <option value="">All tournaments</option>
          {tournaments.map(([name, t]) => (
            <option value={name}>
              {name} ({t.count})
            </option>
          ))}
        </select>
      </label>
      {shown.length === 0 && <p class="muted">{upsetsOnly && !q && !event ? 'No upset wins yet.' : `No matches${q || event ? ' match your filter' : ' yet'}.`}</p>}
      {shown.map((m) => {
        const y = matchDate(m).slice(0, 4);
        const header = y !== year ? <h2 class="year">{(year = y)}</h2> : null;
        const after = wtnAfter(points, m);
        const cover = forOwner(data.photos, `match:${m.id}`)[0];
        return (
          <>
            {header}
            <a class="match" href={matchHref(m)} aria-current={m.id === selectedId ? 'true' : undefined}>
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
              {cover && (
                <span class="match-photo">
                  <img src={cover.thumb ?? cover.url} style={{ objectPosition: `50% ${cover.focus}%` }} alt="" loading="lazy" onError={() => onPhotos?.()} />
                </span>
              )}
            </a>
          </>
        );
      })}
        </>
      )}
    </main>
  );
}
