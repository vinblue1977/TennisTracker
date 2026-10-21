// Photos: resize on the phone, then upload straight to the private bucket with a signed form.
import { api } from './api';
import type { Photo } from './types';

export const MAX_PER_OWNER = 10;
const MAX_SIDE = 1600;
const THUMB_SIDE = 960; // a full-width card on a 3x phone
const MAX_BYTES = 3_000_000;
const MAX_THUMB_BYTES = 400_000; // keep in step with the server

/** Scale down to fit MAX_SIDE on the long edge; never scale up. */
export function fitSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const forOwner = (photos: Photo[], owner: string) => photos.filter((p) => p.owner === owner).sort((a, b) => Number(b.cover) - Number(a.cover) || a.id.localeCompare(b.id));

/** Re-drawing on a canvas turns HEIC into JPEG and drops the location data. */
export async function toJpeg(file: File, side = MAX_SIDE, quality = 0.85, maxBytes = MAX_BYTES): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = fitSize(bitmap.width, bitmap.height, side);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot resize photos.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob || blob.size > maxBytes) throw new Error('That photo is too large.');
  return blob;
}

async function post(signed: { url: string; fields: Record<string, string> }, blob: Blob): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(signed.fields)) form.append(name, value);
  form.append('file', blob); // S3 needs the file last
  return fetch(signed.url, { method: 'POST', body: form });
}

export async function uploadPhoto(owner: string, file: File): Promise<void> {
  const blob = await toJpeg(file);
  const signed = await api.photoUploadUrl(owner);
  const res = await post(signed, blob);
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  try {
    if (signed.thumb) await post(signed.thumb, await toJpeg(file, THUMB_SIDE, 0.8, MAX_THUMB_BYTES)); // best effort: without it the card loads the full photo
  } catch {
    /* ignore */
  }
  await api.photoConfirm(owner, signed.id);
}
