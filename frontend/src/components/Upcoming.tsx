import { formatWhen, relativeDay } from '../data';
import type { Upcoming } from '../types';

/** One upcoming match from the Tennis calendar. */
export function UpcomingCard({ u, highlight = false }: { u: Upcoming; highlight?: boolean }) {
  const d = new Date(u.start);
  const soon = relativeDay(u.start);
  return (
    <section class="card row" style={{ gap: '14px' }} aria-label={highlight ? 'Next match' : 'Upcoming match'}>
      <div class="date-chip">
        <span>{d.toLocaleDateString('en-GB', { weekday: 'short', ...(u.allDay ? { timeZone: 'UTC' } : {}) }).toUpperCase()}</span>
        <span class="num">{u.allDay ? d.getUTCDate() : d.getDate()}</span>
      </div>
      <div class="grow">
        {highlight && <div class="eyebrow" style={{ color: 'var(--accent)' }}>Next match{soon ? ` · ${soon}` : ''}</div>}
        <div class="ellipsis" style={{ fontWeight: 700, fontSize: '17px' }}>
          {u.title}
        </div>
        <div class="muted" style={{ fontSize: '14px' }}>
          {formatWhen(u.start, u.allDay)}
          {u.location ? ` · ${u.location}` : ''}
        </div>
      </div>
    </section>
  );
}
