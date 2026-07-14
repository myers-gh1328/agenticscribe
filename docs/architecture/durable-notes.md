# Durable Notes And Offline Synchronization

Status: implementation plan for the durable-notes milestone.

## Goal

Make the `nanobot` deployment the durable system of record for notes and
folders while preserving the current browser experience when the server is
temporarily unreachable. IndexedDB remains an offline cache and mutation
outbox; it is not the authoritative or only copy.

## Non-goals

- Multi-user collaboration, sharing, or public exposure.
- Silent last-write-wins conflict resolution.
- Sending note content to the local model except for the existing explicit
  per-thought cleanup request.
- Storing runtime data or deployment secrets in git.

## Ownership And Data Flow

The Node server owns a SQLite database at a deployment-configured path. It can
listen on a trusted private LAN, behind Tailscale Serve, or behind a public
route protected by single-tenant Entra authentication. A
Tailscale deployment supplies verified identity and an explicitly granted
AgenticScribe app capability. LAN deployments store records under one stable
deployment-local owner. Entra deployments key records by the verified object ID
so each allowed user receives an isolated notebook.

Before opening IndexedDB or starting synchronization, the browser resolves the
authenticated session and selects an object-ID-specific notebook database. This
partitions the offline cache, drafts, and mutation outbox across account
switches as well as partitioning authoritative SQLite rows.

The installable PWA service worker precaches the built application shell and
static install assets. Navigation falls back to that shell only when the
network is unavailable. Authentication and API paths are explicitly
network-only, so cached responses cannot bypass session validation or replay
another owner's server data. Updated workers wait for the next normal app
restart rather than forcibly replacing a page with an active draft or outbox.

The server exposes a same-origin `/api/notebook` contract. The browser store
applies a mutation locally and records/coalesces its IndexedDB outbox entry in
the same transaction. On startup and reconnect it drains each entity's outbox
in causal order and then refreshes clean cache records from the server.

Each mutation has a stable UUID and an expected server entity version. Later
offline changes to the same entity coalesce into one latest desired state while
retaining the last acknowledged version; a second request is not created until
the in-flight predecessor is acknowledged. SQLite applies the mutation and
records its UUID, canonical request hash, and exact response in one transaction.
An identical replay returns that response. Reuse with different content or an
unexpected version returns a conflict without discarding either value.

IndexedDB keeps sync metadata in separate outbox, tombstone, and conflict
tables so the previous client cannot erase it when a static rollback writes a
note record. A conflict record contains the base version, local desired value
or deletion intent, and remote value/tombstone. Snapshot refresh never replaces
dirty or conflicted entities. Same-browser stale revisions are rejected and a
`BroadcastChannel` prompts other tabs to refresh.

Unfinished editor text is stored in a separate browser-local draft table. It
survives navigation and refresh without entering the mutation outbox or becoming
server-authoritative until the user commits the thought with Enter.

Deleted entities remain as content-free client and server tombstones so an
offline browser cannot resurrect them during synchronization. Tombstone and
mutation-receipt pruning is out of scope until clients have expiring durable
synchronization cursors. Backup retention documentation explains that deletion
is not immediate in historical encrypted snapshots.

The browser also uses a narrow same-origin `/api/agent` contract. The server,
not the browser, owns the OpenAI-compatible base URL, installed model ID,
cleanup prompt, timeouts, and upstream request shape. Deployments can require
verified Tailscale identity and capability headers or disable that gate on a
trusted private LAN. Cleanup always requires the canonical Origin, same-origin
Fetch Metadata, and bounded JSON. The API is not a generic completion proxy and
never accepts a caller-selected endpoint, model, prompt, or messages array.

## Initial Browser Migration

Existing IndexedDB notes and folders have no server version. The first sync
uploads folders in parent-before-child order and then notes as create
mutations. Same ID plus the same canonical content is acknowledged as already
imported. Divergent content creates an explicit conflict and blocks dependent
children/notes until resolution; neither copy is overwritten.

No migration deletes browser records. A successful server acknowledgement adds
the server version to the cached entity.

## Invariants

- A committed note is described as durable only after SQLite commits it.
- Offline commits remain visible locally and queued until acknowledged.
- Cache mutation and outbox/tombstone mutation are one IndexedDB transaction.
- Retrying a mutation cannot duplicate a note, folder, or revision.
- Conflicts never silently overwrite either side.
- Note/folder validation is enforced on both client and server boundaries.
- Database writes, mutation receipt, and entity version changes share one
  SQLite transaction.
- Server errors and offline state never delete the IndexedDB cache or outbox.
- Refresh never discards an unfinished browser-local draft.
- The server accepts notebook API calls only through its configured private
  origin; no public route is added.
