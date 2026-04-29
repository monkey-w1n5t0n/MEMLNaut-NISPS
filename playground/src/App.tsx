import { Component, createSignal, lazy, onCleanup, Show } from 'solid-js';
import styles from './App.module.css';

type Route = 'home' | 'primitives' | 'unknown';

function parseRoute(path: string): Route {
  if (path === '' || path === '/' || path === '/index.html') return 'home';
  if (path === '/dev/primitives' || path === '/dev/primitives/') return 'primitives';
  return 'unknown';
}

// Lazy-loaded so the home route doesn't pay the cost of loading every
// primitive demo. Stream 9/10 can grow the showcase freely.
const PrimitivesShowcase = lazy(() => import('./dev/PrimitivesShowcase'));

const App: Component = () => {
  const [route, setRoute] = createSignal<Route>(parseRoute(window.location.pathname));

  const onPop = () => setRoute(parseRoute(window.location.pathname));
  window.addEventListener('popstate', onPop);
  onCleanup(() => window.removeEventListener('popstate', onPop));

  const navigate = (path: string) => {
    if (window.location.pathname === path) return;
    window.history.pushState({}, '', path);
    setRoute(parseRoute(path));
  };

  return (
    <div class={styles.app}>
      <header class={styles.header}>
        <strong>MEMLNaut</strong>
        <span class={styles.dim}>playground</span>
        <nav class={styles.nav}>
          <button
            type="button"
            class={route() === 'home' ? styles.active : ''}
            onClick={() => navigate('/')}
          >
            home
          </button>
          <button
            type="button"
            class={route() === 'primitives' ? styles.active : ''}
            onClick={() => navigate('/dev/primitives')}
          >
            /dev/primitives
          </button>
        </nav>
      </header>
      <main class={styles.main}>
        <Show when={route() === 'home'}>
          <Home />
        </Show>
        <Show when={route() === 'primitives'}>
          <PrimitivesShowcase />
        </Show>
        <Show when={route() === 'unknown'}>
          <div class={styles.notFound}>
            <h1>404</h1>
            <p>No route at <code>{window.location.pathname}</code>.</p>
            <p>
              <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>back to home</a>
            </p>
          </div>
        </Show>
      </main>
    </div>
  );
};

const Home: Component = () => {
  return (
    <div class={styles.home}>
      <h1 class={styles.title}>MEMLNaut Playground</h1>
      <p class={styles.tagline}>
        Interactive ML control of audio. SolidJS scaffold — modes coming online in stream 9.
      </p>
      <ul class={styles.linkList}>
        <li><a href="/dev/primitives" onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/dev/primitives'); window.dispatchEvent(new PopStateEvent('popstate')); }}>Primitives showcase</a> — UI building blocks</li>
      </ul>
      <p class={styles.note}>
        This is a fresh scaffold. ML, WASM, and audio engines are not yet wired up.
      </p>
    </div>
  );
};

export default App;
