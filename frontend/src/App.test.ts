import { describe, expect, it } from 'vitest';

import { safeDecode } from './App';

describe('safeDecode', () => {
  it('decodes match ids and survives malformed links', () => {
    expect(safeDecode('wtn%3Am1')).toBe('wtn:m1');
    expect(safeDecode('%E0')).toBe('%E0');
  });
});
