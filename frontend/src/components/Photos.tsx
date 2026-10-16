import { useRef, useState } from 'preact/hooks';

import { api } from '../api';
import { MAX_PER_OWNER, uploadPhoto } from '../photos';
import type { Photo } from '../types';

type Change = (change?: () => Promise<unknown>) => Promise<void>;
const mock = () => import.meta.env.DEV && new URLSearchParams(location.search).has('mock');

/** A row of thumbnails for one match or trophy, with an Add tile and a full-size viewer. */
export function PhotoStrip({ owner, photos, onPhotos }: { owner: string; photos: Photo[]; onPhotos: Change }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const room = MAX_PER_OWNER - photos.length;
  const add = async (files: File[]) => {
    if (mock()) return setStatus('Photos are off in demo mode.');
    const picked = files.slice(0, room);
    let done = 0;
    try {
      for (const file of picked) {
        setStatus(`Uploading ${done + 1} of ${picked.length}…`);
        await onPhotos(() => uploadPhoto(owner, file));
        done += 1;
      }
      setStatus(files.length > room ? `Added ${done}. Up to ${MAX_PER_OWNER} photos.` : '');
    } catch {
      setStatus(done ? `Added ${done}. One photo could not be added.` : 'Could not add the photo. Try again.');
    }
  };
  return (
    <div class="photo-strip-wrap">
      <div class="row">
        <span class="eyebrow grow">Photos</span>
        <span class="muted">{photos.length} of {MAX_PER_OWNER}</span>
      </div>
      <div class="photo-strip">
        {room > 0 && (
          <button class="photo-tile add" type="button" onClick={() => input.current?.click()}>
            <b aria-hidden="true">+</b>Add
          </button>
        )}
        {photos.map((p, i) => (
          <button key={p.id} class="photo-tile" type="button" aria-label={`Photo ${i + 1} of ${photos.length}`} onClick={() => setOpen(i)}>
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
      {open !== null && photos[open] && <Viewer photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onPhotos={onPhotos} />}
    </div>
  );
}

function Viewer({ photos, index, onIndex, onClose, onPhotos }: { photos: Photo[]; index: number; onIndex: (i: number) => void; onClose: () => void; onPhotos: Change }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const photo = photos[index];
  if (!photo) return null;
  const go = (to: number) => {
    setConfirm(false);
    onIndex((to + photos.length) % photos.length);
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
  return (
    <div class="viewer" role="dialog" aria-modal="true" aria-label="Photo">
      <div class="row between">
        <button class="button quiet" type="button" onClick={onClose}>
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
            <button class="button danger" type="button" onClick={() => run(() => api.deletePhoto(photo.id), () => (photos.length === 1 ? onClose() : go(Math.min(index, photos.length - 2))))}>
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
