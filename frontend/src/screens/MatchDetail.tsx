import { useState } from 'preact/hooks';

import { formatDate, matchDate, ratingHistory, shortName, teamAverage, wtnAfter } from '../data';
import type { Data, Match } from '../types';

interface Props {
  data: Data;
  id: string;
  onSave: (id: string, note: string, starred: boolean) => Promise<void>;
}

export function MatchDetail({ data, id, onSave }: Props) {
  const m = data.matches.find((x) => x.id === id);
  const [note, setNote] = useState(m?.note ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  if (!m) {
    return (
      <main class="screen">
        <a class="back" href="#/matches">‹ Matches</a>
        <p class="muted">Match not found.</p>
      </main>
    );
  }
  const points = ratingHistory(data.ratings, data.matches);
  const after = wtnAfter(points, m);
  const save = async (nextNote: string, starred: boolean) => {
    setStatus('saving');
    try {
      await onSave(m.id, nextNote, starred);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return (
    <main class="screen">
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <a class="back" href="#/matches">‹ Matches</a>
        <button
          class="icon-button"
          type="button"
          aria-pressed={m.starred}
          aria-label={m.starred ? 'Remove from best matches' : 'Add to best matches'}
          style={{ color: m.starred ? 'var(--accent)' : 'var(--text)', fontSize: '22px' }}
          onClick={() => save(note, !m.starred)}
        >
          {m.starred ? '★' : '☆'}
        </button>
      </div>

      <section class="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div class="row" style={{ gap: '8px' }}>
          <span class="pill" style={{ background: m.won ? 'var(--win)' : m.won === false ? 'var(--loss)' : 'var(--field)', color: m.won === null ? 'var(--text)' : 'var(--ground)' }}>
            {m.won ? 'Win' : m.won === false ? 'Loss' : 'No result'}
          </span>
          {m.upsetGap !== null && <span class="pill">Upset · {m.upsetGap.toFixed(2)}</span>}
        </div>
        <h1 style={{ margin: 0, fontSize: '22px', lineHeight: 1.2 }}>{m.event}</h1>
        <span class="muted">
          {formatDate(matchDate(m), true)} · {m.kind === 'DOUBLE' ? 'Doubles' : 'Singles'}
        </span>
        <span class="score" style={{ fontSize: '28px' }}>
          {m.score}
        </span>
      </section>

      <section class="list" aria-label="Players and WTN going in">
        <Team label="Your team" players={m.partners} average={null} you />
        <Team label="Opponents" players={m.opponents} average={teamAverage(m.opponents)} />
        {after !== null && (
          <div class="item">
            <span class="grow muted">Your WTN after</span>
            <span class="num" style={{ fontSize: '20px' }}>
              {after.toFixed(2)}
            </span>
          </div>
        )}
      </section>

      <section class="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label class="eyebrow" for="note">
          Note
        </label>
        <textarea id="note" rows={4} maxLength={2000} placeholder="How did it go? What worked, what to fix?" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        <div class="row" style={{ justifyContent: 'space-between' }}>
          <span class="muted" role="status">
            {{ idle: '', saving: 'Saving…', saved: 'Saved', error: 'Could not save. Try again.' }[status]}
          </span>
          <button class="button" type="button" disabled={status === 'saving' || note === m.note} onClick={() => save(note, m.starred)}>
            Save note
          </button>
        </div>
      </section>
    </main>
  );
}

function Team({ label, players, average, you = false }: { label: string; players: Match['partners']; average: number | null; you?: boolean }) {
  return (
    <>
      <div class="item eyebrow" style={{ minHeight: '40px' }}>
        <span class="grow">{label}</span>
        {average !== null && !you && <span>avg {average.toFixed(2)}</span>}
      </div>
      {you && (
        <div class="item">
          <span class="grow" style={{ fontWeight: 600 }}>
            You
          </span>
        </div>
      )}
      {players.map((p) => (
        <div class="item">
          <span class="grow" style={{ fontWeight: 600 }}>
            {shortName(p.name)}
          </span>
          <span class="num" style={{ fontSize: '20px' }}>
            {p.wtn !== null ? p.wtn.toFixed(2) : '–'}
          </span>
        </div>
      ))}
    </>
  );
}
