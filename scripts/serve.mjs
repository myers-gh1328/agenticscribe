import { resolve } from 'node:path';
import { startStaticServer } from './lib/static-server.mjs';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '3014');
const staticRoot = resolve(process.env.AGENTIC_SCRIBE_STATIC_DIR ?? 'dist');
const dataDir = process.env.AGENTIC_SCRIBE_DATA_DIR;
const databasePath = dataDir ? resolve(dataDir, 'notes.sqlite') : undefined;

const server = await startStaticServer({
	host,
	port,
	staticRoot,
	databasePath,
	syncEnabled: process.env.AGENTIC_SCRIBE_SYNC_ENABLED === 'true',
	canonicalOrigin: process.env.AGENTIC_SCRIBE_CANONICAL_ORIGIN,
	requiredCapability: process.env.AGENTIC_SCRIBE_REQUIRED_CAPABILITY,
	agentBaseUrl: process.env.AGENTIC_SCRIBE_AGENT_BASE_URL,
	agentModel: process.env.AGENTIC_SCRIBE_AGENT_MODEL,
	agentConnectTimeoutMs: Number(process.env.AGENTIC_SCRIBE_AGENT_CONNECT_TIMEOUT_MS ?? '5000'),
	agentCleanupTimeoutMs: Number(process.env.AGENTIC_SCRIBE_AGENT_CLEANUP_TIMEOUT_MS ?? '30000')
});
console.log(JSON.stringify({ event: 'agenticscribe_started', url: server.url }));
