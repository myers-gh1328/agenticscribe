import { resolve } from 'node:path';
import { startStaticServer } from './lib/static-server.mjs';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? '3014');
const staticRoot = resolve(process.env.AGENTIC_SCRIBE_STATIC_DIR ?? 'dist');

const server = await startStaticServer({ host, port, staticRoot });
console.log(`AgenticScribe listening at ${server.url} from ${staticRoot}`);
