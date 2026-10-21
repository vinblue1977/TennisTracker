import { useState } from 'preact/hooks';

import { byYear, formatDate, playedDoubles, recap, winPct } from '../data';
import { recapPng, shareRecap } from '../recapImage';
import type { Data } from '../types';

export function Recap({ data }: { data: Data }) {
  const years = byYear(playedDoubles(data.matches)).map((y) => y.year);
  const [year, setYear] = useState(years.at(-1) ?? '');
  const [error, setError] = useState('');
  const r = recap(data, year);
  const trophies = r.winners + r.finalists;
  const share = async () => {
    setError('');
    try {
      await shareRecap(await recapPng(r), year);
    } catch {
      setError('Could not make the image.');
    }
  };
  return (
    <main class="screen">
      <a class="back" href="#/stats">
        ‹ Stats
      </a>
      <h1 class="title">Season recap</h1>
      {years.length === 0 && <p class="muted">No doubles matches yet.</p>}
      <div class="chips">
        {years.map((y) => (
          <button key={y} type="button" class={`chip${y === year ? ' on' : ''}`} aria-pressed={y === year} onClick={() => setYear(y)}>
            {y}
          </button>
        ))}
      </div>
      {years.length > 0 && (
        <>
          <section class="recap">
            <div class="recap-year">{year} SEASON · DOUBLES</div>
            <div>
              <div class="recap-big">
                {winPct(r)}%<small>{r.wins}–{r.losses}</small>
              </div>
              <div class="recap-sub">
                {r.wins + r.losses} matches · {r.events} {r.events === 1 ? 'event' : 'events'}
              </div>
            </div>
            <div class="grid2">
              <div class="recap-tile">
                <b>{r.partner?.name ?? '–'}</b>
                <span>Best partner{r.partner ? ` · ${r.partner.wins}–${r.partner.losses}` : ''}</span>
              </div>
              <div class="recap-tile">
                <b>{r.upset ? (r.upset.gap ? `+${r.upset.gap.toFixed(2)}` : 'Upset win') : '–'}</b>
                <span>Biggest upset{r.upset ? ` · w/ ${r.upset.partner}, ${formatDate(r.upset.date)}` : ''}</span>
              </div>
              <div class="recap-tile">
                <b>{r.longestWin ? `W${r.longestWin}` : '–'}</b>
                <span>Longest win streak</span>
              </div>
              <div class="recap-tile">
                <b>
                  {trophies} {trophies === 1 ? 'trophy' : 'trophies'}
                </b>
                <span>
                  {r.winners} winner · {r.finalists} finalist
                </span>
              </div>
            </div>
            <div class="recap-foot">
              <span>Tennis Tracker</span>
              {r.wtn && (
                <span>
                  WTN {r.wtn.from.toFixed(1)} → {r.wtn.to.toFixed(1)}
                </span>
              )}
            </div>
          </section>
          <button class="button" type="button" onClick={share}>
            Share image
          </button>
          {error && <p class="muted" role="alert">{error}</p>}
        </>
      )}
    </main>
  );
}
