import { describe, expect, it } from 'vitest';

import { ago, byYear, matchesBehind, syncHealth, form, matchesCsv, formatTime, latest, playedDoubles, tally, winPct, ratingHistory, record, relativeDay, shortName, recap, teamAverage, wtnAfter } from './data';
import type { Match, Rating } from './types';

const match = (date: string, won: boolean | null): Match => ({
  id: `wtn:${date}`,
  SK: `MATCH#${date}#wtn:${date}`,
  event: 'Test League',
  kind: 'DOUBLE',
  won,
  score: '6-4 6-4',
  status: 'COMPLETED',
  partners: [],
  opponents: [],
  upsetGap: null,
  source: 'WTN',
  note: '',
  starred: false,
});
const rating = (date: string, value: number, kind = 'DOUBLE'): Rating => ({ SK: `RATING#WTN#${kind}#${date}`, value, confidence: 80 });

const matches = [match('2025-01-10', true), match('2025-03-01', false), match('2025-04-01', null)];
const ratings = [rating('2010-01-01', 29.1), rating('2025-01-13', 27.0), rating('2025-03-03', 26.5), rating('2025-03-10', 26.5), rating('2025-02-01', 20, 'SINGLE')];

describe('ratingHistory', () => {
  it('keeps doubles from about a month before the first match, oldest first', () => {
    expect(ratingHistory(ratings, matches).map((p) => p.date)).toEqual(['2025-01-13', '2025-03-03', '2025-03-10']);
  });
});

describe('latest', () => {
  it('compares with the previous different value (lower is better)', () => {
    expect(latest(ratingHistory(ratings, matches))).toMatchObject({ point: { value: 26.5 }, better: 0.5 });
  });
  it('handles no ratings', () => {
    expect(latest([])).toBeNull();
  });
});

describe('record', () => {
  it('counts wins and losses, not matches without a winner', () => {
    expect(record(matches)).toEqual({ wins: 1, losses: 1 });
  });
});

describe('wtnAfter', () => {
  it('uses the first rating on or after the match', () => {
    const points = ratingHistory(ratings, matches);
    expect(wtnAfter(points, match('2025-03-01', false))).toBe(26.5);
    expect(wtnAfter(points, match('2026-01-01', true))).toBeNull();
  });
});

describe('teamAverage and shortName', () => {
  it('averages only when every rating is known', () => {
    expect(teamAverage([{ name: 'A', wtn: 27.95 }, { name: 'B', wtn: 26.16 }])).toBe(27.06);
    expect(teamAverage([{ name: 'A', wtn: 27 }, { name: 'B', wtn: null }])).toBeNull();
  });
  it('shortens surnames', () => {
    expect(shortName('Pat Partner')).toBe('Pat P.');
    expect(shortName('Juan Pablo Example')).toBe('Juan Pablo E.');
    expect(shortName('Solo')).toBe('Solo');
  });
});

