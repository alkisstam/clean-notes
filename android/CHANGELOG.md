# Changelog — Android app

## 1.0.8 — 2026-11-14

### Added
- Reminders for whole notes. Add reminder in a note's long-press and … menus, or the pill under Tags inside the note, picks a date and time; a date without a time reminds at 9:00. The pill shows the reminder once set.
- A breadcrumb above the note title shows where the note is, like Notebooks › Projects › Clean Notes › To-Do. Tap a parent note to open it.
- Pinch or double tap to zoom images and PDFs. A zoomed image can be dragged around.

### Fixed
- The formatting pop-up no longer shows a button as on (like Bold) after you select different text.
- A selected image's toolbar and resize handle go away when you tap anywhere outside the image.

## 1.0.7 — 2026-11-12

### Added
- Reminders for to-dos. The date dialog, in Tasks and from a to-do's date button, has an Add reminder row that picks a time on that date. A notification shows at that time and opens the note. Ticking the to-do stops it.
- The reminder time shows after the date, like "Today 09:00".
- A copy button in the corner of each code block copies its code.
## 1.0.6 — 2026-11-11

### Added
- Email addresses and phone numbers in notes become links that open the mail app or the dialer. Numbers starting with + or with 10 or more digits link as you type, and pasted numbers can have spaces.

### Fixed
- Closing a note returns the list to where you were instead of the top.

## 1.0.5 — 2026-11-10

### Added
- Share a note from its ⋮ menu: pick PDF, Text, JSON or HTML and the system share menu opens.
- Select mode for notes, from the list's ⋮ menu or a long press, with a tick-box on each note and Select all. A floating bar offers Move, Share, Pin and Delete, and More has Export, Duplicate, Archive, Tags and Color.
- Moving notes opens a Select Notebook popup with a Create Notebook option at the end.
- Sharing or exporting several notes makes one combined file.
- "New note - Clean Notes" in the system share menu turns shared text, images and PDFs into a new note.
- Icons on every entry in the ⋮, long-press and sort menus.
- Tapping a website link in a note shows an "Open link" button under it.
- A line under the note title shows when it was created and last edited.
- An arrow at the end of the toolbar scrolls to the icons that don't fit.

### Fixed
- Links on colored notes in dark mode stand out from the text.
- The to-do tick now adapts to the color of its box.
- Opening an image full size no longer scrolls the note back to the top.
- The first PDF opened after launch no longer stays on "Opening…" until tapped again.
- The editor no longer keeps the processor busy while a note is open.

## 1.0.4 — 2026-11-08

### Added
- Background color for notes, from the note's ⋮ menu or a long press: three rows of presets (Soft, Vivid, Deep) that adjust for dark mode. The color shows on the note page and its card in the list and grid.
- A vertical line beside sub-notes in the list and grid, in the parent note's color.
- Export a note as PDF, text, JSON or HTML from the note's ⋮ menu.
- Grid view for the notes list, with a toggle that is remembered.
- Table style, in the table options menu: highlight the header row or first column, and set the borders, color and text of the whole table, with a live preview.
- Cell style, in the row and column menu: set the color and text of the selected cells, with a live preview.
- The first tap on a row or column handle selects it, and dragging the round grips extends the selection. A second tap opens the menu.

### Changed
- Tags on a note are set from an "Add tags" popup under the title.
- Back from a linked note returns to the note that linked to it.
- New app icon.
- A table's header row is no longer shaded or bold unless its highlight is turned on.
- The keyboard stays hidden while selecting table cells and in the table menus.

### Fixed
- Opening a colored note no longer flashes another color first.
- Links, highlights and the active buttons in the text and image toolbars stay visible on colored notes, with their colors chosen to suit the note's color.
- Sub-notes in the list keep a gap between their colored card and the vertical line.

## 1.0.3 — 2026-11-07

### Added
- Link to note: link selected text to another note from the selection format bar, the system text selection menu, or the note's ⋮ menu. With nothing selected, it inserts the note's title as a link. Tapping a note link opens that note.
- The Link to note picker has a search icon, shows a line of each note's text, and offers Remove link when the selection already links to a note.
- A Sort button in the notes list: Last edited, Date created or Title. The choice is remembered.
- Move into note has a search icon to find the note.

### Changed
- A to-do's date in a note opens the same calendar as the Tasks screen.
- Viewing an image full screen hides the top bar and tags, as the PDF viewer does. Back closes the image.

## 1.0.2 — 2026-11-06

### Added
- Inserting a table asks for the number of rows and columns.

### Changed
- Tables have a handle beside the current row and above the current column. Tapping one selects it and opens a menu with Cut, Copy, Paste, Add and Delete. A grid icon at the table's corner opens the same for the whole table, plus Add row, Add column and Delete table.
- Drag the pill on a column border to resize the column. It replaces the small x and + buttons around tables.
- Menus have larger rounded corners and roomier rows, and the + menu shows an icon for each option.
- Long-pressing a note opens its menu in the middle of the screen.

### Fixed
- Adding a large PDF no longer crashes the app, and neither does Download / Open with on one. Files over 200 MB are refused with a message.
- Undo after deleting an image brings the image back instead of a broken block.
- A backup restored while a sync runs now sends its notebooks and deletes to the server.
- A note that fails to save shows a message instead of losing the edit silently.
- A PDF or image over 200 MB no longer stops sync; it stays on this device and the rest syncs.

## 1.0.1 — 2026-11-06

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
