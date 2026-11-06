# Changelog

## 1.0.3 — 2026-11-06

### Added
- Inserting a table asks for the number of rows and columns.

### Changed
- Tables have a handle beside the current row and above the current column. Tapping one selects it and opens a menu with Cut, Copy, Paste, Add and Delete. A grid icon at the table's corner opens the same for the whole table, plus Add row, Add column and Delete table.
- Drag the pill on a column border to resize the column. It replaces the small x and + buttons around tables.

### Fixed
- A PDF or image over 200 MB no longer stops server sync; it stays on this device and the rest syncs.
- Desktop app: the sync server address must use https://, so the token is never sent unencrypted.

## 1.0.2 — 2026-11-06

### Added
- Desktop app: server sync. Settings → Sync takes the server address and sync token, and can show the pairing code for the Android app.
- Images have a Delete button in their toolbar.

## 1.0.1 — 2026-11-04

### Added
- Desktop app: right-click a note in the list for New note, New sub-note, Duplicate, Pin to top, Archive and Move to Trash.
- Desktop app: right-click in the editor or title for Cut, Copy, Paste, Undo, Redo and Select All, styled like the app's other menus.

### Fixed
- The selection format bar no longer slides under the editor toolbar when the selected text is in the first lines of a note.
- The selection format bar hides while the right-click menu is open.

## 1.0.0

First release.
