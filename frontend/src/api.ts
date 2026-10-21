import { getAccessToken } from './auth';
import type { Config } from './config';
import type { Data, Match, Photo, Profile, Rating, Trophy, Upcoming } from './types';

export interface MatchInput {
  event: string;
  date: string;
  partner: string;
  opponents: string[];
  score: string;
  won: boolean | null;
}
export type TrophyInput = Omit<Trophy, 'id'> & { suggestion?: string };

let base = '';

export function initApi(config: Config): void {
  base = config.apiUrl;
}

export const apiBase = () => base;

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error('Signing in…');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 401 && retry) {
    await getAccessToken(true);
    return call(path, init, false);
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export const api = {
  profile: () => call<Profile>('/me/profile'),
  ratings: () => call<{ ratings: Rating[] }>('/me/ratings').then((r) => r.ratings),
  matches: () => call<{ matches: Match[] }>('/me/matches').then((r) => r.matches),
  upcoming: () => call<{ upcoming: Upcoming[] }>('/me/upcoming').then((r) => r.upcoming),
  trophies: () => call<Data['trophies']>('/me/trophies'),
  addTrophy: (t: TrophyInput) => call<Trophy>('/me/trophies', { method: 'POST', body: JSON.stringify(t) }),
  editTrophy: (id: string, t: TrophyInput) => call<Trophy>(`/me/trophies/${id}`, { method: 'PUT', body: JSON.stringify(t) }),
  deleteTrophy: (id: string) => call<{ id: string }>(`/me/trophies/${id}`, { method: 'DELETE' }),
  dismissSuggestion: (id: string) => call<{ dismissed: boolean }>('/me/trophies/dismiss', { method: 'POST', body: JSON.stringify({ id }) }),
  photos: () => call<{ photos: Photo[] }>('/me/photos').then((r) => r.photos),
  photoUploadUrl: (owner: string) =>
    call<{ id: string; url: string; fields: Record<string, string>; thumb: { url: string; fields: Record<string, string> } }>('/me/photos/upload-url', { method: 'POST', body: JSON.stringify({ owner }) }),
  photoConfirm: (owner: string, id: string) => call<{ id: string }>('/me/photos', { method: 'POST', body: JSON.stringify({ owner, id }) }),
  photoCover: (id: string) => call<{ id: string }>(`/me/photos/${id}`, { method: 'PUT' }),
  photoFocus: (id: string, focus: number) => call<{ id: string }>(`/me/photos/${id}`, { method: 'PUT', body: JSON.stringify({ focus }) }),
  deletePhoto: (id: string) => call<{ id: string }>(`/me/photos/${id}`, { method: 'DELETE' }),
  saveRatings: (ratings: { utr?: number | null; ntrp?: number | null }) =>
    call<{ utr: number | null; ntrp: number | null }>('/me/ratings', { method: 'PUT', body: JSON.stringify(ratings) }),
  saveCalendar: (url: string) => call<{ connected: boolean }>('/me/calendar', { method: 'PUT', body: JSON.stringify({ url }) }),
  syncWtn: () => call<{ started: boolean }>('/me/wtn-sync', { method: 'POST' }),
  pushStatus: (endpoint: string) => call<{ devices: number; thisDevice: boolean }>(`/me/push?endpoint=${encodeURIComponent(endpoint)}`),
  pushOn: (subscription: PushSubscriptionJSON, timeZone: string) => call<{ devices: number }>('/me/push', { method: 'PUT', body: JSON.stringify({ ...subscription, timeZone }) }),
  pushOff: (endpoint: string) => call<{ devices: number }>('/me/push', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  pushTest: (endpoint: string) => call<{ sent: number }>('/me/push/test', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  widgetStatus: () => call<{ enabled: boolean }>('/me/widget'),
  widgetNew: () => call<{ enabled: boolean; token: string }>('/me/widget', { method: 'POST' }),
  widgetOff: () => call<{ enabled: boolean }>('/me/widget', { method: 'DELETE' }),
  addMatch: (m: MatchInput) => call<{ id: string }>('/me/matches', { method: 'POST', body: JSON.stringify(m) }),
  editMatch: (id: string, m: MatchInput) => call<{ id: string }>(`/me/matches/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(m) }),
  deleteMatch: (id: string) => call<{ id: string }>(`/me/matches/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveExtras: (id: string, note: string, starred: boolean) =>
    call<{ note: string; starred: boolean }>(`/me/matches/${encodeURIComponent(id)}/extras`, {
      method: 'PUT',
      body: JSON.stringify({ note, starred }),
    }),
};
