# Frontend Runtime

Status: approved implementation contract.

## Stack

AgenticScribe uses SvelteKit and Svelte 5 for the browser application. The
static adapter emits the existing `dist/` deployment artifact. SvelteKit
prerenders the application shell into `index.html` so the approved interface is
available before hydration and during an immediate offline transition. Notebook
startup remains browser-only because it depends on IndexedDB, service-worker,
and File System Access APIs.

The existing Node server remains the runtime boundary for static delivery,
health checks, authentication, notebook and agent APIs, SQLite, and exact-origin
enforcement. SvelteKit does not replace or duplicate those server concerns.

## Migration Boundary

The Svelte page owns the approved application markup, CSS imports, document
metadata, and browser mount lifecycle. The note-taking controller is loaded
from `onMount` and talks to the Milkdown Crepe editor through a small adapter.
The adapter owns Markdown replacement, serialization, labeled toolbar controls,
readonly state, keyboard forwarding, and focus; the controller remains the only
owner of storage, synchronization, cleanup, and local-file behavior. Future
conversion of controller behavior into reactive Svelte components must proceed
in test-first vertical slices without maintaining a second state or persistence
implementation.

The visible editor toolbar is intentionally limited to headings, emphasis, lists,
links, code blocks, quotes, and horizontal rules. Distillation remains an explicit
modal action outside the editor adapter. Accepting its result attaches a read-only
Final version to the same note while preserving the editable Raw version. The
modal makes summary inclusion an explicit, default-off choice before it sends
the note. Image, table, math, and collaboration features
remain disabled and outside the core note-taking boundary.

## Build And Offline Contract

- `svelte-kit sync` and `svelte-check` provide frontend type and component checks.
- `@sveltejs/adapter-static` writes pages and assets to `dist/`.
- `public/` contains the manifest, icons, and network-only API-aware service worker.
- The post-build stamp hashes the completed SvelteKit output before selecting the
  application-shell cache name.
- The custom Node server and local release workflow consume `dist/` unchanged.

Adding or replacing a frontend framework, editor framework, component system,
or server adapter requires explicit approval.
