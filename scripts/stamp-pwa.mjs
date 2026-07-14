import { stampServiceWorker } from './lib/pwa-build.mjs';

await stampServiceWorker(new URL('../dist', import.meta.url).pathname);
