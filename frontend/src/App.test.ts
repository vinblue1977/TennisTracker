import { describe, expect, it } from 'vitest';

import { safeDecode, splitMatchId } from './App';

describe('safeDecode', () => {
  it('decodes match ids and survives malformed links', () => {
    expect(safeDecode('wtn%3Am1')).toBe('wtn:m1');
    expect(safeDecode('%E0')).toBe('%E0');
  });
});

describe('splitMatchId', () => {
  const matches = [{ id: 'wtn:new' }, { id: 'wtn:old' }];
  it('shows the opened match, else the newest, only on the Matches screens', () => {
    expect(splitMatchId('#/match/wtn%3Aold', matches)).toBe('wtn:old');
    expect(splitMatchId('#/matches', matches)).toBe('wtn:new');
    expect(splitMatchId('#/matches', [])).toBeNull();
    expect(splitMatchId('#/me', matches)).toBeNull();
  });
});
