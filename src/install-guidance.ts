export interface BrowserIdentity {
	userAgent: string;
	platform: string;
	maxTouchPoints: number;
}

export interface InstallGuidance {
	label: string;
	instructions: string;
}

export function installGuidance(browser: BrowserIdentity): InstallGuidance | undefined {
	const { userAgent, platform, maxTouchPoints } = browser;
	const ios = /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
	if (ios) {
		return {
			label: 'Install on this device',
			instructions: 'Tap Share, then Add to Home Screen.'
		};
	}

	const firefox = /Firefox\//.test(userAgent);
	if (firefox && /Android/.test(userAgent)) {
		return {
			label: 'Install with Firefox',
			instructions: 'Open the Firefox menu, then choose Add app to Home screen.'
		};
	}
	if (firefox && /Win/.test(platform)) {
		return {
			label: 'Install with Firefox',
			instructions: 'Use the web app button in the Firefox address bar.'
		};
	}
	if (firefox) return undefined;

	const safari = /Safari\//.test(userAgent) && !/(?:Chrome|Chromium|CriOS|Edg|OPR)\//.test(userAgent);
	if (safari && /Mac/.test(platform)) {
		return {
			label: 'Install with Safari',
			instructions: 'Open the File menu, then choose Add to Dock.'
		};
	}

	return undefined;
}

export function isInstalledDisplayMode(
	displayMode: Pick<MediaQueryList, 'matches'>,
	iosStandalone: boolean
): boolean {
	return displayMode.matches || iosStandalone;
}
