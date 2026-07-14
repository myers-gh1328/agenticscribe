import { defineConfig, devices } from '@playwright/test';

const testDataDirectory = `test-results/e2e-data-${Date.now()}-${crypto.randomUUID()}`;

export default defineConfig({
	testDir: './tests',
	testMatch: '**/*.e2e.ts',
	fullyParallel: false,
	workers: 1,
	use: {
		serviceWorkers: 'block'
	},
	webServer: {
		command: 'npm run build && npm start',
		port: 4173,
		reuseExistingServer: false,
		env: {
			HOST: '127.0.0.1',
			PORT: '4173',
			AGENTIC_SCRIBE_DATA_DIR: testDataDirectory,
			AGENTIC_SCRIBE_SYNC_ENABLED: 'true',
			AGENTIC_SCRIBE_CANONICAL_ORIGIN: 'http://127.0.0.1:4173',
			AGENTIC_SCRIBE_REQUIRED_CAPABILITY: 'aegirtech.dev/cap/agenticscribe'
		}
	},
	projects: [
		{
			name: 'desktop',
			use: {
				...devices['Desktop Chrome'],
				baseURL: 'http://127.0.0.1:4173'
			}
		},
		{
			name: 'mobile',
			use: {
				...devices['Pixel 7'],
				browserName: 'chromium',
				baseURL: 'http://127.0.0.1:4173'
			}
		}
	]
});
