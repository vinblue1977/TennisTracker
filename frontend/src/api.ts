import { getAccessToken } from './auth';
import type { Config } from './config';
import type { Match, Profile, Rating, Upcoming } from './types';

let base = '';

export function initApi(config: Config): void {
  base = config.apiUrl;
}

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
  saveCalendar: (url: string) => call<{ connected: boolean }>('/me/calendar', { method: 'PUT', body: JSON.stringify({ url }) }),
  pushStatus: (endpoint: string) => call<{ devices: number; thisDevice: boolean }>(`/me/push?endpoint=${encodeURIComponent(endpoint)}`),
  pushOn: (subscription: PushSubscriptionJSON, timeZone: string) => call<{ devices: number }>('/me/push', { method: 'PUT', body: JSON.stringify({ ...subscription, timeZone }) }),
  pushOff: (endpoint: string) => call<{ devices: number }>('/me/push', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  pushTest: (endpoint: string) => call<{ sent: number }>('/me/push/test', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  saveExtras: (id: string, note: string, starred: boolean) =>
    call<{ note: string; starred: boolean }>(`/me/matches/${encodeURIComponent(id)}/extras`, {
      method: 'PUT',
      body: JSON.stringify({ note, starred }),
    }),
};
