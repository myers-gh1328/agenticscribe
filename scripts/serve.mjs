import { startStaticServer } from './lib/static-server.mjs';
import { createServerOptions } from './lib/server-config.mjs';

const server = await startStaticServer(createServerOptions());
console.log(JSON.stringify({ event: 'agenticscribe_started', url: server.url }));
