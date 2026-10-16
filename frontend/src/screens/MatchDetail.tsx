import { useState } from 'preact/hooks';

const draftKey = (id: string) => `note-draft:${id}`;
const readDraft = (id: string) => {
  try {
    return localStorage.getItem(draftKey(id));
  } catch {
    return null;
  }
};
const writeDraft = (id: string, text: string | null) => {
  try {
    if (text === null) localStorage.removeItem(draftKey(id));
    else localStorage.setItem(draftKey(id), text);
  } catch {
    // storage unavailable: the Save button still works
  }
};

import { formatDate, matchDate, ratingHistory, shortName, teamAverage, wtnAfter } from '../data';
import { forOwner } from '../photos';
import type { Data, Match } from '../types';
import { PhotoStrip } from '../components/Photos';

interface Props {
  data: Data;
  id: string;
  onSave: (id: string, note: string, starred: boolean) => Promise<void>;
  onPhotos: (change?: () => Promise<unknown>) => Promise<void>;
}

export function MatchDetail({ data, id, onSave, onPhotos }: Props) {
  const m = data.matches.find((x) => x.id === id);
  const [note, setNote] = useState(readDraft(id) ?? m?.note ?? ''); // an unsaved draft survives an app reload
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
      writeDraft(m.id, null);
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
          {m.upsetGap !== null && <span class="pill">{m.upsetGap > 0 ? `Upset · ${m.upsetGap.toFixed(2)}` : 'Upset win'}</span>}
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

      <section class="card">
        <PhotoStrip owner={`match:${m.id}`} photos={forOwner(data.photos, `match:${m.id}`)} onPhotos={onPhotos} />
      </section>

      <section class="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label class="eyebrow" for="note">
          Note
        </label>
        <textarea id="note" rows={4} maxLength={2000} placeholder="How did it go? What worked, what to fix?" value={note} onInput={(e) => {
            setNote(e.currentTarget.value);
            writeDraft(m.id, e.currentTarget.value);
          }}
          onBlur={() => note !== m.note && status !== 'saving' && save(note, m.starred)}
        />
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
