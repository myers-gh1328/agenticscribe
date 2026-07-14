# Agent Guidance

- Read `README.md` before changing behavior.
- Preserve the approved note-taking interface unless the user explicitly approves a UI change.
- Use Node 24.18.x and npm 11.x.
- The approved frontend stack is SvelteKit and Svelte 5. Do not add or replace UI frameworks, editor frameworks, component systems, or server adapters without explicit user approval.
- Application behavior requires test-first red-green-refactor delivery.
- Run `npm run verify` before claiming behavior works.
- Keep core note-taking independent of authentication, synchronization, AI, voice, and external services unless separately approved.
- Never commit real notes, client information, browser data, secrets, logs, or generated test artifacts.
