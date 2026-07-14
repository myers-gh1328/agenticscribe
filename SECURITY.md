# Security

AgenticScribe stores authoritative notes in server-side SQLite and uses
IndexedDB as an offline cache/outbox. The production server must listen only on
loopback behind Tailscale Serve HTTPS. It rejects note API requests without a
verified Tailscale login and the configured application capability, and it
isolates records by that login.

Notes are not end-to-end encrypted. Anyone with access to the browser profile,
host account, live database, or decrypted backup may be able to read them. Do
not expose the Node listener directly to a LAN or public network, and do not
enable synchronization until private identity routing and an encrypted
backup/restore drill have both been verified.

The server validates bounded JSON mutations, optimistic entity versions, and
hash-bound idempotency keys. Logs must never include note content, request
bodies, identity headers, or local paths.

Report suspected vulnerabilities privately to the repository owner rather than including private note content in a public issue.
