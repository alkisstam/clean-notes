# Changelog — Android app

## Unreleased

### Added
- A + button in a note for New note, New sub-note, Add image and Add PDF. New sub-note moves here from the ⋮ menu.
- Undo and Redo buttons in a note, greyed out when there is nothing to undo or redo.
- Long-press a note in the list for the same options as its ⋮ menu.
- Images have a Delete button in their toolbar.

### Changed
- Pinned notes show a pin icon after the title instead of the word "Pinned".
- The selection format bar appears below the selected text, clear of the system's Cut/Copy bar.
- PDFs open full screen with only their own toolbar; back still closes them.
- A new note or sub-note left empty is discarded on leaving it.

### Fixed
- The QR scanner in Settings → Connect crashed the release build before opening.
- The keyboard no longer opens when a PDF opens or when an image is tapped.
- Tapping low in a note scrolls the cursor above the keyboard.

## 1.0.0 — 2026-11-05

First release. Notes work fully offline on the phone; syncing with the web app is optional and goes through your own Clean Notes server.

### Added
- Notes edited with the same editor as the web app: formatting toolbar, slash commands, tables, task lists with due dates, images and PDFs.
- Images and PDFs added from the phone's file picker; PDFs open in the web's viewer with search, zoom and dark mode. Download buttons hand the file to other apps through "Open with".
- Sync with the web app: connect by scanning the QR code in the web's Settings → Sync, or by entering the server address and token. Changes sync on leaving the app, a minute after editing, and every 15 minutes in the background, including edits made offline.
- Drawer in the web's order with its icons and counts: All notes, Today, Tasks, PDFs, Pinned, Archive, Trash, Notebooks and Tags.
- Today: a Daily notes page with the web's calendar; tap a day to open its note, and step between days with the arrows in a daily note.
- Tasks from every note, grouped into Overdue, Today, Upcoming, No date and Completed, with due dates and quick add to today's note.
- Notebooks: create, rename, delete, and move notes between them.
- Tags: chips on each note with suggestions, a collapsible tag tree, and renaming or deleting a tag across all notes.
- Sub-notes: nested in the list with collapse arrows, New sub-note, Move into note and Move to top level.
- Pinned and Archive, and a Trash with Restore, Delete forever and Empty Trash.
- Search across titles, text, tags and the text inside PDFs, ignoring case and accents (Greek included); a PDF hit opens at the matching page.
- Settings: System, Light or Dark theme; the web's fonts or the phone's own; sync status with Sync now; backup export and import in the web's backup format; storage used and app version.
