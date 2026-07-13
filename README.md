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

This milestone intentionally contains no authentication, synchronization, AI, voice, server-side note database, sharing, or old Scribestead UI.

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

## Data and privacy

Notes and folders are stored in IndexedDB in the current browser profile. They are not synchronized or sent to a server. Clearing site data, deleting the browser profile, or browser storage eviction can remove them.

Do not commit real notes, client information, browser databases, logs, screenshots containing private notes, or generated test artifacts. Tests use synthetic content only.

## License

MIT
