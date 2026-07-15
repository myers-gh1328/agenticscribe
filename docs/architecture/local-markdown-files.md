# Local Markdown Files

Status: implementation contract for PB-0541 and PB-0542.

## Goal

Allow Markdown source to round-trip through normal synchronized notes and allow
an explicitly selected `.md` file to be edited as a separate, device-local
document. A local document is never uploaded or added to the notebook mutation
outbox.

## Markdown Source Contract

- Note text is Markdown source, not rendered HTML.
- Markdown punctuation, blank lines, Unicode, and trailing-newline state are
  preserved while a document is opened or switched without editing. Once the
  rich editor changes a document, Milkdown serializes it to canonical Markdown;
  semantically equivalent spacing and punctuation may therefore be normalized.
- Browser editing uses LF internally. A local file remembers whether its input
  used LF or CRLF and restores that style when writing.
- A UTF-8 byte-order mark is removed for editing and restored when writing.
- Automatic cleanup may replace only the newly appended thought. When an edit
  is not an append, the document is written without sending the whole Markdown
  document for cleanup.

## Local-File Boundary

Local documents use a dedicated IndexedDB database containing a file handle,
the last file text observed, a recoverable editor value, and format metadata.
They do not use `NotebookStore`, `/api/notebook`, SQLite, the notebook outbox,
folders, or server conflict records. Other devices therefore cannot discover
them.

Local documents can be exported to `.md` or `.txt` entirely in the browser.
They cannot use whole-note distillation because that would cross the local-file
boundary and send the document to the deployment-managed agent.

The browser file picker must be invoked by a user gesture. File permission can
expire and must be re-requested from a user gesture. Only the browser-provided
file name is displayed; filesystem paths are neither available nor persisted.

## Commit And Failure Rules

1. Save thought or Cmd/Ctrl+Enter snapshots the submitted editor value and stores it as local recovery.
2. If automatic cleanup applies to a newly appended nonblank thought, await it.
3. On cleanup success, replace only that thought. On cleanup failure, retain
   the raw thought. If cleanup is disabled or unsafe for the edit shape, retain
   the submitted source unchanged.
4. Re-read the source file and compare it with the last observed file text.
5. If it diverged, retain recovery and report a conflict without writing.
6. Otherwise write the final document once and wait for the writable stream to
   close before clearing recovery.

Commits are serialized per document. Permission loss, missing files, external
changes, and write failures retain recoverable content. Removing a local
document from the app never deletes its source file.

## Non-goals

- A separate Markdown source or preview mode.
- Directory selection, discovery, or background watching.
- Uploading, synchronizing, or promoting a local document to SQLite.
- Moving, renaming, or deleting the source file.
- Cross-browser support where the File System Access picker is unavailable.

## Verification

- Markdown fixtures cover headings, lists, links, blockquotes, fenced code,
  frontmatter, Unicode, line endings, BOM, and trailing newline behavior.
- File adapter tests cover one write after cleanup, cleanup failure, serialized
  commits, permission/write failure, external divergence, and recovery.
- Browser tests prove the open action is available only when supported and that
  local content causes no notebook mutation request.