describe('relativeDay', () => {
  it('says Today and Tomorrow in local time, else nothing', () => {
    const now = new Date(2026, 9, 16, 10, 0);
    expect(relativeDay(new Date(2026, 9, 16, 21, 0).toISOString(), now)).toBe('Today');
    expect(relativeDay(new Date(2026, 9, 17, 9, 0).toISOString(), now)).toBe('Tomorrow');
    expect(relativeDay(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toBe('');
  });
});

describe('formatTime', () => {
  it('uses 12-hour time like 9:00pm', () => {
    expect(formatTime(new Date(2026, 9, 16, 21, 0))).toBe('9:00pm');
    expect(formatTime(new Date(2026, 9, 16, 0, 5))).toBe('12:05am');
    expect(formatTime(new Date(2026, 9, 16, 12, 30))).toBe('12:30pm');
  });
});

describe('form', () => {
  const run = (...results: boolean[]) => results.map((won, i) => match(`2025-01-${String(i + 1).padStart(2, '0')}`, won));
  it('finds the current win streak and the longest', () => {
    const f = form(run(true, true, true, true, false, true, true));
    expect(f.streak).toBe(2);
    expect(f.longestWin).toBe(4);
  });
  it('counts a losing run as negative', () => {
    expect(form(run(true, false, false)).streak).toBe(-2);
  });
  it('shows the last 5 oldest first and the last 10 record, ignoring unplayed and order', () => {
    const f = form([...run(true, true, false, true, true, true, false, true, true, true, true, false), match('2025-02-01', null)].reverse());
    expect(f.last).toEqual([true, true, true, true, false]);
    expect(f.recent).toEqual({ wins: 7, losses: 3 });
  });
  it('handles no matches', () => {
    expect(form([])).toEqual({ last: [], streak: 0, longestWin: 0, recent: { wins: 0, losses: 0 } });
  });
});

describe('stats', () => {
  const p = (name: string) => ({ name, wtn: null });
  const m = (date: string, won: boolean | null, partner: string, opp: string, kind: Match['kind'] = 'DOUBLE'): Match => ({ ...match(date, won), kind, partners: [p(partner)], opponents: [p(opp)] });
  const all = [m('2024-05-01', true, 'Ann', 'Bo'), m('2024-06-01', false, 'Ann', 'Bo'), m('2025-01-01', true, 'Cy', 'Bo'), m('2025-02-01', true, 'Ann', 'Di', 'SINGLE'), m('2025-03-01', null, 'Ann', 'Bo')];

  it('keeps only played doubles', () => {
    expect(playedDoubles(all)).toHaveLength(3);
  });
  it('counts per year, oldest first', () => {
    expect(byYear(playedDoubles(all)).map((y) => [y.year, y.wins, y.losses])).toEqual([['2024', 1, 1], ['2025', 1, 0]]);
  });
  it('tallies people, most matches first', () => {
    expect(tally(playedDoubles(all), (x) => x.partners)).toEqual([{ name: 'Ann', wins: 1, losses: 1 }, { name: 'Cy', wins: 1, losses: 0 }]);
    expect(tally(playedDoubles(all), (x) => x.opponents)).toEqual([{ name: 'Bo', wins: 2, losses: 1 }]);
  });
  it('merges one person written two ways', () => {
    const two = [m('2024-05-01', true, 'Kesavan J', 'Bo'), m('2024-06-01', false, 'Kesavan Jones', 'Bo')];
    expect(tally(two, (x) => x.partners)).toEqual([{ name: 'Kesavan J.', wins: 1, losses: 1 }]);
  });
  it('rounds win %', () => {
    expect(winPct({ wins: 2, losses: 1 })).toBe(67);
    expect(winPct({ wins: 0, losses: 0 })).toBe(0);
  });
});

describe('matchesCsv', () => {
  it('writes a header, oldest first, quoting commas and neutralising formulas', () => {
    const a = { ...match('2026-02-01', true), note: '=1+1', partners: [{ name: 'Ann', wtn: 20 }] };
    const b = { ...match('2026-01-01', false), event: 'Club, Night' };
    const lines = matchesCsv([a, b]).trim().split('\r\n');
    expect(lines[0]).toBe('Date,Event,Kind,Result,Score,Partners,Opponents,Best match,Note');
    expect(lines[1]).toBe('2026-01-01,"Club, Night",DOUBLE,Loss,6-4 6-4,,,,');
    expect(lines[2]).toBe("2026-02-01,Test League,DOUBLE,Win,6-4 6-4,Ann,,,'=1+1");
  });
});

describe('syncHealth', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const match = { SK: 'MATCH#2026-10-14#x' } as Match;
  it('says ago in minutes, hours and days', () => {
    expect(ago('2026-10-19T11:50:00Z', now)).toBe('10 min ago');
    expect(ago('2026-10-19T07:00:00Z', now)).toBe('5 h ago');
    expect(ago('2026-10-15T12:00:00Z', now)).toBe('4 days ago');
  });
  it('is all ok when both syncs ran recently', () => {
    const rows = syncHealth({ tennisId: null, calendar: { connected: true, status: 'ok', lastRunAt: '2026-10-19T11:50:00Z' }, sync: { status: 'ok', lastRunAt: '2026-10-15T11:00:00Z' } }, [match], now);
    expect(rows.map((r) => r.ok)).toEqual([true, true, true, true]);
    expect(rows[3]?.value).toBe('14 Oct 2026');
  });
  it('flags failing and late syncs', () => {
    const rows = syncHealth({ tennisId: null, calendar: { connected: true, status: 'ok', lastRunAt: '2026-10-19T08:00:00Z' }, sync: { status: 'error', lastRunAt: '2026-10-19T11:00:00Z', consecutiveFailures: 2 } }, [], now);
    expect(rows[0]).toMatchObject({ ok: false, value: '1 h ago · failing (2 in a row)' });
    expect(rows[1]).toMatchObject({ ok: false, value: '4 h ago · late' });
    expect(rows[3]?.value).toBe('none yet');
  });
  it('skips the calendar when it is not connected and flags a never-run WTN sync', () => {
    const rows = syncHealth({ tennisId: null, sync: {} }, [], now);
    expect(rows.map((r) => r.label)).toEqual(['WTN sync', 'Weekly backup', 'Last match seen']);
    expect(rows[0]).toMatchObject({ ok: false, value: 'never · late' });
  });
});

describe('matchesBehind', () => {
  const pt = (date: string) => ({ date, value: 25, confidence: null });
  const m = (date: string, won: boolean | null) => ({ id: date, SK: `MATCH#${date}#x`, won }) as Match;
  it('assigns each played match to the first rating on or after it, and keeps newer ones pending', () => {
    const points = [pt('2026-09-21'), pt('2026-09-28'), pt('2026-10-05')];
    const { byDate, pending } = matchesBehind(points, [m('2026-09-20', true), m('2026-09-28', false), m('2026-10-02', true), m('2026-10-12', true), m('2026-10-14', null)]);
    expect(byDate.get('2026-09-21')?.map((x) => x.id)).toEqual(['2026-09-20']);
    expect(byDate.get('2026-09-28')?.map((x) => x.id)).toEqual(['2026-09-28']);
    expect(byDate.get('2026-10-05')?.map((x) => x.id)).toEqual(['2026-10-02']);
    expect(pending.map((x) => x.id)).toEqual(['2026-10-12']);
  });
});

describe('syncHealth backup row', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  it('waits for the first backup, then flags one that is over 8 days old', () => {
    expect(syncHealth({ tennisId: null, sync: { status: 'ok', lastRunAt: now.toISOString() } }, [], now)[1]).toMatchObject({ ok: true, value: 'first one runs Sunday' });
    const old = syncHealth({ tennisId: null, sync: { status: 'ok', lastRunAt: now.toISOString() }, backup: { lastRunAt: '2026-10-05T06:00:00Z' } }, [], now)[1];
    expect(old).toMatchObject({ ok: false, value: '14 days ago · late' });
  });
});

