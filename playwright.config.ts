import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	testMatch: '**/*.e2e.ts',
	fullyParallel: false,
	webServer: {
		command: 'npm run dev -- --host 127.0.0.1 --port 4173',
		port: 4173,
		reuseExistingServer: false
	},
	projects: [
		{
			name: 'desktop',
			use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173' }
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
