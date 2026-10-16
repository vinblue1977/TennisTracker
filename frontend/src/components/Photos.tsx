import { useEffect, useRef, useState } from 'preact/hooks';

import { api } from '../api';
import { isMock } from '../env';
import { MAX_PER_OWNER, uploadPhoto } from '../photos';
import type { Photo } from '../types';

type Change = (change?: () => Promise<unknown>) => Promise<void>;

/** A row of thumbnails for one match or trophy, with an Add tile and a full-size viewer. */
export function PhotoStrip({ owner, photos, onPhotos }: { owner: string; photos: Photo[]; onPhotos: Change }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null); // by id, so a reload that reorders photos doesn't change the one shown
  const room = MAX_PER_OWNER - photos.length;
  const openIndex = photos.findIndex((p) => p.id === open);
  const add = async (files: File[]) => {
    if (isMock()) return setStatus('Photos are off in demo mode.');
    if (busy) return;
    setBusy(true);
    const picked = files.slice(0, room);
    let done = 0;
    let failed = 0;
    for (const file of picked) {
      setStatus(`Uploading ${done + failed + 1} of ${picked.length}…`);
      try {
        await onPhotos(() => uploadPhoto(owner, file));
        done += 1;
      } catch {
        failed += 1; // keep going with the rest
      }
    }
    const notes = [failed ? `${failed} could not be added.` : '', files.length > room ? `Up to ${MAX_PER_OWNER} photos.` : ''].filter(Boolean);
    setStatus(done || notes.length ? [done ? `Added ${done}.` : '', ...notes].filter(Boolean).join(' ') : '');
    setBusy(false);
  };
  return (
    <div class="photo-strip-wrap">
      <div class="row">
        <span class="eyebrow grow">Photos</span>
        <span class="muted">
          {photos.length} of {MAX_PER_OWNER}
        </span>
      </div>
      <div class="photo-strip">
        {room > 0 && (
          <button class="photo-tile add" type="button" disabled={busy} onClick={() => input.current?.click()}>
            <b aria-hidden="true">+</b>Add
          </button>
        )}
        {photos.map((p, i) => (
          <button key={p.id} class="photo-tile" type="button" aria-label={`Photo ${i + 1} of ${photos.length}`} onClick={() => setOpen(p.id)}>
            <img src={p.url} alt="" loading="lazy" onError={() => onPhotos()} />
          </button>
        ))}
      </div>
      <input
        ref={input}
        class="sr-only"
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = ''; // picking the same photo again still fires
          if (files.length) void add(files);
        }}
      />
      <span class="muted" role="status">
        {status}
      </span>
      {openIndex >= 0 && <Viewer photos={photos} index={openIndex} onOpen={setOpen} onClose={() => setOpen(null)} onPhotos={onPhotos} />}
    </div>
  );
}

function Viewer({ photos, index, onOpen, onClose, onPhotos }: { photos: Photo[]; index: number; onOpen: (id: string) => void; onClose: () => void; onPhotos: Change }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const photo = photos[index];
  if (!photo) return null;
  const go = (to: number) => {
    setConfirm(false);
    const next = photos[(to + photos.length) % photos.length];
    if (next) onOpen(next.id);
  };
  const run = async (change: () => Promise<unknown>, after?: () => void) => {
    setError('');
    try {
      await onPhotos(change);
      after?.();
    } catch {
      setError('Could not save. Try again.');
    }
  };
  const afterDelete = () => {
    const next = photos[index + 1] ?? photos[index - 1];
    if (next) onOpen(next.id);
    else onClose();
    setConfirm(false);
  };
  return (
    <div class="viewer" role="dialog" aria-modal="true" aria-label="Photo">
      <div class="row between">
        <button ref={close} class="button quiet" type="button" onClick={onClose}>
          Close
        </button>
        <span class="muted">
          {index + 1} of {photos.length}
        </span>
      </div>
      <div class="viewer-image">
        <img src={photo.url} alt="" onError={() => onPhotos()} />
        {photos.length > 1 && (
          <>
            <button class="viewer-nav prev" type="button" aria-label="Previous photo" onClick={() => go(index - 1)}>
              ‹
            </button>
            <button class="viewer-nav next" type="button" aria-label="Next photo" onClick={() => go(index + 1)}>
              ›
            </button>
          </>
        )}
      </div>
      <div class="row between">
        <button class="button quiet" type="button" disabled={photo.cover} onClick={() => run(() => api.photoCover(photo.id))}>
          {photo.cover ? 'Cover photo' : 'Use as cover'}
        </button>
        {confirm ? (
          <span class="row">
            <button class="button quiet" type="button" onClick={() => setConfirm(false)}>
              Keep
            </button>
            <button class="button danger" type="button" onClick={() => run(() => api.deletePhoto(photo.id), afterDelete)}>
              Delete
            </button>
          </span>
        ) : (
          <button class="button quiet danger-text" type="button" onClick={() => setConfirm(true)}>
            Delete
          </button>
        )}
      </div>
      <span class="muted" role="status">
        {error}
      </span>
    </div>
  );
}
