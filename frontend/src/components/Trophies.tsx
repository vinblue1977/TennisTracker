import { useState } from 'preact/hooks';

import { api, type TrophyInput } from '../api';
import { formatDate } from '../data';
import { forOwner } from '../photos';
import type { Data, Photo, Suggestion, Trophy } from '../types';
import { PhotoStrip } from './Photos';

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the phone's time zone
const icon = (t: Trophy) => (t.result === 'winner' ? '🏆' : '🥈');
const mock = () => import.meta.env.DEV && new URLSearchParams(location.search).has('mock');

type Form = { id?: string; event: string; date: string; result: Trophy['result']; note: string; suggestion?: string };
type Props = {
  data: Data['trophies'];
  photos: Photo[];
  onChange: (change: () => Promise<unknown>) => Promise<void>;
  onPhotos: (change?: () => Promise<unknown>) => Promise<void>;
};

function TrophyForm({ form, onSave, onCancel, onDelete, extra }: { form: Form; onSave: (f: Form) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void>; extra?: preact.ComponentChildren }) {
  const [f, setF] = useState(form);
  const [status, setStatus] = useState('');
  const run = async (action: () => Promise<void>) => {
    setStatus('Saving…');
    try {
      await action();
    } catch {
      setStatus('Could not save. Try again.');
    }
  };
  const valid = f.event.trim() !== '' && f.date !== '';
  return (
    <div class="card" style={{ background: 'var(--raised)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span class="muted">Event name</span>
        <input type="text" maxLength={100} autoComplete="off" placeholder="e.g. Club Championship" value={f.event} onInput={(e) => setF({ ...f, event: e.currentTarget.value })} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span class="muted">Date</span>
        <input type="date" max={today()} value={f.date} onInput={(e) => setF({ ...f, date: e.currentTarget.value })} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span class="muted">Result</span>
        <select value={f.result} onChange={(e) => setF({ ...f, result: e.currentTarget.value as Trophy['result'] })}>
          <option value="winner">🏆 Winner</option>
          <option value="finalist">🥈 Finalist</option>
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span class="muted">Partner or note (optional)</span>
        <input type="text" maxLength={200} autoComplete="off" placeholder="e.g. with Sam, 6-4 6-3" value={f.note} onInput={(e) => setF({ ...f, note: e.currentTarget.value })} />
      </label>
      {extra}
      <button class="button" type="button" disabled={!valid} onClick={() => run(() => onSave(f))}>
        Save trophy
      </button>
      <button class="button quiet" type="button" onClick={onCancel}>
        Cancel
      </button>
      {onDelete && (
        <button class="button quiet" type="button" onClick={() => run(onDelete)}>
          Delete trophy
        </button>
      )}
      <span class="muted" role="status">
        {status}
      </span>
    </div>
  );
}

export function Trophies({ data, photos, onChange, onPhotos }: Props) {
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = (f: Form): TrophyInput => ({ event: f.event.trim(), date: f.date, result: f.result, note: f.note.trim(), ...(f.suggestion ? { suggestion: f.suggestion } : {}) });
  const save = async (f: Form) => {
    if (mock()) return setForm(null);
    await onChange(() => (f.id ? api.editTrophy(f.id, input(f)) : api.addTrophy(input(f))));
    setForm(null);
  };
  const act = async (change: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      if (!mock()) await onChange(change);
    } catch {
      setError('Could not save. Try again.');
    }
    setBusy(false);
  };
  const accept = (s: Suggestion) => busy || act(() => api.addTrophy({ event: s.event, date: s.date, result: 'winner', note: s.partner ? `with ${s.partner}` : '', suggestion: s.id }));
  const count = data.trophies.length;
  return (
    <section class="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div class="row">
        <span class="eyebrow grow">Trophies{count ? ` · ${count}` : ''}</span>
        {!form && (
          <button class="button quiet" type="button" style={{ minHeight: '36px' }} onClick={() => setForm({ event: '', date: today(), result: 'winner', note: '' })}>
            + Add
          </button>
        )}
      </div>
      {form && !form.id && <TrophyForm form={form} onSave={save} onCancel={() => setForm(null)} />}
      {data.suggestions.map((s) => (
        <div key={s.id} class="card" style={{ border: '1px dashed var(--accent)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span class="eyebrow" style={{ color: 'var(--accent)' }}>
            Suggested
          </span>
          <div class="row">
            <span style={{ fontSize: '30px' }}>🏆</span>
            <div class="grow">
              <div style={{ fontWeight: 700 }}>{s.event}</div>
              <div class="muted">
                {formatDate(s.date, true)} · won {s.matches} of {s.matches}
                {s.partner ? ` · with ${s.partner}` : ''}
              </div>
            </div>
          </div>
          <div class="row">
            <button class="button grow" type="button" disabled={busy} onClick={() => accept(s)}>
              Add trophy
            </button>
            <button class="button quiet" type="button" disabled={busy} onClick={() => act(() => api.dismissSuggestion(s.id))}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
      {data.trophies.map((t) =>
        form?.id === t.id ? (
          <TrophyForm key={t.id} form={form} extra={<PhotoStrip owner={`trophy:${t.id}`} photos={forOwner(photos, `trophy:${t.id}`)} onPhotos={onPhotos} />} onSave={save} onCancel={() => setForm(null)} onDelete={() => onChange(() => api.deleteTrophy(t.id)).then(() => setForm(null))} />
        ) : (
          <TrophyRow key={t.id} trophy={t} photos={forOwner(photos, `trophy:${t.id}`)} onOpen={() => setForm({ ...t })} onPhotos={onPhotos} />
        ),
      )}
      {!count && !data.suggestions.length && !form && <span class="muted">No trophies yet. Add one by hand, or win every match of an event.</span>}
      <span class="muted" role="status">
        {error}
      </span>
    </section>
  );
}

function TrophyRow({ trophy: t, photos, onOpen, onPhotos }: { trophy: Trophy; photos: Photo[]; onOpen: () => void; onPhotos: Props['onPhotos'] }) {
  const cover = photos[0];
  const text = (
    <>
      <div style={{ fontWeight: 700 }}>{t.event}</div>
      <div class={cover ? undefined : 'muted'}>
        {formatDate(t.date, true)} · {t.result === 'winner' ? 'Winner' : 'Finalist'}
        {t.note ? ` · ${t.note}` : ''}
      </div>
    </>
  );
  if (!cover)
    return (
      <button class="row" type="button" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }} onClick={onOpen}>
        <span style={{ fontSize: '30px' }}>{icon(t)}</span>
        <span class="grow">{text}</span>
      </button>
    );
  return (
    <button class="photo-card" type="button" onClick={onOpen}>
      <img src={cover.url} alt="" loading="lazy" onError={() => onPhotos()} />
      <span class="fade" />
      {photos.length > 1 && <span class="photo-count">{photos.length} photos</span>}
      <span class="photo-card-text">
        <span style={{ fontSize: '22px' }}>{icon(t)}</span> {text}
      </span>
    </button>
  );
}
