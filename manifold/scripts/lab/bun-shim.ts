/**
 * Bun preload for the lab CLI. EngineApi's module graph reaches
 * engine-host.ts, which imports the audio worklet as a Vite asset
 * (`./worklet/nisps-processor.ts?worker&url`). Bun cannot resolve Vite query
 * imports, and the lab never starts audio, so stub them as empty URLs.
 */
import { plugin } from 'bun';

plugin({
  name: 'vite-query-stub',
  setup(build) {
    build.onResolve({ filter: /\?(worker|url)/ }, (args) => ({ path: args.path, namespace: 'vite-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'vite-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
  },
});
