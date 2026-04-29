import { Component, createMemo, createSignal, lazy, onCleanup, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { modeStore } from './stores/mode-store';
import { MODE_REGISTRY, getModeById } from './modes';
import { ModeSwitcher } from './modes/ModeSwitcher';
import styles from './App.module.css';

type Route = 'home' | 'primitives' | 'modes' | 'unknown';

function parseRoute(path: string): Route {
  if (path === '' || path === '/' || path === '/index.html') return 'home';
  if (path === '/dev/primitives' || path === '/dev/primitives/') return 'primitives';
  if (path === '/modes' || path === '/modes/' || path.startsWith('/modes/')) return 'modes';
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
            class={route() === 'modes' ? styles.active : ''}
            onClick={() => navigate('/modes')}
          >
            /modes
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
          <Home navigate={navigate} />
        </Show>
        <Show when={route() === 'modes'}>
          <ModesPage />
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

const ModesPage: Component = () => {
  const activeId = () => modeStore.state.activeModeId ?? MODE_REGISTRY[0]!.id;
  const ActiveComponent = createMemo(() => getModeById(activeId()).Component);

  return (
    <div>
      <ModeSwitcher />
      <Dynamic component={ActiveComponent()} />
    </div>
  );
};

interface HomeProps {
  navigate: (path: string) => void;
}

const Home: Component<HomeProps> = (props) => {
  return (
    <div class={styles.home}>
      <h1 class={styles.title}>MEMLNaut Playground</h1>
      <p class={styles.tagline}>
        Interactive ML control of audio. Stream 9: nine modes, one shell.
      </p>
      <ul class={styles.linkList}>
        <li>
          <a
            href="/modes"
            onClick={(e) => {
              e.preventDefault();
              props.navigate('/modes');
            }}
          >
            Modes
          </a>{' '}
          — pick a mode and start playing
        </li>
        <li>
          <a
            href="/dev/primitives"
            onClick={(e) => {
              e.preventDefault();
              props.navigate('/dev/primitives');
            }}
          >
            Primitives showcase
          </a>{' '}
          — UI building blocks
        </li>
      </ul>
      <p class={styles.note}>
        ML inference runs on the main thread via WASM. Audio synthesis runs
        in an AudioWorklet — start it from inside any mode using the "Start
        audio" button. Audio cannot autoplay (browser policy).
      </p>
    </div>
  );
};

export default App;
