# Agent Guidance

This file is the starting point for every agent working in AgenticScribe. Do
not guess the architecture or deployment process from filenames, old commits,
or another notes project.

## Start Here

Before changing anything:

1. Read `README.md` for the current product and runtime contract.
2. Read the architecture document matching the work:
   - UI, SvelteKit, Milkdown, PWA, or browser lifecycle:
     `docs/architecture/frontend.md`
   - server APIs, SQLite, offline synchronization, authentication, deployment,
     backup, or rollback: `docs/architecture/durable-notes.md`
   - local `.md` file behavior: `docs/architecture/local-markdown-files.md`
3. Read `SECURITY.md` for any server, authentication, persistence, logging,
   AI, voice, or deployment work.
4. Inspect `git status`, the current branch, and recent commits. Preserve work
   from other agents and the user.

If documentation and code disagree, stop treating the documentation as proof.
Inspect the tests and current implementation, then update the stale contract as
part of the same scoped change.

## What This App Is

AgenticScribe is an offline-capable, self-hosted notes application.

- The Node server's SQLite database is authoritative for synchronized notes.
- IndexedDB is an owner-partitioned offline cache, draft store, mutation outbox,
  tombstone store, and conflict store.
- Local Markdown files are a separate browser-only boundary and never enter the
  notebook API, SQLite database, or synchronization outbox.
- The browser calls only same-origin AgenticScribe APIs. It never calls a model
  endpoint directly.
- Cleanup applies only to an explicitly saved thought. Distillation and voice
  transcription are separate, explicit actions.
- Raw note content is retained. Final/distilled content is a separate version.
- Notes are not end-to-end encrypted. Host, browser-profile, and decrypted
  backup access can expose them.

Do not reintroduce the old prototype assumptions that IndexedDB is the only
store, Enter always commits, the browser owns the model endpoint, or the app is
only a static site.

## Repository Map

- `src/routes/+page.svelte`: Svelte application shell and mount lifecycle.
- `src/notebook-app.ts`: notebook UI orchestration and user workflows.
- `src/markdown-editor.ts`: Milkdown adapter; it does not own persistence.
- `src/notebook-store.ts`: IndexedDB cache, drafts, outbox, tombstones, and
  synchronization state.
- `src/notebook-remote.ts`: same-origin notebook API client.
- `src/local-agent.ts`: same-origin cleanup, distillation, and transcription
  client behavior.
- `src/local-markdown-*`: device-local Markdown file boundary.
- `scripts/serve.mjs`: production server entry point.
- `scripts/lib/static-server.mjs`: static delivery, health/readiness, auth, API,
  limits, and request security boundary.
- `scripts/lib/notebook-database.mjs`: authoritative SQLite behavior.
- `scripts/lib/server-config.mjs`: runtime environment contract.
- `scripts/lib/http-auth.mjs` and `src/auth-bootstrap.ts`: authentication and
  browser-session integration.
- `scripts/deploy/local-release.mjs` and `scripts/lib/release.mjs`: app-owned
  release packaging and rollback selection.
- `public/`: PWA manifest, icons, and network-aware service worker.
- `tests/`: desktop/mobile Playwright behavior tests.

Keep modules inside these ownership boundaries. Do not create a second state,
persistence, authentication, or server implementation in Svelte components.

## Runtime And Package Setup

Use Node 24.18.x and npm 11.x exactly as declared in `package.json`.

Dependencies include private GitHub Packages under `@myers-gh1328`. A local or
cloud agent running `npm ci` needs a valid `NODE_AUTH_TOKEN` in its environment.
Never write that token to `.npmrc`, source files, logs, commits, or chat output.
The committed `.npmrc` contains only registry configuration and an environment
variable reference.

Install and run the UI development server:

```sh
npm ci
npm run dev
```

`npm run dev` is useful for frontend iteration. It is not proof that the custom
Node APIs, SQLite, authentication, synchronization, or production release work.

For a synthetic full-server run, build first and configure a non-production
data directory and exact origin:

```sh
npm run build
HOST=127.0.0.1 PORT=3014 \
AGENTIC_SCRIBE_DATA_DIR=test-results/manual-data \
AGENTIC_SCRIBE_SYNC_ENABLED=true \
AGENTIC_SCRIBE_CANONICAL_ORIGIN=http://127.0.0.1:3014 \
npm start
```

