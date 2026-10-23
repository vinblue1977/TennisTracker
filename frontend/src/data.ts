// Pure helpers that turn API data into what the screens show.
import type { Data, Match, Player, Profile, Rating, SetScore } from './types';

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

/** Played matches behind each rating (dates in the week since the one before it), plus those WTN has not rated yet. */
export function matchesBehind(points: Point[], matches: Match[]): { byDate: Map<string, Match[]>; pending: Match[] } {
  const played = matches.filter((m) => m.won !== null).sort((a, b) => matchDate(b).localeCompare(matchDate(a)));
  const byDate = new Map<string, Match[]>();
  points.forEach((p, i) => {
    const from = points[i - 1]?.date ?? '';
    byDate.set(p.date, played.filter((m) => matchDate(m) > from && matchDate(m) <= p.date));
  });
  const end = points.at(-1)?.date ?? '';
  return { byDate, pending: played.filter((m) => matchDate(m) > end) };
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

const LEVELS: Record<string, string> = { LOC: 'Local', DIS: 'District', REC: 'Recreational' };
export const levelName = (code: string | null | undefined) => (code ? (LEVELS[code] ?? code) : '');

const SET = /^(\d+)-(\d+)(?:\((\d+)(?:-(\d+))?\))?$/;

/** Sets from the synced data, else read from the score text (your side first) of a match entered by hand. */
export function matchSets(m: Match): SetScore[] {
  if (m.sets?.length) return m.sets;
  const text = (m.score || '').replace(/[–—]/g, '-').replace(/,/g, ' ').replace(/\s+\(/g, '(').trim();
  const sets: SetScore[] = [];
  for (const part of text.split(/\s+/)) {
    const x = SET.exec(part);
    if (!x) return []; // def, ret, notes: don't guess
    const [mine, theirs] = [+(x[1] ?? 0), +(x[2] ?? 0)];
    const set: SetScore = { mine, theirs, tiebreak: x[3] && x[4] ? [+x[3], +x[4]] : null };
    if (x[3] && !x[4]) set.bracket = +x[3]; // one number is ambiguous (loser's or winner's points), so keep it as typed
    sets.push(set);
  }
  return sets;
}

/** The number shown in brackets after a set: the loser's tiebreak points, or a lone number as typed. */
export const tiebreakShown = (s: SetScore): number | null => (s.tiebreak ? Math.min(...s.tiebreak) : (s.bracket ?? null));

/** A match tiebreak ends the match, written 1-0 (WTN) or 10-7; a 1-0 first set is a retirement. */
export const isMatchTiebreak = (s: SetScore, i: number, sets: SetScore[]) =>
  i > 0 && i === sets.length - 1 && (s.mine + s.theirs === 1 || Math.max(s.mine, s.theirs) >= 10);

/** Games and sets from your side. A match tiebreak counts as a set but not as games. */
export function setTotals(sets: SetScore[]): { games: [number, number]; sets: [number, number] } {
  const real = sets.filter((s, i) => !isMatchTiebreak(s, i, sets));
  return {
    games: [real.reduce((n, s) => n + s.mine, 0), real.reduce((n, s) => n + s.theirs, 0)],
    sets: [sets.filter((s) => s.mine > s.theirs).length, sets.filter((s) => s.mine < s.theirs).length],
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
  return { last: results.slice(-show).reverse(), streak, longestWin, recent: { wins, losses: ten.length - wins } };
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

/** "Michael Smith" -> "Michael S" */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts.at(-1) : undefined;
  return last ? `${parts.slice(0, -1).join(' ')} ${last[0]}` : (parts[0] ?? '');
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

/** Are the syncs alive? The calendar runs every 15 minutes (over 1 hour is late). */
export function syncHealth(profile: Profile, matches: Match[], now = new Date()): HealthRow[] {
  const age = (iso?: string) => (iso ? now.getTime() - new Date(iso).getTime() : Infinity);
  const row = (label: string, s: { status?: string; lastRunAt?: string; consecutiveFailures?: number }, lateHours: number): HealthRow => {
    const failing = s.status === 'error';
    const late = age(s.lastRunAt) > lateHours * HOUR;
    const when = s.lastRunAt ? ago(s.lastRunAt, now) : 'never';
    const note = failing ? ` · failing (${s.consecutiveFailures ?? 1} in a row)` : late ? ' · late' : '';
    return { label, value: when + note, ok: !failing && !late };
  };
  const rows: HealthRow[] = [];
  if (profile.calendar?.connected) rows.push(row('Calendar sync', profile.calendar, 1));
  const backedUp = profile.backup?.lastRunAt;
  if (!backedUp) rows.push({ label: 'Weekly backup', value: 'first one runs Sunday', ok: true });
  else rows.push(row('Weekly backup', { status: 'ok', lastRunAt: backedUp }, 8 * 24));
  const last = matches.map(matchDate).sort().at(-1);
  rows.push({ label: 'Last match seen', value: last ? new Date(`${last}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'none yet', ok: true });
  return rows;
}

export interface Recap {
  year: string;
  wins: number;
  losses: number;
  events: number;
  partner: (Tally & { pct: number }) | null;
  upset: { gap: number | null; partner: string; date: string } | null;
  longestWin: number;
  winners: number;
  finalists: number;
  games: { won: number; total: number } | null;
  closestWin: { score: string; date: string } | null;
  wtn: { from: number; to: number } | null;
}

/** Doubles season summary for one year. Best partner needs 2+ matches. */
export function recap(data: Pick<Data, 'matches' | 'ratings' | 'trophies'>, year: string): Recap {
  const played = playedDoubles(data.matches).filter((m) => matchDate(m).startsWith(year));
  const { wins, losses } = record(played);
  const partner = tally(played, (m) => m.partners)
    .filter((t) => t.wins + t.losses >= 2)
    .map((t) => ({ ...t, pct: winPct(t) }))
    .sort((a, b) => b.pct - a.pct || b.wins + b.losses - (a.wins + a.losses))[0];
  const upset = played
    .filter((m) => m.won && m.upsetGap !== null)
    .sort((a, b) => (b.upsetGap ?? 0) - (a.upsetGap ?? 0))[0];
  const scored = played.map((m) => ({ m, g: setTotals(matchSets(m)).games })).filter(({ g }) => g[0] + g[1] > 0);
  const total = scored.reduce((n, { g }) => n + g[0] + g[1], 0);
  const share = ({ g }: (typeof scored)[number]) => g[0] / (g[0] + g[1]);
  const closest = scored
    .filter((x) => x.m.won && x.g[0] + x.g[1] > 0)
    .sort((a, b) => share(a) - share(b) || matchDate(b.m).localeCompare(matchDate(a.m)))[0]?.m;
  const trophies = data.trophies.trophies.filter((t) => t.date.startsWith(year));
  const points = ratingHistory(data.ratings, data.matches);
  const inYear = points.filter((p) => p.date.startsWith(year));
  const start = points.filter((p) => p.date < `${year}-01-01`).at(-1) ?? inYear[0];
  const end = inYear.at(-1);
  return {
    year,
    wins,
    losses,
    events: new Set(played.map((m) => m.event).filter(Boolean)).size,
    partner: partner ?? null,
    upset: upset ? { gap: upset.upsetGap, partner: shortName(upset.partners[0]?.name ?? ''), date: matchDate(upset) } : null,
    longestWin: form(played).longestWin,
    winners: trophies.filter((t) => t.result === 'winner').length,
    finalists: trophies.filter((t) => t.result === 'finalist').length,
    games: total ? { won: scored.reduce((n, { g }) => n + g[0], 0), total } : null,
    closestWin: closest ? { score: closest.score, date: matchDate(closest) } : null,
    wtn: start && end && start !== end ? { from: start.value, to: end.value } : null,
  };
}
