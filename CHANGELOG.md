# Changelog

## Unreleased

### Added
- Background color for notes, from the note's … menu: three rows of presets (Soft, Vivid, Deep) that adjust for dark mode. The color shows on the note page and its card in the list.
- A vertical line beside sub-notes in the list, in the parent note's color.
- Export a note as PDF, text, JSON or HTML from the note's … menu.

### Changed
- Search moved from the sidebar to the top of the note list, so it stays open when the sidebar is floating.
- New app icon.

## 1.0.4 — 2026-11-07

### Added
- Link to note: link selected text to another note from the selection format bar, the note's … menu, or the desktop right-click menu. With nothing selected, it inserts the note's title as a link. Clicking a note link opens that note.
- The Link to note picker has a search field, shows a line of each note's text, and offers Remove link when the selection already links to a note.
- Undo and Redo buttons in the note header, greyed out when there is nothing to undo or redo.

### Changed
- A to-do's date opens a calendar right above its date button instead of the system picker, which could appear in the corner of the screen.

### Fixed
- Desktop app: right-click Undo and Redo are greyed out when there is nothing to undo or redo.

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
