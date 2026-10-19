import { useState } from 'preact/hooks';

import { addPasskeyUrl, currentEmail, logout } from '../auth';
import { Collapsible } from '../components/Collapsible';
import { Trophies } from '../components/Trophies';
import { Notifications } from '../components/Notifications';
import { Widget } from '../components/Widget';
import { formatTime, matchesCsv } from '../data';
import type { Data } from '../types';

type Ratings = { utr: number | null; ntrp: number | null };

function Manual({ profile, onSave }: { profile: Data['profile']; onSave: (r: Ratings) => Promise<void> }) {
  const [utr, setUtr] = useState(typeof profile.utr === 'number' ? String(profile.utr) : '');
  const [ntrp, setNtrp] = useState(typeof profile.ntrp === 'number' ? String(profile.ntrp) : '');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const summary = [typeof profile.utr === 'number' ? `UTR ${profile.utr}` : null, typeof profile.ntrp === 'number' ? `NTRP ${profile.ntrp}` : null].filter(Boolean).join(' · ') || 'Tap to add';
  const submit = async () => {
    const num = (text: string) => (text.trim() === '' ? null : /^\d+([.,]\d+)?$/.test(text.trim()) ? Number(text.trim().replace(',', '.')) : NaN);
    const u = num(utr);
    const n = num(ntrp);
    if ((u !== null && !(u >= 1 && u <= 16.5 && Math.abs(u * 100 - Math.round(u * 100)) < 1e-6)) || (n !== null && !(n >= 1 && n <= 7 && n * 2 === Math.round(n * 2)))) {
      setStatus('UTR is 1 to 16.5 with up to 2 decimals. NTRP is 1.0 to 7.0 in halves (e.g. 3.5).');
      return;
    }
    setStatus('Saving…');
    try {
      await onSave({ utr: u, ntrp: n });
      setStatus('');
      setOpen(false);
    } catch {
      setStatus('Could not save. Try again.');
    }
  };
  return (
    <Collapsible title="Other ratings (by hand)" summary={summary} open={open} onToggle={setOpen}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span class="muted">Doubles UTR</span>
        <input type="text" inputMode="decimal" autoComplete="off" placeholder="e.g. 7.25" value={utr} onInput={(e) => setUtr(e.currentTarget.value)} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span class="muted">NTRP</span>
        <input type="text" inputMode="decimal" autoComplete="off" placeholder="e.g. 3.5" value={ntrp} onInput={(e) => setNtrp(e.currentTarget.value)} />
      </label>
      <button class="button" type="button" onClick={submit}>
        Save ratings
      </button>
      <span class="muted" role="status">
        {status}
      </span>
    </Collapsible>
  );
}

type MeProps = {
  data: Data;
  onCalendar: (url: string) => Promise<void>;
  onWtnSync: () => Promise<boolean>;
  onRatings: (r: Ratings) => Promise<void>;
  onTrophies: (change: () => Promise<unknown>) => Promise<void>;
  onPhotos: (change?: () => Promise<unknown>) => Promise<void>;
};

export function Me({ data, onCalendar, onWtnSync, onRatings, onTrophies, onPhotos }: MeProps) {
  const sync = data.profile.sync;
  const calendar = data.profile.calendar;
  const [link, setLink] = useState('');
  const [status, setStatus] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const syncNow = async () => {
    setSyncStatus('Syncing…');
    try {
      setSyncStatus((await onWtnSync()) ? 'Synced' : 'Still working or failed. Check again in a minute.');
    } catch {
      setSyncStatus('Could not start. Try again in a minute.');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob(['\ufeff', matchesCsv(data.matches)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `tennis-matches-${new Date().toLocaleDateString('sv')}.csv`;
    document.body.append(a); // iOS Safari ignores clicks on detached links
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
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
    <main class="screen cols">
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
        <details>
          <summary class="item muted" style={{ cursor: 'pointer' }}>
            Manual sync
          </summary>
          <div class="item">
            <button class="button quiet" type="button" disabled={syncStatus === 'Syncing…'} onClick={syncNow}>
              Sync now
            </button>
            <span class="muted grow" role="status">
              {syncStatus}
            </span>
          </div>
        </details>
      </section>
      <section class="list">
        <a class="item" href="#/stats">
          <span class="grow">Stats</span>
          <span class="muted" aria-hidden="true">›</span>
        </a>
      </section>
      <section class="list">
        <button class="item" type="button" style={{ width: '100%', border: 0, background: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' }} onClick={download}>
          <span class="grow" style={{ textAlign: 'left' }}>Download my matches (CSV)</span>
          <span class="muted" aria-hidden="true">↓</span>
        </button>
      </section>
      <Manual profile={data.profile} onSave={onRatings} />
      <Trophies data={data.trophies} photos={data.photos} onChange={onTrophies} onPhotos={onPhotos} />
      <Notifications vapidKey={data.vapidKey ?? ''} />
      <Widget />
      <Collapsible title="Tennis calendar" summary={calendar?.connected ? `Connected · ${calendar.upcoming ?? 0} upcoming` : 'Not connected'}>
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
      </Collapsible>
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
