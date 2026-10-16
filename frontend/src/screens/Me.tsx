import { addPasskeyUrl, currentEmail, logout } from '../auth';
import type { Data } from '../types';

export function Me({ data }: { data: Data }) {
  const sync = data.profile.sync;
  const lastRun = sync.lastRunAt ? new Date(sync.lastRunAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
  return (
    <main class="screen">
      <h1 class="title">Me</h1>
      <section class="list">
        <div class="item eyebrow" style={{ minHeight: '40px' }}>
          World Tennis Number
        </div>
        <div class="item">
          <span class="grow">TennisID</span>
          <span style={{ fontWeight: 600 }}>{data.profile.tennisId ?? 'not set'}</span>
        </div>
        <div class="item">
          <span class="grow">Last sync</span>
          <span style={{ fontWeight: 600, color: sync.status === 'ok' ? 'var(--win-text)' : 'var(--loss-text)' }}>
            {lastRun} · {sync.status ?? '–'}
          </span>
        </div>
      </section>
      <section class="list">
        <div class="item">
          <span class="grow">Signed in</span>
          <span class="muted ellipsis">{currentEmail()}</span>
        </div>
        <a class="item" href={addPasskeyUrl()}>
          Add a passkey on this device
        </a>
        <button class="item" type="button" style={{ width: '100%', border: 0, background: 'none', color: 'var(--loss-text)', fontWeight: 600, cursor: 'pointer' }} onClick={logout}>
          Sign out
        </button>
      </section>
    </main>
  );
}
