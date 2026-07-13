# AgenticScribe

AgenticScribe is a focused, local-first note-taking web application. This initial implementation preserves the approved note-taking interface and replaces its prototype `localStorage` persistence with a tested IndexedDB store.

## Current functionality

- Enter commits the current note text to this browser.
- Shift+Enter adds a line without committing.
- Uncommitted text survives note switching in the current session but is intentionally lost on reload.
- Notes can be created, switched, moved, and permanently deleted with confirmation.
- Notes begin in Scratchpad or in the folder selected before creation.
- Folders can be created, nested, and renamed.
- Desktop and mobile use the same note-taking workflow.
- A local OpenAI-compatible agent can be configured from Agent setup.
- When enabled, Enter saves the raw thought first and then sends only that thought for spelling and grammar cleanup.
- Failed cleanup leaves the original thought unchanged and does not retry automatically.

This milestone intentionally contains no authentication, synchronization, voice, summaries, finalization, server-side note database, sharing, or old Scribestead UI.

## Requirements

- Node.js 24.18.x
- npm 11.x

## Run locally

```sh
npm install
npm run dev
```

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

The script builds into `releases/local/releases`, switches `releases/local/current`, and checks `http://127.0.0.1:3014/healthz`. A failed health check restores the previous release. The host process manager should run `npm start` with `AGENTIC_SCRIBE_STATIC_DIR` set to the selected release's `dist` directory.

Host-specific paths, ports, restart commands, and process-manager configuration belong in the private infrastructure repository. The release script supports `AGENTIC_SCRIBE_RELEASE_ROOT`, `AGENTIC_SCRIBE_HEALTH_URL`, `AGENTIC_SCRIBE_RESTART_COMMAND`, and `AGENTIC_SCRIBE_SKIP_HEALTH_CHECK=true`.

## Data and privacy

Notes and folders are stored in IndexedDB in the current browser profile. Local-agent connection settings are stored in the same browser profile. Notes are not synchronized. When automatic cleanup is enabled, only the newly submitted thought is sent to the configured local endpoint; the original is retained with the note. Clearing site data, deleting the browser profile, or browser storage eviction can remove this data.

Do not commit real notes, client information, browser databases, logs, screenshots containing private notes, or generated test artifacts. Tests use synthetic content only.

## License

MIT
