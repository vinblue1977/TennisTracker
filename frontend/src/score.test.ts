import { describe, expect, it } from 'vitest';

import { mySideFirst, winnerFromScore } from './score';

describe('mySideFirst', () => {
  it('keeps a win as written', () => {
    expect(mySideFirst('3-6 7-6 1-0', true)).toBe('3-6 7-6 1-0');
  });

  it('flips every set of a loss', () => {
    expect(mySideFirst('7-5 4-2', false)).toBe('5-7 2-4');
    expect(mySideFirst('2-6 6-4 1-0', false)).toBe('6-2 4-6 0-1');
  });

  it('flips tiebreak sets and their points', () => {
    expect(mySideFirst('7-6(5) 6-4', false)).toBe('6-7(5) 4-6');
    expect(mySideFirst('7-6(7-5) 6-4', false)).toBe('6-7(5-7) 4-6');
  });

  it('keeps words such as def', () => {
    expect(mySideFirst('6-0 6-0 def', false)).toBe('0-6 0-6 def');
  });
});

describe('winnerFromScore', () => {
  it('reads the result from the sets', () => {
    expect(winnerFromScore('6-3 6-4')).toBe(true);
    expect(winnerFromScore('4-6 6-7(5) 6-4')).toBe(false);
    expect(winnerFromScore('7-6(5) 3-6 1-0')).toBe(true);
  });

  it('is null when level or unreadable', () => {
    expect(winnerFromScore('6-3 3-6')).toBeNull();
    expect(winnerFromScore('')).toBeNull();
    expect(winnerFromScore('def')).toBeNull();
  });
});
