import { render } from 'preact';

import './styles.css';
import { App } from './App';

const root = document.getElementById('app');
if (root) render(<App />, root);
