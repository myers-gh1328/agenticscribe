# Security

AgenticScribe stores authoritative notes in server-side SQLite and uses
IndexedDB as an offline cache/outbox. The production server must be protected
by single-tenant Microsoft Entra or a private Tailscale/LAN boundary. Entra
authorization allowlists the owner's object ID while durable rows remain keyed
to the stable deployment-local `local-owner` identity; changing identity
providers must not silently re-key existing notes.

Notes are not end-to-end encrypted. Anyone with access to the browser profile,
host account, live database, or decrypted backup may be able to read them. Do
not expose the Node listener without one of those controls, and do not enable
synchronization until owner authentication/routing and an encrypted
backup/restore drill have both been verified.

The server validates bounded JSON mutations, optimistic entity versions, and
hash-bound idempotency keys. Logs must never include note content, request
bodies, identity headers, or local paths.

Report suspected vulnerabilities privately to the repository owner rather than including private note content in a public issue.
