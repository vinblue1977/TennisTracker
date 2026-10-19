// Pure helpers that turn API data into what the screens show.
import type { Match, Player, Profile, Rating } from './types';

export interface Point {
  date: string;
  value: number;
  confidence: number | null;
}

export const matchDate = (m: Match) => m.SK.split('#')[1] ?? '';

/** Doubles ratings oldest first, from a month before the first match (drops WTN's old starting estimate). */
export function ratingHistory(ratings: Rating[], matches: Match[]): Point[] {
  const first = matches.map(matchDate).sort()[0];
  const from = first ? shiftDays(first, -31) : '';
  return ratings
    .filter((r) => r.SK.startsWith('RATING#WTN#DOUBLE#'))
    .map((r) => ({ date: r.SK.split('#')[3] ?? '', value: r.value, confidence: r.confidence }))
    .filter((p) => p.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Latest rating and how much better it is than the previous different value (WTN: lower is better). */
export function latest(points: Point[]): { point: Point; better: number | null } | null {
  const point = points.at(-1);
  if (!point) return null;
  const previous = [...points].reverse().find((p) => p.value !== point.value);
  return { point, better: previous ? round2(previous.value - point.value) : null };
}

export function record(matches: Match[]): { wins: number; losses: number } {
  return {
    wins: matches.filter((m) => m.won === true).length,
    losses: matches.filter((m) => m.won === false).length,
  };
}

export interface Form {
  /** Last results, oldest first. */
  last: boolean[];
  /** Current run: positive = wins in a row, negative = losses in a row, 0 = no matches. */
  streak: number;
  longestWin: number;
  /** Record over the last 10 matches. */
  recent: { wins: number; losses: number };
}

/** Form from played matches, whatever their order. */
export function form(matches: Match[], show = 5): Form {
  const results = matches
    .filter((m) => m.won !== null)
    .sort((a, b) => matchDate(a).localeCompare(matchDate(b)))
    .map((m) => m.won === true);
  let streak = 0;
  let run = 0;
  let longestWin = 0;
  for (const won of results) {
    run = won ? Math.max(run, 0) + 1 : Math.min(run, 0) - 1;
    streak = run;
    longestWin = Math.max(longestWin, run);
  }
  const ten = results.slice(-10);
  const wins = ten.filter(Boolean).length;
  return { last: results.slice(-show), streak, longestWin, recent: { wins, losses: ten.length - wins } };
}

/** The first rating on or after the match date: your WTN after that match. */
export function wtnAfter(points: Point[], m: Match): number | null {
  return points.find((p) => p.date >= matchDate(m))?.value ?? null;
}

export function teamAverage(players: Player[]): number | null {
  const values = players.map((p) => p.wtn);
  if (!values.length || values.some((v) => v === null)) return null;
  return round2((values as number[]).reduce((a, b) => a + b, 0) / values.length);
}

/** "Michael Smith" -> "Michael S." */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts.at(-1) : undefined;
  return last ? `${parts.slice(0, -1).join(' ')} ${last[0]}.` : (parts[0] ?? '');
}

export function formatDate(iso: string, withYear = false): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "9:00pm" in the phone's time zone. */
export function formatTime(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

/** "Fri 16 Oct · 9:00pm" in the phone's time zone; all-day events show just the day. */
export function formatWhen(startIso: string, allDay: boolean): string {
  const d = new Date(startIso);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(allDay ? { timeZone: 'UTC' } : {}) });
  return allDay ? day : `${day} · ${formatTime(d)}`;
}

/** "Today", "Tomorrow" or "" for a start time, in the phone's time zone. */
export function relativeDay(startIso: string, now = new Date()): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(new Date(startIso)) - day(now)) / 86_400_000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : '';
}

export interface Tally {
  name: string;
  wins: number;
  losses: number;
}

/** Played doubles matches only (no singles, no unfinished). */
export const playedDoubles = (matches: Match[]) => matches.filter((m) => m.kind === 'DOUBLE' && m.won !== null);

export const winPct = ({ wins, losses }: { wins: number; losses: number }) => (wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0);

/** Record per year, oldest first. */
export function byYear(matches: Match[]): (Tally & { year: string })[] {
  const years = [...new Set(matches.map((m) => matchDate(m).slice(0, 4)))].sort();
  return years.map((year) => ({ year, name: year, ...record(matches.filter((m) => matchDate(m).startsWith(year))) }));
}

/** Record against or with each person, most matches first. Keyed by short name, so the spreadsheet's "Kesavan J" and WTN's full name are one person. */
export function tally(matches: Match[], who: (m: Match) => Player[]): Tally[] {
  const rows = new Map<string, Tally>();
  for (const m of matches) {
    for (const player of who(m)) {
      const name = shortName(player.name);
      const row = rows.get(name) ?? { name, wins: 0, losses: 0 };
      if (m.won) row.wins++;
      else row.losses++;
      rows.set(name, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.wins + b.losses - (a.wins + a.losses) || b.wins - a.wins || a.name.localeCompare(b.name));
}

/** One CSV row per match, oldest first. Cells that start like a formula get a leading ' so spreadsheets don't run them. */
export function matchesCsv(matches: Match[]): string {
  const cell = (v: string | number | boolean | null) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^\s*[=+\-@]|^[\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const names = (players: Player[]) => players.map((p) => p.name).join(' / ');
  const rows = [...matches]
    .sort((a, b) => a.SK.localeCompare(b.SK))
    .map((m) => [matchDate(m), m.event, m.kind, m.won === null ? '' : m.won ? 'Win' : 'Loss', m.score, names(m.partners), names(m.opponents), m.starred ? 'yes' : '', m.note]);
  return [['Date', 'Event', 'Kind', 'Result', 'Score', 'Partners', 'Opponents', 'Best match', 'Note'], ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export interface HealthRow {
  label: string;
  value: string;
  ok: boolean;
}

const HOUR = 3_600_000;

/** "5 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string, now = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} min ago`;
  if (ms < 48 * HOUR) return `${Math.round(ms / HOUR)} h ago`;
  return `${Math.round(ms / (24 * HOUR))} days ago`;
}

/** Are the syncs alive? WTN runs Wed and Thu (so over 8 days is late); the calendar runs every 15 minutes (over 1 hour is late). */
export function syncHealth(profile: Profile, matches: Match[], now = new Date()): HealthRow[] {
  const age = (iso?: string) => (iso ? now.getTime() - new Date(iso).getTime() : Infinity);
  const row = (label: string, s: { status?: string; lastRunAt?: string; consecutiveFailures?: number }, lateHours: number): HealthRow => {
    const failing = s.status === 'error';
    const late = age(s.lastRunAt) > lateHours * HOUR;
    const when = s.lastRunAt ? ago(s.lastRunAt, now) : 'never';
    const note = failing ? ` · failing (${s.consecutiveFailures ?? 1} in a row)` : late ? ' · late' : '';
    return { label, value: when + note, ok: !failing && !late };
  };
  const rows = [row('WTN sync', profile.sync, 8 * 24)];
  if (profile.calendar?.connected) rows.push(row('Calendar sync', profile.calendar, 1));
  const last = matches.map(matchDate).sort().at(-1);
  rows.push({ label: 'Last match seen', value: last ? new Date(`${last}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'none yet', ok: true });
  return rows;
}
