# Cube management in v0.4

## Backup restore

Export and import use the existing `dbcd-cube-v1` object with `schema`,
`exportedAt` and a `cards` array. Storage remains
`chrome.storage.local.dbcd_cards_v1`; there is no migration or new permission.

Import validates the entire file before writing. It rejects malformed JSON,
unsupported schemas, missing names or identifiers, duplicate identifiers inside
one backup, invalid sections and copies outside the existing integer 1–99 range.
Recognized identifiers remain numeric custom IDs or `official:` plus eight
lowercase hex digits. Missing sections become Unassigned. Known text fields must
be strings when present. Extra card metadata is retained.

Restore merges by card ID. New IDs are added with their saved copies, import
dates and XML annotations. Existing IDs are skipped completely so current edits
are not overwritten and copies are not summed. A summary reports additions and
skips. Names alone never merge records: different artwork/IDs can represent
intentional variants. Importing the same backup twice is idempotent.

To restore an exact earlier snapshot instead of merging, first export the current
Cube if you want to keep it, then use **Clear local collection** (with its existing
confirmation) and import the desired backup. Import alone never deletes cards.

## Section and copy editing

The Section menu offers Unassigned, Main Deck, Extra Deck and Side Deck. Copies
retain the existing 1–99 limit. These annotations describe the collection; they
do not implement draft selection, legality checks or multiplayer behavior.

Page reimport refreshes extracted card fields but keeps copies, an assigned
section, reconciled DuelingBook ID, original import date and unknown metadata.
XML matching still assigns sections for its matched cards, so it can replace a
manual section assignment. It does not alter quantities.

Writes are queued within the popup and operate on a clone of the last saved
collection. The displayed collection changes only after Chrome storage accepts
the write. A failed edit restores its input and reports the error; subsequent
edits can still save. Export waits for queued edits so a just-edited copy count
is included in the backup.

## Automated verification

`npm test` exercises the real popup code in Chromium with mocked Chrome APIs and
isolated fixture data. The 20 Cube-management checks cover:

- Export/import round trip with existing custom and official IDs and metadata.
- Repeated imports, duplicate handling and different IDs sharing a name.
- Whole-file rejection for malformed backups without partial writes.
- Section/copy changes across popup reload and page reimport.
- Failed writes, recovery, XML annotation compatibility and rapid edits/export.

The existing 10 preview/storage checks and 11 [deck-editor checks](deck-editor.md)
also remain in the suite (41 total). A popup fixture
was visually inspected at its 464 px width. This is not an installed-extension
or live DuelingBook test. This environment's Chromium did not load the unpacked
extension through command-line flags, and its extension-loading CDP method was
unavailable, so real extension storage verification remains a manual check.

## Checks in your Chrome profile and DuelingBook

1. Export a v0.3 Cube backup before updating. Keep the extension installed, replace
   files in the same unpacked folder and reload it in `chrome://extensions`.
2. Confirm the existing collection, counts, previews and XML annotations load.
3. Change a card's copies and section. Close and reopen the popup. Reimport the
   same DuelingBook deck and confirm the manual changes persist.
4. Import a backup with both existing and new IDs. Confirm only new IDs are added,
   and importing it again does not change counts or existing annotations.
5. Export immediately after editing copies, inspect the JSON, and restore it into
   a separate test profile. Compare IDs, quantities, sections and artwork.
6. Try a malformed backup and confirm the collection stays unchanged. Cancel the
   file picker and try the same file again.
7. Match a DuelingBook XML file and confirm the expected sections and IDs change,
   with copies untouched. Preview an imported official and custom card on a deck
   that currently renders them.

## Remaining limitations

- Writes are serialized within one popup, not across multiple Chrome windows.
  Simultaneous popups can still overwrite each other's whole-collection writes.
- Closing a popup during a queued operation can interrupt it; wait for the result
  before closing. There is no background writer or automatic backup.
- Official identifiers still depend on name and artwork URL; a changed URL can
  create a new entry. No automatic variant consolidation is attempted.
- Restoring stored card data does not make its full preview available offline.
  Preview still needs the matching card rendered on the active DuelingBook page.
- XML ambiguity handling and import DOM selectors are unchanged. Deck XML export
  and multiplayer remain later work.
