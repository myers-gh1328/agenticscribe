import { describe, expect, it } from 'vitest';
import { installGuidance, isInstalledDisplayMode } from './install-guidance';

describe('install guidance', () => {
	it('directs iPhone and iPad users to Add to Home Screen', () => {
		expect(installGuidance({
			userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
			platform: 'iPhone',
			maxTouchPoints: 5
		})).toEqual({
			instructions: 'Tap Share, then Add to Home Screen.',
			label: 'Install on this device'
		});

		expect(installGuidance({
			userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
			platform: 'MacIntel',
			maxTouchPoints: 5
		})).toEqual({
			instructions: 'Tap Share, then Add to Home Screen.',
			label: 'Install on this device'
		});
	});

	it('provides the Firefox install path where Firefox supports web apps', () => {
		expect(installGuidance({
			userAgent: 'Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
			platform: 'Linux armv8l',
			maxTouchPoints: 5
		})).toEqual({
			instructions: 'Open the Firefox menu, then choose Add app to Home screen.',
			label: 'Install with Firefox'
		});

		expect(installGuidance({
			userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
			platform: 'Win32',
			maxTouchPoints: 0
		})).toEqual({
			instructions: 'Use the web app button in the Firefox address bar.',
			label: 'Install with Firefox'
		});
	});

	it('does not advertise installation in unsupported desktop Firefox', () => {
		for (const platform of ['MacIntel', 'Linux x86_64']) {
			expect(installGuidance({
				userAgent: `Mozilla/5.0 (${platform}; rv:143.0) Gecko/20100101 Firefox/143.0`,
				platform,
				maxTouchPoints: 0
			})).toBeUndefined();
		}
	});

	it('directs desktop Safari users to Add to Dock', () => {
		expect(installGuidance({
			userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
			platform: 'MacIntel',
			maxTouchPoints: 0
		})).toEqual({
			instructions: 'Open the File menu, then choose Add to Dock.',
			label: 'Install with Safari'
		});
	});

	it('leaves Chromium guidance to its native install event', () => {
		expect(installGuidance({
			userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
			platform: 'Win32',
			maxTouchPoints: 0
		})).toBeUndefined();
	});
});

describe('installed display mode', () => {
	it('recognizes standalone display mode and iOS standalone mode', () => {
		expect(isInstalledDisplayMode({ matches: true }, false)).toBe(true);
		expect(isInstalledDisplayMode({ matches: false }, true)).toBe(true);
		expect(isInstalledDisplayMode({ matches: false }, false)).toBe(false);
	});
});