Use synthetic content only. Never point tests or manual development at a real
notes database.

## Change And Verification Workflow

- Preserve the approved interface unless the user explicitly approves a UI
  change.
- Use test-first red-green-refactor delivery for application behavior.
- Add focused unit/server tests near the affected module and browser coverage
  for user-visible workflows.
- Do not add or replace SvelteKit, Svelte 5, Milkdown, the static adapter,
  component systems, editor frameworks, persistence libraries, or server
  adapters without explicit user approval.
- Keep note-taking usable when AI is unavailable or unconfigured.
- Do not add authentication, synchronization, AI, voice, sharing, or external
  integrations to core note operations unless the requested change explicitly
  requires that boundary.

Useful commands:

```sh
npm run check
npm run test:unit
npm run test:coverage
npm run build
npm run test:e2e
npm run verify
```

Run focused tests while iterating. Run `npm run verify` before claiming a change
works or publishing it. A build alone is not verification. If the request is
about a deployed app, verify the exact deployed commit through the real URL and
the relevant authenticated browser workflow after deployment.

## Deployment Ownership

This public repository owns the application runtime and release contract. It
does not own private host configuration, secrets, LaunchAgents, routing,
backups, or installed model inventory.

Private deployment source of truth:

- Repository: `myers-gh1328/aegir-infra`
- Local checkout when present:
  `C:\Users\dradi\source\repos\aegir-infra`
- Ansible root: `infra/ansible`
- App host inventory name: `nanobot`
- App host IP: `192.168.4.222`
- App port: `3014`
- Model host inventory name: `nano`
- Model gateway: `http://192.168.20.43:8080/v1`

Names such as `nano` and `nanobot` are inventory labels, not reliable DNS
names. Do not swap them: AgenticScribe runs on `nanobot`; the model runs on
`nano`.

The app-owned command:

```sh
npm run deploy:local
```

builds a timestamped full-runtime release, switches the `current` release, and
can roll back the selection after a failed health check. It does not provision
the host, configure secrets, install a LaunchAgent, create backups, change
routing, or update model-gateway origins. Running it on a workstation is not a
substitute for deploying the managed host.

The private deployment is applied and checked from a Linux/macOS Ansible
control environment in `aegir-infra/infra/ansible`:

```sh
make agenticscribe HOST=nanobot
make check-agenticscribe HOST=nanobot
```

If browser origins or model routing changed, also apply and verify the model
gateway configuration owned by `aegir-infra`:

```sh
make nano-model-gateway HOST=nano
make check-nano-model-gateway HOST=nano
```

Before any deployment, compare `scripts/lib/server-config.mjs` with the current
AgenticScribe LaunchAgent and variables in `aegir-infra`. Runtime contracts can
evolve faster than private deployment wiring. Update both repositories when a
new required variable, secret file, data path, capability, model setting,
health check, or release path is introduced. Never silently deploy with missing
production configuration.

Do not enable durable synchronization until the deployment has all of the
following:

- a protected `AGENTIC_SCRIBE_DATA_DIR` outside the checkout and release tree;
- an exact canonical origin and approved private/authenticated routing;
- the intended owner identity boundary;
- deployment-owned model endpoint and installed model ID when AI is enabled;
- an encrypted backup job plus a successfully tested disposable restore;
- verified `/healthz` and `/readyz` responses and cross-device note sync.

Do not edit the live host manually when the setting belongs in `aegir-infra`.
Do not install, download, update, or switch a model unless the user explicitly
requests that operation.

## Data, Privacy, And Git Safety

Never commit or expose:

- real notes, client information, recordings, transcripts, or distillations;
- SQLite databases, WAL/SHM files, IndexedDB/browser profiles, snapshots, or
  local Markdown recovery data;
- cookies, tokens, Entra secrets, session secrets, identity headers, model
  credentials, runtime environment files, logs, or private URLs not already
  documented as deployment inventory;
- screenshots or fixtures containing private content;
- generated `dist`, coverage, Playwright, test-result, release, or log output.

Logs and errors must never serialize note content, request bodies, audio,
identity headers, cookies, database paths, or secret values. Tests use only
synthetic content and isolated generated data directories.

Do not push unless the user explicitly asks for a push or requests PR work.
Commit only the intended files, preserve unrelated changes, and leave the
worktree clean or explicitly explain what remains.
