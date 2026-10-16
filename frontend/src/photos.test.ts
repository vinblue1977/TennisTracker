import { describe, expect, it } from 'vitest';

import { fitSize, forOwner } from './photos';
import type { Photo } from './types';

describe('fitSize', () => {
  it('scales the long edge down to 1600', () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });
  it('never scales up', () => {
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('forOwner', () => {
  const p = (id: string, owner: string, cover = false): Photo => ({ id, owner, cover, focus: 20, url: `https://x/${id}` });
  it('keeps one owner, cover first', () => {
    const list = [p('p2', 'trophy:a'), p('p1', 'trophy:a'), p('p3', 'trophy:b'), p('p9', 'trophy:a', true)];
    expect(forOwner(list, 'trophy:a').map((x) => x.id)).toEqual(['p9', 'p1', 'p2']);
  });
});