- State-changing requests require exact Origin, JSON content type, and Fetch
  Metadata checks. Tailscale deployments additionally require identity and
  capability authorization.
- Logs use an allowlist of event, outcome, request ID, opaque mutation ID,
  latency, and status. They never serialize request bodies, note/folder
  content, cookies, authorization/identity headers, query strings, stack
  traces, or database paths.
- Agent failures never roll back the raw committed thought, retry automatically,
  expose upstream routing, or make notebook readiness depend on model availability.

## Failure States

| State | User-visible outcome | Recovery |
| --- | --- | --- |
| Server unreachable | Note remains cached and marked pending sync | Automatic sync on reconnect/reload |
| Duplicate request | Existing acknowledgement is returned | No user action |
| Version conflict | Local change remains cached and marked conflicted | Preserve both in conflict table; resolution UI/operator workflow |
| Invalid mutation | Local data remains cached; sync error is visible | Correct data/app defect before retry |
| SQLite unavailable | Health reports degraded and writes fail closed | Restore filesystem/database service |
| Browser/device loss | Fresh browser downloads server snapshot | No browser backup required |
| Host/database loss | Restore the SQLite backup | Operator follows restore verification |

## Storage And Backup

The deployment sets `AGENTIC_SCRIBE_DATA_DIR` outside the git checkout and
release tree with directory mode `0700` and database/WAL/SHM mode `0600`.
SQLite uses WAL mode, foreign keys, a busy timeout, serialized writes, and
explicit checkpoint monitoring. FileVault and the encrypted backup boundary
are documented; server operators can read notes because this milestone is not
end-to-end encrypted.

A backup command uses the SQLite online backup API to write an atomic snapshot
without copying live WAL files. Shared infrastructure uses a dedicated
AgenticScribe restic repository/credential, retention policy, failure
notification, and scheduled LaunchAgent. Verification runs `integrity_check`,
`foreign_key_check`, schema/count checks, and starts a disposable restored
database. The restore runbook stages to a new path, preserves the damaged
DB/WAL/SHM set, swaps atomically while stopped, and supports reverting the
restore.

## Access And Request Limits

- Canonical origin: exact deployment-owned private LAN HTTP or Tailscale Serve
  HTTPS origin.
- Authorization: Tailscale deployments require the AgenticScribe app
  capability. Trusted LAN deployments use one deployment-local owner and rely
  on private-network access plus exact-origin write checks.
- Maximum JSON request body: 1 MiB, including chunked requests.
- Maximum note text: 256 KiB; maximum 10,000 notes and 5,000 folders.
- Snapshot pages: at most 500 entities with an opaque cursor.
- Header, request, and idle timeouts are explicit; concurrent writes are
  bounded and return `503` when saturated.
- Writes fail closed below the configured free-disk threshold.
- Validation errors are sanitized and never echo submitted content.

## Rollout And Rollback

1. Publish a full runtime release containing server and static assets. Deploy
   the API with sync disabled, the selected private listener and authorization
   mode, and liveness/readiness checks.
2. Provision the protected data directory and dedicated encrypted backup job.
   Prove an empty/disposable backup and restore before accepting durable writes.
3. Enable one canary browser import. Preserve its original IndexedDB, verify
   entity counts/conflicts, then immediately prove backup and disposable
   restore again.
4. Enable general sync and verify a note created in one clean browser appears
   in another authorized browser.
5. Verify offline creation queues and synchronizes after reconnect, including
   two edits plus move/cleanup to the same entity.

Releases contain the complete server plus static assets, and the LaunchAgent
executes the selected runtime. Database migrations are versioned, expand-only,
and maintain documented N/N-1 compatibility. A verified pre-migration snapshot
is required. The sync kill switch is disabled before rollback; the SQLite
database and browser cache are never deleted. Roll-forward is the default
recovery when a prior runtime cannot safely use the current schema.

## Test Plan

- Repository tests: SQLite schema, validation, idempotency, optimistic
  conflicts, tombstones, mutation/request hash binding, crash after commit
  before acknowledgement, WAL restart, disk/read-only/locked failures, and
  online backup/restore during writes.
- Server contract tests: snapshot, mutation status codes, request limits,
  health/readiness, and no note content in error logs.
- Browser store tests: atomic local write/outbox failure injection, durable
  acknowledgement, repeated same-entity offline edits, stale multi-tab writes,
  durable local deletion tombstones, initial/partial migration, identical and
  divergent multi-profile imports, conflict preservation, and remote refresh.
- Playwright: cross-context persistence through the server and offline-to-online
  synchronization.
- Deployment: configured authorization mode, canonical-origin enforcement,
  private binding, liveness/readiness, SQLite path/permissions/disk/WAL,
  full-runtime release metadata, LaunchAgent environment, content-free logs,
  backup freshness, and disposable restore verification.
