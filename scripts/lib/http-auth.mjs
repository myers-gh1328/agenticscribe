export function createAuthRequest(request, canonicalOrigin) {
	if (!canonicalOrigin) throw new Error('canonicalOrigin is required when authentication is enabled.');
	const url = new URL(request.url ?? '/', canonicalOrigin);
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (Array.isArray(value)) {
			for (const item of value) headers.append(name, item);
		} else if (typeof value === 'string') {
			headers.set(name, value);
		}
	}
	return new Request(url, { method: request.method, headers });
}

export async function writeAuthResponse(source, target) {
	target.statusCode = source.status;
	for (const [name, value] of source.headers) {
		if (name !== 'set-cookie') target.setHeader(name, value);
	}
	const setCookies = source.headers.getSetCookie();
	if (setCookies.length > 0) target.setHeader('Set-Cookie', setCookies);
	const body = Buffer.from(await source.arrayBuffer());
	target.end(body);
}
