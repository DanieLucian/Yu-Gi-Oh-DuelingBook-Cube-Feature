# Changelog

## v0.4.2 — Pending live user verification
- Extract Spell/Trap subtypes from DuelingBook's displayed `type_icon` into `visual.spellTrapIcon`, which the renderer already supports.
- Treat hidden placeholder icons as Normal only with an active Spell/Trap header; leave missing or unknown icons unresolved and ignore hidden stale monster type text.
- Prefer duplicate records with subtype metadata and preserve other saved visual metadata on rescan.
- Added extraction-to-renderer coverage for all nine Spell/Trap combinations on both custom and official cards, plus unknown/missing icons, duplicates, rescan and JSON export/restore checks. All 50 extension tests pass.
- Updated the extension version and Windows updater runtime checksums. Rescan and re-export existing Cubes to recover missing subtypes.

## v0.4.1 — Pending user verification
- Fixed constructor detection, scanning and previews for `deck_cards`/`side_cards` containers identified by CSS class as well as ID.
- Added five regression tests, including the disabled-button case, empty class containers and overlapping selectors.
- Refreshed the Windows updater checksums for the corrected runtime.

## v0.4.0 — Pending user verification
- Added Deck Constructor/editor import from `deck_cards` and `side_cards`, excluding search results and hover cards outside those containers.
- Enabled the existing content script on DuelingBook app routes and detect the editor when opening the popup; no new host permissions.
- Added Cube JSON import using the existing backup format; existing card IDs and copy counts stay unchanged.
- Added per-card Main/Extra/Side/Unassigned section controls.
- Preserved unknown card metadata when refreshing cards from DuelingBook.
- Staged and queued popup edits so failed storage writes do not change displayed state. Export waits for pending edits.
- Added automated backup, duplicate, editing, storage-failure and XML regression coverage.
- Kept storage keys, identifiers, export schema and drafting rules unchanged.

## v0.3.0 — Experimental
- Added mixed official/custom-card detection and import.
- Retained saved custom Cube collection across updates.
- Official-card local identifiers may require XML reconciliation.

## v0.2.0 — Experimental
- Added full-card preview overlay from currently rendered DuelingBook cards.

## v0.1.0 — Tested
- Initial custom-card import from deck/card pages.
- Deduplication by DuelingBook custom ID.
- Local collection editing, quantities and JSON export.
- User confirmed 26 unique Berserk custom cards and persistence after another deck import.
