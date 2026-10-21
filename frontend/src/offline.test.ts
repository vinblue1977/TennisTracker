import { beforeEach, describe, expect, it } from 'vitest';

import { clearOffline, readConfig, readSnapshot, saveConfig, saveSnapshot } from './offline';
import type { Data } from './types';

const memory = () => {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
};

describe('offline copy', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: memory(), configurable: true });
  });

  it('keeps the data without photo links, and clears on sign-out', () => {
    expect(readSnapshot()).toBeNull();
    const data = { matches: [], photos: [{ id: 'p1' }] } as unknown as Omit<Data, 'vapidKey' | 'offlineAt'>;
    saveSnapshot(data);
    const kept = readSnapshot();
    expect(kept?.data.photos).toEqual([]);
    expect(kept?.at).toBeGreaterThan(0);
    saveConfig({ apiUrl: 'a', authUrl: 'b', clientId: 'c' });
    expect(readConfig()?.apiUrl).toBe('a');
    clearOffline();
    expect(readSnapshot()).toBeNull();
    expect(readConfig()).toBeNull();
  });

  it('survives blocked storage', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } },
      configurable: true,
    });
    expect(() => saveSnapshot({} as never)).not.toThrow();
    expect(readSnapshot()).toBeNull();
  });
});