describe('recap', () => {
  const m = (date: string, won: boolean, partner: string, upsetGap: number | null = null): Match => ({ ...match(date, won), partners: [{ name: partner, wtn: null }], upsetGap });
  const data = {
    matches: [m('2025-05-01', true, 'Ann'), m('2025-05-02', true, 'Ann', 0.8), m('2025-06-01', false, 'Bob'), m('2025-06-02', true, 'Bob'), m('2024-01-01', true, 'Cy')],
    ratings: [rating('2024-06-01', 27), rating('2025-02-01', 26), rating('2025-07-01', 25)],
    trophies: { trophies: [{ id: 't', event: 'E', date: '2025-05-02', result: 'winner' as const, note: '' }], suggestions: [] },
  };
  it('summarises one year', () => {
    const r = recap(data, '2025');
    expect(r).toMatchObject({ wins: 3, losses: 1, events: 1, longestWin: 2, winners: 1, finalists: 0, wtn: { from: 27, to: 25 } });
    expect(r.partner).toMatchObject({ name: 'Ann', wins: 2, pct: 100 });
    expect(r.upset).toEqual({ gap: 0.8, partner: 'Ann', date: '2025-05-02' });
  });
  it('has no partner or upset when none qualify', () => {
    expect(recap(data, '2024')).toMatchObject({ partner: null, upset: null, wtn: null });
  });
});
