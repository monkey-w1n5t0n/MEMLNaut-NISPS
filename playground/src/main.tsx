/* @refresh reload */
import { render } from 'solid-js/web';
import App from './App';
import './styles/tokens.css';
import { installDebugProbe } from './debug/probe';
import { applyUrlParams } from './features/session-preset';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

// Install debug probe early. Playwright tests use it to drive the ML
// engine programmatically.
installDebugProbe();

// Apply URL params (?session=..., ?boldness=..., etc) before mounting so
// stores read the resolved values on first render.
try {
  applyUrlParams();
} catch (err) {
  console.warn('[main] applyUrlParams failed:', err);
}

render(() => <App />, root);
