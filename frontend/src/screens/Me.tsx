import { useState } from 'preact/hooks';

import { addPasskeyUrl, currentEmail, logout } from '../auth';
import { Notifications } from '../components/Notifications';
import { formatTime } from '../data';
import type { Data } from '../types';

export function Me({ data, onCalendar }: { data: Data; onCalendar: (url: string) => Promise<void> }) {
  const sync = data.profile.sync;
  const calendar = data.profile.calendar;
  const [link, setLink] = useState('');
  const [status, setStatus] = useState('');
  const save = async (url: string) => {
    setStatus(url ? 'Connecting…' : 'Disconnecting…');
    try {
      await onCalendar(url);
      setLink('');
      setStatus(url ? 'Connected' : 'Disconnected');
    } catch {
      setStatus('That link did not work. Use the public link of an iCloud calendar.');
    }
  };
  const runAt = sync.lastRunAt ? new Date(sync.lastRunAt) : null; // date and time both in the phone's time zone
  const lastRun = runAt ? `${runAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} at ${formatTime(runAt)}` : 'never';
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
      <Notifications vapidKey={data.vapidKey ?? ''} />
      <section class="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span class="eyebrow">Tennis calendar</span>
        {calendar?.connected ? (
          <>
            <span>
              Connected · {calendar.upcoming ?? 0} upcoming{calendar.status === 'error' ? ' · last sync failed' : ''}
            </span>
            <button class="button quiet" type="button" onClick={() => save('')}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span class="muted">Public link from iCloud Calendar</span>
              <input type="url" inputMode="url" autoComplete="off" placeholder="webcal://…" value={link} onInput={(e) => setLink(e.currentTarget.value)} />
            </label>
            <button class="button" type="button" disabled={!link.trim()} onClick={() => save(link.trim())}>
              Connect calendar
            </button>
          </>
        )}
        <span class="muted" role="status">
          {status}
        </span>
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
