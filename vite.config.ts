import { defineConfig } from 'vitest/config';
// @ts-expect-error Native Node build helper intentionally remains JavaScript.
import { stampServiceWorker } from './scripts/lib/pwa-build.mjs';

export default defineConfig({
	plugins: [{
		name: 'stamp-pwa-service-worker',
		apply: 'build',
		async closeBundle() {
			await stampServiceWorker(new URL('./dist', import.meta.url).pathname);
		}
	}],
	test: {
		environment: 'node',
		include: ['src/**/*.spec.ts', 'scripts/**/*.spec.mjs'],
		expect: { requireAssertions: true },
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov'],
			include: ['src/notebook-store.ts', 'src/local-agent.ts', 'src/thoughts.ts'],
			exclude: ['src/**/*.spec.ts'],
			thresholds: {
				statements: 80,
				branches: 80,
				functions: 80,
				lines: 80
			}
		}
	}
});
