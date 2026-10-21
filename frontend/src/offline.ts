// Offline read-only mode: the last loaded data (and app settings) are kept on the phone and shown when the network fails.
import type { Config } from './config';
import type { Data } from './types';

const SNAPSHOT = 'tt.snapshot';
const CONFIG = 'tt.config';

type Snapshot = Omit<Data, 'vapidKey' | 'offlineAt'>;

function store<T>(fn: (ls: Storage) => T): T | null {
  try {
    return fn(localStorage);
  } catch {
    return null; // storage blocked or full: just no offline copy
  }
}

/** Photo links expire after 15 minutes, so they are not kept. */
export const saveSnapshot = (data: Snapshot) =>
  store((ls) => ls.setItem(SNAPSHOT, JSON.stringify({ at: Date.now(), data: { ...data, photos: [] } })));

export function readSnapshot(): { at: number; data: Snapshot } | null {
  return store((ls) => {
    const found = JSON.parse(ls.getItem(SNAPSHOT) ?? 'null');
    return found && typeof found.at === 'number' && found.data ? found : null;
  });
}

export const saveConfig = (config: Config) => store((ls) => ls.setItem(CONFIG, JSON.stringify(config)));
export const readConfig = (): Config | null => store((ls) => JSON.parse(ls.getItem(CONFIG) ?? 'null'));

/** Signing out removes what was kept, so a shared phone shows nothing. */
export const clearOffline = () =>
  store((ls) => {
    ls.removeItem(SNAPSHOT);
    ls.removeItem(CONFIG);
  });
