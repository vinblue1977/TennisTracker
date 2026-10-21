import { readConfig, saveConfig } from './offline';

// Written by the deploy next to the app: this stack's API and sign-in settings.
export interface Config {
  apiUrl: string;
  authUrl: string;
  clientId: string;
  vapidPublicKey?: string;
}

export async function loadConfig(): Promise<Config> {
  let res: Response;
  try {
    res = await fetch('/config.json', { cache: 'no-store' });
  } catch (e) {
    const kept = readConfig(); // offline: the settings from the last visit
    if (kept) return kept;
    throw e;
  }
  if (!res.ok) throw new Error('App settings are missing. Please try again later.');
  const config: Config = await res.json();
  saveConfig(config);
  return config;
}
