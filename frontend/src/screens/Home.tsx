import { Donut, Trend } from '../components/Charts';
import { UpcomingCard } from '../components/Upcoming';
import { form, formatDate, latest, matchDate, playedDoubles, ratingHistory, record, shortName } from '../data';
import type { Data } from '../types';
import { MatchRow } from './Matches';

export function Home({ data }: { data: Data }) {
  const points = ratingHistory(data.ratings, data.matches);
  const now = latest(points);
  const { wins, losses } = record(data.matches);
  const streakForm = form(playedDoubles(data.matches));
  const upsets =data.matches.filter((m) => m.upsetGap !== null).sort((a, b) => (b.upsetGap ?? 0) - (a.upsetGap ?? 0));
  const biggest = upsets[0];
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <main class="screen cols">
      <header>
        <div class="muted">{today}</div>
        <h1 class="title">Tennis</h1>
      </header>

      <a class="hero" href="#/wtn" aria-label="World Tennis Number, see history">
        <span class="eyebrow">World Tennis Number · Doubles</span>
        {now ? (
          <>
            <div class="row">
              <span class="hero-value">{now.point.value.toFixed(2)}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {now.better !== null && <span class="pill">{now.better > 0 ? `▼ ${now.better.toFixed(2)} better` : `▲ ${Math.abs(now.better).toFixed(2)}`}</span>}
                <span class="muted">
                  {now.point.confidence !== null ? `Confidence ${now.point.confidence} · ` : ''}
                  {formatDate(now.point.date)}
                </span>
              </div>
            </div>
            <Trend points={points} />
            <div class="row muted" style={{ justifyContent: 'space-between', fontSize: '12px' }}>
              <span>
                {points[0] ? `${formatDate(points[0].date, true)} · ${points[0].value.toFixed(2)}` : ''}
              </span>
              <span>Lower is better</span>
            </div>
          </>
        ) : (
          <span class="muted">No WTN yet. It appears after the first sync.</span>
        )}
      </a>

      <div class="grid2">
        <section class="card" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} aria-label="Doubles UTR">
          <span class="eyebrow">UTR · Doubles</span>
          <span class="num" style={{ fontSize: '32px' }}>{typeof data.profile.utr === 'number' ? data.profile.utr.toFixed(2) : '–'}</span>
          {typeof data.profile.utr !== 'number' && <a href="#/me">Add on Me</a>}
        </section>
        <section class="card" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} aria-label="NTRP">
          <span class="eyebrow">NTRP</span>
          <span class="num" style={{ fontSize: '32px' }}>{typeof data.profile.ntrp === 'number' ? data.profile.ntrp.toFixed(1) : '–'}</span>
          {typeof data.profile.ntrp !== 'number' && <a href="#/me">Add on Me</a>}
        </section>
      </div>

      {data.upcoming[0] && (
        <a class="tap" href="#/upcoming">
          <UpcomingCard u={data.upcoming[0]} highlight />
        </a>
      )}

      <div class="grid2">
        <a class="card tap" href="#/stats" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }} aria-label="Wins and losses, see stats">
          <span class="eyebrow" style={{ alignSelf: 'flex-start' }}>Win–loss</span>
          <Donut wins={wins} losses={losses} />
          <span style={{ fontWeight: 600 }}>
            <span style={{ color: 'var(--win-text)' }}>{wins} W</span> · <span style={{ color: 'var(--loss-text)' }}>{losses} L</span>
          </span>
        </a>
        <a class="card tap" href="#/upsets" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} aria-label="Upset wins, see list">
          <span class="eyebrow">Upset wins</span>
          <span class="num" style={{ fontSize: '40px', color: 'var(--accent)' }}>{upsets.length}</span>
          <span class="muted" style={{ fontSize: '14px' }}>
            {biggest
              ? `Beat a higher-rated team. Biggest: ${biggest.upsetGap ? `${biggest.upsetGap.toFixed(2)} w/ ` : 'w/ '}${shortName(biggest.partners[0]?.name ?? '')}, ${formatDate(matchDate(biggest), true)}`
              : 'Beat a higher-rated team to get one.'}
          </span>
        </a>
      </div>

      {streakForm.last.length > 0 && (
        <a class="card tap" href="#/matches" style={{ flexDirection: 'column', gap: '10px' }} aria-label="Recent form, see matches">
          <div class="row" style={{ justifyContent: 'space-between' }}>
            <span class="eyebrow">Form</span>
            {streakForm.streak >= 2 && <span class="pill">W{streakForm.streak} streak</span>}
            {streakForm.streak <= -2 && <span class="muted">L{-streakForm.streak} run</span>}
          </div>
          <div class="row" style={{ gap: '8px' }} aria-label="Last results, oldest first">
            {streakForm.last.map((won) => (
              <span class={`badge ${won ? 'W' : 'L'}`}>{won ? 'W' : 'L'}</span>
            ))}
          </div>
          <div class="row muted" style={{ gap: '20px', fontSize: '14px' }}>
            <span>Longest W{streakForm.longestWin}</span>
            <span>
              Last {streakForm.recent.wins + streakForm.recent.losses} {streakForm.recent.wins}–{streakForm.recent.losses}
            </span>
          </div>
        </a>
      )}

      <div class="row" style={{ justifyContent: 'space-between', padding: '4px 4px 0' }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>Recent results</h2>
        <a href="#/matches" style={{ fontWeight: 600 }}>
          All matches
        </a>
      </div>
      <div class="list">
        {data.matches.slice(0, 3).map((m) => (
          <MatchRow m={m} />
        ))}
      </div>
    </main>
  );
}
