import { resolve } from 'node:path';
import { createOwnerOidc } from '@myers-gh1328/owner-oidc';
import { createRuntimeConfig } from '@myers-gh1328/runtime-config';

export function createServerOptions(env = process.env) {
	const processConfig = createRuntimeConfig({ env });
	const appConfig = createRuntimeConfig({ env, prefix: 'AGENTIC_SCRIBE' });
	const authEnabled = appConfig.optional('AUTH_ENABLED', 'false') === 'true';
	const canonicalOrigin = authEnabled
		? appConfig.required('CANONICAL_ORIGIN')
		: appConfig.optional('CANONICAL_ORIGIN');

	return {
		host: processConfig.optional('HOST', '127.0.0.1'),
		port: Number(processConfig.optional('PORT', '3014')),
		staticRoot: resolve(appConfig.optional('STATIC_DIR', 'dist')),
		databasePath: appConfig.optional('DATA_DIR')
			? resolve(appConfig.required('DATA_DIR'), 'notes.sqlite')
			: undefined,
		syncEnabled: appConfig.optional('SYNC_ENABLED', 'false') === 'true',
		canonicalOrigin,
		requiredCapability: authEnabled ? undefined : appConfig.optional('REQUIRED_CAPABILITY'),
		authentication: authEnabled ? createAuthentication(appConfig) : undefined,
		agentBaseUrl: appConfig.optional('AGENT_BASE_URL'),
		agentModel: appConfig.optional('AGENT_MODEL'),
		agentConnectTimeoutMs: Number(appConfig.optional('AGENT_CONNECT_TIMEOUT_MS', '5000')),
		agentCleanupTimeoutMs: Number(appConfig.optional('AGENT_CLEANUP_TIMEOUT_MS', '30000'))
	};
}

function createAuthentication(config) {
	const allowedObjectIds = config.list('ENTRA_ALLOWED_OBJECT_IDS');
	if (allowedObjectIds.length === 0) {
		throw new Error('AGENTIC_SCRIBE_ENTRA_ALLOWED_OBJECT_IDS is required.');
	}
	const redirectUris = config.list('ENTRA_REDIRECT_URIS');
	if (redirectUris.length === 0) {
		throw new Error('AGENTIC_SCRIBE_ENTRA_REDIRECT_URIS is required.');
	}

	return createOwnerOidc({
		tenantId: config.required('ENTRA_TENANT_ID'),
		clientId: config.required('ENTRA_CLIENT_ID'),
		clientSecret: config.secret('ENTRA_CLIENT_SECRET'),
		redirectUris,
		postLogoutRedirectUri: config.required('ENTRA_POST_LOGOUT_REDIRECT_URI'),
		allowedObjectIds,
		cookieSecret: config.secret('SESSION_SECRET'),
		cookiePrefix: 'agenticscribe',
		publicPaths: ['/healthz', '/readyz']
	});
}
