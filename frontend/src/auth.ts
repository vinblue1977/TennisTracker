// Cognito managed login with authorization code + PKCE (ported from the Stocks app).
// Tokens live in localStorage (stay signed in across restarts); the PKCE verifier is kept in localStorage by state for 10 minutes.
import type { Config } from './config';

const STORE = 'tt.tokens';
const PKCE = 'tt.pkce.';
const PKCE_TTL = 10 * 60 * 1000;
const RETRY = 'tt.retry';
const RETRY_WINDOW = 2 * 60 * 1000;

interface Tokens {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_at: number;
}

let refreshing: Promise<Parameters<typeof save>[0]> | undefined; // single-flight refresh
let cfg: Config | undefined; // set by initAuth (not in dev demo mode)

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (len = 32) => b64url(crypto.getRandomValues(new Uint8Array(len)));
const redirectUri = () => `${location.origin}/`;

function authUrl(path: string, params: Record<string, string>): string {
  if (!cfg) return '#';
  const url = new URL(`${cfg.authUrl}${path}`);
  url.search = new URLSearchParams({ client_id: cfg.clientId, ...params }).toString();
  return url.toString();
}

function local<T>(fn: (ls: Storage) => T): T | null {
  try {
    return fn(localStorage);
  } catch {
    return null;
  }
}

function readPkce(ls: Storage, key: string): { verifier: string; at: number } | null {
  try {
    return JSON.parse(ls.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function putPkce(state: string, verifier: string): void {
  local((ls) => {
    for (const key of Object.keys(ls)) {
      if (key.startsWith(PKCE) && !((readPkce(ls, key)?.at ?? 0) > Date.now() - PKCE_TTL)) ls.removeItem(key);
    }
    ls.setItem(PKCE + state, JSON.stringify({ verifier, at: Date.now() }));
  });
}

function takePkce(state: string): string | null {
  return local((ls) => {
    const record = readPkce(ls, PKCE + state);
    ls.removeItem(PKCE + state);
    return record && record.at > Date.now() - PKCE_TTL ? record.verifier : null;
  });
}

function load(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? 'null');
  } catch {
    return null;
  }
}

function save(t: { access_token: string; id_token?: string; refresh_token?: string; expires_in?: number }): void {
  const prev = load();
  const tokens: Tokens = {
    access_token: t.access_token,
    id_token: t.id_token,
    refresh_token: t.refresh_token ?? prev?.refresh_token,
    expires_at: Date.now() + (t.expires_in ?? 3600) * 1000,
  };
  try {
    localStorage.setItem(STORE, JSON.stringify(tokens));
  } catch {
    /* storage blocked: the session just won't persist */
  }
}

async function tokenRequest(params: Record<string, string>) {
  if (!cfg) throw new Error('Not configured');
  const res = await fetch(`${cfg.authUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, ...params }),
  });
  if (!res.ok) throw Object.assign(new Error(`Sign-in failed (${res.status}). Please try again.`), { status: res.status });
  return res.json();
}

export async function login(): Promise<void> {
  const verifier = randomString(48);
  const state = randomString(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  putPkce(state, verifier);
  location.assign(
    authUrl('/oauth2/authorize', {
      response_type: 'code',
      redirect_uri: redirectUri(),
      scope: 'openid email',
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    }),
  );
}

export const addPasskeyUrl = () => authUrl('/passkeys/add', { redirect_uri: redirectUri() });

export function logout(): void {
  try {
    sessionStorage.removeItem(STORE); // legacy location
  } catch {
    /* ignore */
  }
  localStorage.removeItem(STORE);
  location.assign(authUrl('/logout', { logout_uri: redirectUri() }));
}

/** True when signed in; otherwise starts the redirect to the sign-in page. */
export async function initAuth(config: Config): Promise<boolean> {
  cfg = config;
  const params = new URLSearchParams(location.search);
  if (params.has('code')) {
    history.replaceState(null, '', `${location.pathname}${location.hash || '#/'}`);
    try {
      const state = params.get('state');
      const verifier = state ? takePkce(state) : null;
      if (!verifier && load()) return true; // an old callback URL while signed in
      if (!verifier) throw new Error('Sign-in could not be verified. Please try again.');
      save(
        await tokenRequest({ grant_type: 'authorization_code', code: params.get('code') ?? '', redirect_uri: redirectUri(), code_verifier: verifier }),
      );
      local((ls) => ls.removeItem(RETRY));
      return true;
    } catch (e) {
      // Retry once (Cognito's session usually makes it instant); a second failure within 2 minutes shows the error.
      const retried = Number(local((ls) => ls.getItem(RETRY))) > Date.now() - RETRY_WINDOW;
      if (!retried && local((ls) => (ls.setItem(RETRY, String(Date.now())), true))) {
        await login();
        return false;
      }
      local((ls) => ls.removeItem(RETRY));
      throw e;
    }
  }
  if (params.has('error')) {
    history.replaceState(null, '', location.pathname);
    if (load()) return true; // e.g. a cancelled passkey registration
    throw new Error(params.get('error_description') || 'Sign-in was cancelled.');
  }
  if (load()) return true;
  await login();
  return false;
}

export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  const tokens = load();
  if (!tokens) {
    await login();
    return null;
  }
  if (forceRefresh || Date.now() > tokens.expires_at - 60_000) {
    if (!tokens.refresh_token) {
      await login();
      return null;
    }
    try {
      refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }).finally(() => (refreshing = undefined));
      save(await refreshing);
    } catch (e) {
      // Only a rejected refresh token ends the session; a network blip keeps it.
      const status = (e as { status?: number }).status ?? 0;
      if (status < 400 || status >= 500) throw e;
      localStorage.removeItem(STORE);
      await login();
      return null;
    }
  }
  return load()?.access_token ?? null;
}

export function currentEmail(): string {
  const idToken = load()?.id_token;
  if (!idToken) return '';
  try {
    return JSON.parse(atob((idToken.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))).email ?? '';
  } catch {
    return '';
  }
}
