import { useState } from 'preact/hooks';

import type { MatchInput } from '../api';
import { winnerFromScore } from '../score';

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the phone's time zone
const field = { display: 'flex', flexDirection: 'column', gap: '6px' } as const;

export const blankMatch = (): MatchInput => ({ event: 'Local match', date: today(), partner: '', opponents: ['', ''], score: '', won: null });

type Result = 'win' | 'loss' | 'draw';
const asResult = (won: boolean | null): Result => (won === true ? 'win' : won === false ? 'loss' : 'draw');
const asWon = (r: Result) => (r === 'win' ? true : r === 'loss' ? false : null);

/** Doubles only. The result follows the score until you pick one yourself. */
export function MatchForm({ initial, onSave, onCancel, onDelete }: { initial: MatchInput; onSave: (m: MatchInput) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void> }) {
  const [f, setF] = useState({ ...initial, opponents: [initial.opponents[0] ?? '', initial.opponents[1] ?? ''] });
  const [picked, setPicked] = useState(Boolean(onDelete)); // an edit keeps its saved result
  const [status, setStatus] = useState('');
  const run = async (action: () => Promise<void>) => {
    setStatus('Saving…');
    try {
      await action();
      setStatus('');
    } catch {
      setStatus('Could not save. Try again.');
    }
  };
  const saving = status === 'Saving…';
  const [first = '', second = ''] = f.opponents;
  const names = [first, second].filter((n) => n.trim() !== '');
  const valid = f.event.trim() !== '' && f.date !== '' && f.partner.trim() !== '' && names.length > 0 && f.score.trim() !== '';
  const input = (value: string, set: (v: string) => void, placeholder: string, max = 60) => (
    <input type="text" maxLength={max} autoComplete="off" placeholder={placeholder} value={value} onInput={(e) => set(e.currentTarget.value)} />
  );
  return (
    <div class="card" style={{ background: 'var(--raised)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <label style={field}>
        <span class="muted">Date</span>
        <input type="date" max={onDelete ? undefined : today()} value={f.date} onInput={(e) => setF({ ...f, date: e.currentTarget.value })} />
      </label>
      <label style={field}>
        <span class="muted">Event</span>
        {input(f.event, (event) => setF({ ...f, event }), 'e.g. Club night', 100)}
      </label>
      <label style={field}>
        <span class="muted">Your partner</span>
        {input(f.partner, (partner) => setF({ ...f, partner }), 'Name')}
      </label>
      <div style={field}>
        <span class="muted">Opponents</span>
        {input(first, (n) => setF({ ...f, opponents: [n, second] }), 'Name')}
        {input(second, (n) => setF({ ...f, opponents: [first, n] }), 'Second opponent (optional)')}
      </div>
      <label style={field}>
        <span class="muted">Score, your side first</span>
        <input
          type="text"
          maxLength={40}
          autoComplete="off"
          autoCapitalize="off"
          placeholder="6-3 6-4"
          value={f.score}
          onInput={(e) => {
            const score = e.currentTarget.value;
            setF({ ...f, score, won: picked ? f.won : winnerFromScore(score) });
          }}
        />
      </label>
      <label style={field}>
        <span class="muted">Result</span>
        <select
          value={asResult(f.won)}
          onChange={(e) => {
            setPicked(true);
            setF({ ...f, won: asWon(e.currentTarget.value as Result) });
          }}
        >
          <option value="win">Win</option>
          <option value="loss">Loss</option>
          <option value="draw">Draw / unfinished</option>
        </select>
      </label>
      <button class="button" type="button" disabled={!valid || saving} onClick={() => run(() => onSave({ ...f, opponents: names }))}>
        Save match
      </button>
      <button class="button quiet" type="button" onClick={onCancel}>
        Cancel
      </button>
      {onDelete && (
        <button class="button quiet" type="button" style={{ color: 'var(--loss-text)' }} disabled={saving} onClick={() => confirm('Delete this match?') && run(onDelete)}>
          Delete match
        </button>
      )}
      <span class="muted" role="status">
        {status}
      </span>
    </div>
  );
}
