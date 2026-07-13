# Changelog

## Unreleased

- Added local OpenAI-compatible agent setup stored in the browser.
- Added automatic per-thought spelling and grammar cleanup after Enter.
- Preserved each original submitted thought and kept failed cleanup non-destructive.
- Split the original monolithic page into focused HTML, style, controller, setup, persistence, agent, and thought modules.
- Kept the desktop organizer pinned while long notes scroll.

All notable changes to AgenticScribe will be documented here.

## [Unreleased]

### Added

- Approved continuous note-taking interface for desktop and mobile.
- Enter-only IndexedDB note persistence.
- Multiple notes, Scratchpad, nested folders, movement, and confirmed deletion.
- Local unit coverage and Playwright browser verification.
