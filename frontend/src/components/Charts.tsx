import type { Point } from '../data';

/** WTN over time; up means better (WTN is lower-is-better), with the latest point marked. */
export function Trend({ points, width = 326, height = 120 }: { points: Point[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const times = points.map((p) => Date.parse(p.date));
  const values = points.map((p) => p.value);
  const [t0, t1] = [Math.min(...times), Math.max(...times)];
  const [lo, hi] = [Math.min(...values) - 0.2, Math.max(...values) + 0.2];
  const x = (t: number) => 5 + ((t - t0) / (t1 - t0 || 1)) * (width - 10);
  const y = (v: number) => 8 + ((v - lo) / (hi - lo || 1)) * (height - 16);
  const xy = points.map((p) => [x(Date.parse(p.date)), y(p.value)] as const);
  const last = xy[xy.length - 1] ?? [0, 0];
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`WTN trend from ${values[0]} to ${values.at(-1)}; up means better`}>
      <line x1="0" y1={height - 8} x2={width} y2={height - 8} stroke="#2f6a49" />
      <polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" points={xy.map((p) => p.join(',')).join(' ')} />
      <circle cx={last[0]} cy={last[1]} r="5" fill="#fff" />
    </svg>
  );
}

export function Donut({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses;
  const c = 2 * Math.PI * 38;
  const winLength = total ? (wins / total) * c : 0;
  return (
    <div style={{ position: 'relative', width: '96px', height: '96px' }}>
      <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`${wins} wins, ${losses} losses`}>
        <circle cx="48" cy="48" r="38" fill="none" stroke={total ? 'var(--loss)' : 'var(--field)'} stroke-width="14" />
        <circle cx="48" cy="48" r="38" fill="none" stroke="var(--win)" stroke-width="14" stroke-dasharray={`${winLength} ${c - winLength}`} transform="rotate(-90 48 48)" />
      </svg>
      <span class="num" style={{ position: 'absolute', inset: '0px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
        {total ? `${Math.round((wins / total) * 100)}%` : '–'}
      </span>
    </div>
  );
}
