import { useEffect, useState } from 'preact/hooks';

import { api } from '../api';

// iPhones support Web Push only in the Home Screen app (iOS 16.4+). Pattern from the Stocks app.
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const installed = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

const subscription = async () => (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() ?? null;

export function Notifications({ vapidKey }: { vapidKey: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!supported()) return;
    subscription()
      .then(async (sub) => {
        if (!sub) return setOn(false);
        const status = await api.pushStatus(sub.endpoint);
        // The phone is subscribed but the server lost it (an earlier save failed): link it again.
        if (!status.thisDevice) await api.pushOn(sub.toJSON(), Intl.DateTimeFormat().resolvedOptions().timeZone);
        setOn(true);
      })
      .catch(() => setOn(false));
  }, []);

  const run = (task: () => Promise<string>) => async () => {
    setMessage('Working…');
    try {
      setMessage(await task());
    } catch (e) {
      setMessage((e as Error).message || 'Something went wrong.');
    }
  };

  const turnOn = run(async () => {
    // Straight from the tap: iOS only shows the permission prompt for a user action.
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
    await api.pushOn(sub.toJSON(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    setOn(true);
    return 'Notifications are on for this iPhone.';
  });
  const test = run(async () => {
    const sub = await subscription();
    if (sub) await api.pushTest(sub.endpoint);
    return 'Test sent. It should arrive in a few seconds.';
  });
  const turnOff = run(async () => {
    const sub = await subscription();
    if (sub) {
      await sub.unsubscribe(); // phone first: a server record left behind is cleaned up on the next send
      await api.pushOff(sub.endpoint).catch(() => undefined);
    }
    setOn(false);
    return 'Notifications are off for this iPhone.';
  });

  let body;
  if (!supported() || !vapidKey) {
    body = <span class="muted">{installed() ? 'This browser can’t receive notifications.' : 'Add the app to your Home Screen first: in Safari tap Share, then Add to Home Screen, and open it from there.'}</span>;
  } else if (Notification.permission === 'denied') {
    body = <span class="muted">Notifications are blocked. Turn them on in Settings › Notifications › Tennis.</span>;
  } else if (on === null) {
    body = <span class="muted">Checking…</span>;
  } else if (on) {
    body = (
      <div class="grid2">
        <button class="button quiet" type="button" onClick={test}>
          Send a test
        </button>
        <button class="button quiet" type="button" onClick={turnOff}>
          Turn off
        </button>
      </div>
    );
  } else {
    body = (
      <button class="button" type="button" onClick={turnOn}>
        Turn on notifications
      </button>
    );
  }
  return (
    <section class="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <span class="eyebrow">Notifications</span>
      <span class="muted" style={{ fontSize: '14px' }}>
        Match reminders (20:00 the evening before, 2 hours before) and WTN changes.
      </span>
      {body}
      <span class="muted" role="status">
        {message}
      </span>
    </section>
  );
}
