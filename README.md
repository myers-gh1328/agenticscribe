# AgenticScribe

AgenticScribe is a focused, offline-capable note-taking web application. The
server SQLite database is authoritative; IndexedDB is a transactional offline
cache and mutation outbox.

The browser application uses SvelteKit with a static `dist/` build. The custom
Node server continues to own authentication, private APIs, SQLite, health
checks, and static delivery. See
[`docs/architecture/frontend.md`](docs/architecture/frontend.md).

## Current functionality

- Enter commits immediately to IndexedDB and synchronizes to the private server.
- Shift+Enter adds a line without committing.
- Uncommitted text is kept as a browser-local draft so it survives switching and reload.
- Notes can be created, switched, moved, and permanently deleted with confirmation.
- Markdown source is preserved through local storage and server synchronization.
- In supported secure-context browsers, an explicitly selected `.md` file can be edited as a local-only document and written back after optional cleanup finishes.
- Notes begin in Scratchpad or in the folder selected before creation.
- Folders can be created, nested, and renamed.
- Desktop and mobile use the same note-taking workflow.
- A deployment-managed OpenAI-compatible agent can be checked from Agent setup.
- When enabled, Enter saves the raw thought first and then sends only that thought for spelling and grammar cleanup.
- Failed cleanup leaves the original thought unchanged and does not retry automatically.

Deployments may enforce single-tenant Microsoft Entra authentication, enforce
identity and application capability headers, or run on a trusted private LAN.
Each authenticated owner receives an isolated notebook. The app does not
implement collaboration, voice, summaries, finalization, or sharing.

## Requirements

- Node.js 24.18.x
- npm 11.x

## Run locally

```sh
npm install
npm run dev
```

## Install

When the browser supports installation, AgenticScribe shows an install invitation
in the organizer. Chromium browsers can open their native install prompt directly;
Firefox, Safari, iOS, and iPadOS receive browser-specific directions wherever that
browser supports an installed app. Dismissed invitations stay dismissed. The installed app
caches its versioned application shell for offline launch. Authentication and
`/api/*` responses are always network-only; offline note changes stay in the
current Entra owner's partitioned IndexedDB outbox until reauthentication and
connectivity are available.

## Verify

```sh
npm run verify
```

The verification path runs TypeScript checking, Vitest coverage, a production build, and Playwright tests in desktop and mobile Chromium profiles.

## Deploy locally

Create and select a timestamped production release:

```sh
npm ci
npm run deploy:local
```

The script builds a full runtime release under `releases/local/releases`,
switches `releases/local/current`, and checks
`http://127.0.0.1:3014/healthz`. A failed health check restores the previous
release. The host process manager should execute
`current/scripts/serve.mjs` with the selected release's `dist` directory.

Host-specific paths, ports, restart commands, and process-manager configuration belong in the private infrastructure repository. The release script supports `AGENTIC_SCRIBE_RELEASE_ROOT`, `AGENTIC_SCRIBE_HEALTH_URL`, `AGENTIC_SCRIBE_RESTART_COMMAND`, and `AGENTIC_SCRIBE_SKIP_HEALTH_CHECK=true`.

## Data and privacy

Notes and folders are stored authoritatively in SQLite and cached in IndexedDB
for offline use. A committed offline mutation remains queued until the server
acknowledges it. Concurrent server changes create an explicit local conflict;
they do not silently overwrite the local copy. Only the automatic-cleanup
preference and unfinished drafts remain browser-local. The server owns the
agent endpoint and model configuration, and the browser uses the same-origin
AgenticScribe API. When
automatic cleanup is enabled, only the newly submitted thought is sent to the
deployment-managed endpoint; the original is retained with the note.

Local Markdown file handles, recovery text, and link state remain in a separate
browser-local IndexedDB database. They are never sent through the notebook API
or stored in SQLite, so other devices do not see those files. Removing a local
file link never deletes the source file. Browser permission may need to be
granted again after a restart. See
[`docs/architecture/local-markdown-files.md`](docs/architecture/local-markdown-files.md).

Production configuration requires a private listener, an exact canonical
origin, a protected data directory, deployment-owned
`AGENTIC_SCRIBE_AGENT_BASE_URL` and `AGENTIC_SCRIBE_AGENT_MODEL` values, and a
separately managed encrypted backup. Tailscale deployments additionally set an
application capability; trusted LAN deployments leave it unset. See
[`docs/architecture/durable-notes.md`](docs/architecture/durable-notes.md).

For an internet-routed owner deployment, set
`AGENTIC_SCRIBE_AUTH_ENABLED=true`, `AGENTIC_SCRIBE_CANONICAL_ORIGIN`, the
`AGENTIC_SCRIBE_ENTRA_*` values, and
`AGENTIC_SCRIBE_SESSION_SECRET_FILE`. Client and session secrets may be supplied
with their corresponding `_FILE` variables. Health and readiness stay public;
browser navigation redirects to sign-in and unauthenticated API calls return a
JSON `401` response.

Create an integrity-checked SQLite snapshot while the service is running:

```sh
npm run snapshot -- /path/to/notes.sqlite /path/to/staging/notes.sqlite
```

Do not commit real notes, client information, SQLite or browser databases,
snapshots, logs, screenshots containing private notes, or generated test
artifacts. Tests use synthetic content only.

## License

MIT
