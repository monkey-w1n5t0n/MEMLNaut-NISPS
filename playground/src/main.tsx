/* @refresh reload */
import { render } from 'solid-js/web';
import App from './App';
import './styles/tokens.css';
import { installDebugProbe } from './debug/probe';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

// Install debug probe early. It is a stub for now; stream 10 fills it in
// once WASM ML is wired up. Keeping the install path stable from day one
// makes Playwright tests insensitive to ordering.
installDebugProbe();

render(() => <App />, root);
