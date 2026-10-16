import { useEffect, useState } from 'preact/hooks';

import { api, apiBase } from '../api';

// Home Screen widget via the Scriptable app. The setup line (addresses and a private token) is shown once.
export function Widget() {
  const [on, setOn] = useState<boolean | null>(null);
  const [setup, setSetup] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.widgetStatus().then((s) => setOn(s.enabled), () => setMessage('Could not check the widget. Turn off still works.'));
  }, []);

  const run = (task: () => Promise<string>) => async () => {
    setMessage('Working…');
    try {
      setMessage(await task());
    } catch (e) {
      setMessage((e as Error).message || 'Something went wrong.');
    }
  };
  const make = run(async () => {
    const { token } = await api.widgetNew();
    setSetup(`${apiBase()} ${token} ${location.origin}`);
    setOn(true);
    return 'Copy this line now. It is shown once.';
  });
  const turnOff = run(async () => {
    await api.widgetOff();
    setSetup('');
    setOn(false);
    return 'Widget turned off.';
  });
  const copy = run(async () => {
    await navigator.clipboard.writeText(setup);
    return 'Copied. Paste it into Scriptable when asked.';
  });

  return (
    <section class="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <span class="eyebrow">Home Screen widget</span>
      <span class="muted" style={{ fontSize: '14px' }}>
        WTN and your next match, with the free Scriptable app. Making a new line stops the old one working.
      </span>
      {setup && (
        <>
          <input type="text" readOnly value={setup} aria-label="Widget setup line" onFocus={(e) => e.currentTarget.select()} />
          <button class="button" type="button" onClick={copy}>
            Copy setup line
          </button>
        </>
      )}
      <div class="grid2">
        <button class="button quiet" type="button" onClick={make}>
          {on === false ? 'Turn on widget' : 'Make a new line'}
        </button>
        {on !== false && (
          <button class="button quiet" type="button" onClick={turnOff}>
            Turn off
          </button>
        )}
      </div>
      <span class="muted" role="status">
        {message}
      </span>
    </section>
  );
}
