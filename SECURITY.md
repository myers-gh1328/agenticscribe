# Security

AgenticScribe currently stores notes only in the browser's IndexedDB database. It does not provide encryption, authentication, synchronization, or server-side storage.

Anyone with access to the browser profile or device may be able to read its notes. Do not treat this milestone as approved for real client data until the deployment and access-control model is separately designed and implemented.

Report suspected vulnerabilities privately to the repository owner rather than including private note content in a public issue.
