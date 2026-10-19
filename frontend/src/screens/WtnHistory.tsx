import { Trend } from '../components/Charts';
import { formatDate, latest, matchesBehind, matchDate, ratingHistory, shortName } from '../data';
import type { Data, Match } from '../types';
import { matchHref } from './Matches';

function MatchLine({ m }: { m: Match }) {
  const vs = m.opponents.map((o) => shortName(o.name)).join(' & ');
  return (
    <a class="item" href={matchHref(m)} style={{ minHeight: '40px', paddingLeft: '28px' }}>
      <strong style={{ color: m.won ? 'var(--win-text)' : 'var(--loss-text)' }}>{m.won ? 'W' : 'L'}</strong>
      <span class="grow muted">
        {m.score}{vs ? ` · vs ${vs}` : ''}
      </span>
      <span class="muted">{formatDate(matchDate(m))}</span>
    </a>
  );
}

/** Every doubles WTN reading, newest first, with the change from the reading before. */
export function WtnHistory({ data }: { data: Data }) {
  const points = ratingHistory(data.ratings, data.matches);
  const now = latest(points);
  const best = points.length ? Math.min(...points.map((p) => p.value)) : null;
  const { byDate, pending } = matchesBehind(points, data.matches);
  let year = '';

  return (
    <main class="screen">
      <a class="back" href="#/">
        ‹ Home
      </a>
      <h1 class="title">WTN history</h1>
      {now && best !== null ? (
        <a class="hero" href="#/" aria-label="World Tennis Number, tap to close history">
          <span class="eyebrow">World Tennis Number · Doubles</span>
          <div class="row" style={{ justifyContent: 'space-between' }}>
            <span class="hero-value">{now.point.value.toFixed(2)}</span>
            <span class="muted" style={{ textAlign: 'right' }}>
              Best {best.toFixed(2)}
              <br />
              Start {points[0]?.value.toFixed(2)}
            </span>
          </div>
          <Trend points={points} />
        </a>
      ) : (
        <p class="muted">No WTN yet. It appears after the first sync.</p>
      )}
      {pending.length > 0 && (
        <div class="list">
          <div class="item eyebrow" style={{ minHeight: '40px' }}>Not in your rating yet</div>
          {pending.map((m) => (
            <MatchLine key={m.id} m={m} />
          ))}
        </div>
      )}
      <div class="list">
        {points
          .map((p, i) => ({ p, change: i > 0 ? Math.round(((points[i - 1]?.value ?? p.value) - p.value) * 100) / 100 : 0 }))
          .reverse()
          .map(({ p, change }) => {
            const y = p.date.slice(0, 4);
            const header = y !== year ? <h2 class="year">{(year = y)}</h2> : null;
            return (
              <>
                {header}
                <div class="item">
                  <span class="grow">{formatDate(p.date)}</span>
                  <span class="muted">{change === 0 ? '' : change > 0 ? `▼ ${change.toFixed(2)}` : `▲ ${Math.abs(change).toFixed(2)}`}</span>
                  <strong class="num">{p.value.toFixed(2)}</strong>
                </div>
                {(byDate.get(p.date) ?? []).map((m) => (
                  <MatchLine key={m.id} m={m} />
                ))}
              </>
            );
          })}
      </div>
    </main>
  );
}
