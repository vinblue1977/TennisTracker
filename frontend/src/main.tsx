import { render } from 'preact';

import './styles.css';
import { App } from './App';

// Keeps the app's files for offline use (and receives push); registering again is harmless.
if ('serviceWorker' in navigator && !import.meta.env.DEV) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);

const root = document.getElementById('app');
if (root) render(<App />, root);
