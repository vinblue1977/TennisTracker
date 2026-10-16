// Written by the deploy next to the app: this stack's API and sign-in settings.
export interface Config {
  apiUrl: string;
  authUrl: string;
  clientId: string;
}

export async function loadConfig(): Promise<Config> {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('App settings are missing. Please try again later.');
  return res.json();
}
