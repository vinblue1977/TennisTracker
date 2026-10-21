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
    let reason = '';
    for (const file of picked) {
      setStatus(`Uploading ${done + failed + 1} of ${picked.length}…`);
      try {
        await onPhotos(() => uploadPhoto(owner, file));
        done += 1;
      } catch (err) {
        failed += 1; // keep going with the rest
        reason = err instanceof Error ? err.message : '';
      }
    }
    const notes = [failed ? `${failed} could not be added${reason ? ` (${reason})` : ''}.` : '', files.length > room ? `Up to ${MAX_PER_OWNER} photos.` : ''].filter(Boolean);
    setStatus(done || notes.length ? [done ? `Added ${done}.` : '', ...notes].filter(Boolean).join(' ') : '');
    setBusy(false);
  };
  return (
    <div class="photo-strip-wrap">
      <div class="row">
        <span class="eyebrow grow">Photos</span>
        <span class="muted">
          {photos.length} {photos.length === 1 ? 'photo' : 'photos'} · max {MAX_PER_OWNER}
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
            <img src={p.thumb ?? p.url} alt="" loading="lazy" decoding="async" onError={() => onPhotos()} />
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
  const [framing, setFraming] = useState(false);
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
      {framing ? (
        <Framer
          photo={photo}
          onCancel={() => setFraming(false)}
          onSave={(focus) =>
            run(
              () => api.photoFocus(photo.id, focus),
              () => setFraming(false),
            )
          }
          error={error}
        />
      ) : (
        <>
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
            <span class="row">
              <button class="button quiet" type="button" disabled={photo.cover} onClick={() => run(() => api.photoCover(photo.id))}>
                {photo.cover ? 'Cover photo' : 'Use as cover'}
              </button>
              <button class="button quiet" type="button" onClick={() => setFraming(true)}>
                Frame on card
              </button>
            </span>
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
        </>
      )}
    </div>
  );
}

const CARD_PHOTO_MAX = 280; // px; keep in step with .match-photo img and .photo-wrap img

/** Drag a window over the photo to choose which part of a tall photo the match and trophy cards show. */
function Framer({ photo, onCancel, onSave, error }: { photo: Photo; onCancel: () => void; onSave: (focus: number) => void; error: string }) {
  const [focus, setFocus] = useState(photo.focus);
  const [shape, setShape] = useState<{
    w: number;
    h: number;
    ratio: number;
  } | null>(null); // rendered size, natural height/width
  const drag = useRef<{ y: number; focus: number } | null>(null);
  const measure = (img: HTMLImageElement) =>
    setShape({
      w: img.clientWidth,
      h: img.clientHeight,
      ratio: img.naturalHeight / img.naturalWidth,
    });
  const shown = shape ? Math.min(1, CARD_PHOTO_MAX / (shape.w * shape.ratio)) : 1; // share of the photo's height the card shows
  const winH = shape ? shape.h * shown : 0;
  const room = shape ? shape.h - winH : 0;
  const move = (to: number) => setFocus(Math.max(0, Math.min(100, to)));
  const down = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    drag.current = { y: e.clientY, focus };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const dragged = (e: PointerEvent & { currentTarget: HTMLDivElement }) => drag.current && room > 0 && move(drag.current.focus + ((e.clientY - drag.current.y) / room) * 100);
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    move(focus + (e.key === 'ArrowUp' ? -4 : 4));
  };
  return (
    <>
      <div class="viewer-image">
        <div class="frame-stage">
          <img src={photo.url} alt="" onLoad={(e) => measure(e.currentTarget)} />
          {shape && room > 0 && (
            <>
              <div class="frame-shade" style={{ top: 0, height: `${(room * focus) / 100}px` }} />
              <div
                class="frame-shade"
                style={{
                  bottom: 0,
                  height: `${(room * (100 - focus)) / 100}px`,
                }}
              />
              <div
                class="frame-window"
                role="slider"
                tabIndex={0}
                aria-label="Card framing, vertical position"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(focus)}
                style={{
                  top: `${(room * focus) / 100}px`,
                  height: `${winH}px`,
                }}
                onPointerDown={down}
                onPointerMove={dragged}
                onPointerUp={() => (drag.current = null)}
                onKeyDown={key}
              >
                <span>⇅ Drag to frame</span>
              </div>
            </>
          )}
        </div>
      </div>
      <span class="muted" role="status">
        {error || (shape && room <= 0 ? 'This photo already fits the card.' : 'The bright part is what the card shows.')}
      </span>
      <div class="row between">
        <button class="button quiet" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button class="button" type="button" disabled={room <= 0 || Math.round(focus) === photo.focus} onClick={() => onSave(Math.round(focus))}>
          Save
        </button>
      </div>
    </>
  );
}
