# Changelog

## Unreleased

- Preserve Markdown source and local-file line-ending/BOM conventions.
- Add local-only `.md` file editing with correction-before-write, recoverable failures, external-change detection, and no notebook synchronization.
- Added an authoritative versioned SQLite note store behind a private,
  identity-scoped mutation API.
- Kept IndexedDB as an offline cache/outbox, including legacy-data migration,
  idempotent retries, explicit conflicts, and deletion tombstones.
- Added cross-profile and offline-to-online recovery tests.
- Added integrity-checked online SQLite snapshots and full-runtime releases.
- Added deployment-managed OpenAI-compatible agent setup behind the
  authenticated same-origin server API; only the cleanup preference remains in
  the browser.
- Added automatic per-thought spelling and grammar cleanup after Enter.
- Preserved each original submitted thought and kept failed cleanup non-destructive.
- Split the original monolithic page into focused HTML, style, controller, setup, persistence, agent, and thought modules.
- Kept the desktop organizer pinned while long notes scroll.

- Approved continuous note-taking interface for desktop and mobile.
- Enter-only IndexedDB note persistence.
- Multiple notes, Scratchpad, nested folders, movement, and confirmed deletion.
- Local unit coverage and Playwright browser verification.
