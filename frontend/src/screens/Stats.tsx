import { useState } from 'preact/hooks';

import { byYear, playedDoubles, record, shortName, tally, winPct } from '../data';
import type { Tally } from '../data';
import type { Data } from '../types';

const MIN = 2;

function People({ title, rows }: { title: string; rows: Tally[] }) {
  const [all, setAll] = useState(false);
  const frequent = rows.filter((r) => r.wins + r.losses >= MIN);
  const shown = all ? rows : frequent;
  return (
    <section class="card">
      <div class="eyebrow">
        {title}
        {all ? '' : ` · ${MIN}+ matches`}
      </div>
      {rows.length === 0 && <p class="muted">None yet.</p>}
      {shown.map((r) => (
        <a key={r.name} class="stat-row" href={`#/with/${encodeURIComponent(r.name)}`}>
          <span class="grow">
            {shortName(r.name)}
            <span class="bar">
              <i style={{ width: `${winPct(r)}%` }} />
            </span>
          </span>
          <span class="num" style={{ fontSize: '20px' }}>
            {r.wins}–{r.losses}
          </span>
          <span class="muted" aria-hidden="true">
            ›
          </span>
        </a>
      ))}
      {rows.length > frequent.length && (
        <button class="link-button" type="button" onClick={() => setAll(!all)}>
          {all ? `Only ${MIN}+ matches` : `Show all (${rows.length})`}
        </button>
      )}
    </section>
  );
}

export function Stats({ data }: { data: Data }) {
  const played = playedDoubles(data.matches);
  const total = record(played);
  const years = byYear(played);
  return (
    <main class="screen">
      <a class="back" href="#/">
        ‹ Home
      </a>
      <h1 class="title">Stats</h1>
      <div class="eyebrow">Doubles</div>
      <section class="card">
        <div class="eyebrow">Overall</div>
        <div class="num" style={{ fontSize: '56px', lineHeight: 1 }}>
          {winPct(total)}% <span class="muted" style={{ fontSize: '22px' }}>{total.wins}–{total.losses}</span>
        </div>
      </section>
      <section class="card">
        <div class="eyebrow">Win % by year</div>
        <div class="year-chart" role="img" aria-label={years.map((y) => `${y.year} ${winPct(y)}%`).join(', ')}>
          {years.map((y) => (
            <div key={y.year}>
              <i style={{ height: `${winPct(y) ? Math.max(winPct(y), 3) : 0}px` }} />
              {y.year}
              <br />
              {winPct(y)}%
            </div>
          ))}
        </div>
      </section>
      <People title="Partners" rows={tally(played, (m) => m.partners)} />
      <People title="Head-to-head" rows={tally(played, (m) => m.opponents)} />
    </main>
  );
}
