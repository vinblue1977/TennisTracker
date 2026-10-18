import { describe, expect, it } from 'vitest';

import { byYear, matchesCsv, formatTime, latest, playedDoubles, tally, winPct, ratingHistory, record, relativeDay, shortName, teamAverage, wtnAfter } from './data';
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
