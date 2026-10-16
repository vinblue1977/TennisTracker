import { describe, expect, it } from 'vitest';

import { latest, ratingHistory, record, relativeDay, shortName, teamAverage, wtnAfter } from './data';
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
