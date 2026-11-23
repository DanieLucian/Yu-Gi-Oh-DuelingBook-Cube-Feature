# Changelog

## v0.4.6 - Pending live user verification
- Extract visible Xyz `.rank` sockets separately from `.level` sockets into `visual.rank`; hidden placeholders remain unresolved.
- Prefer duplicates with known rank metadata, preserving saved copies, sections and other visual metadata.
- Added custom/official Xyz, Rank 13, Xyz Pendulum, hidden containers, duplicate, JSON round-trip and drafting-client rendered-star checks.
- Updated popup version and Windows updater checksums. Reload, refresh DuelingBook, rescan, re-export and import the new Cube JSON into the drafting page to repair older exports.

## v0.4.5 - Pending live user verification
- Extract official `duelingbookId` from DuelingBook standard `images.duelingbook.com/low-res/<id>.jpg` artwork URLs, including version queries.
- Keep existing official collection keys and saved annotations; rescans fill missing IDs while retaining XML-matched IDs. External artwork remains unresolved.
- All 62 extension tests pass in Edge, including trusted URL matching, unchanged record keys, storage preservation and JSON export/restore.
- Updated popup version and Windows updater checksums. Reload, refresh, rescan and export a fresh Cube JSON to populate older records.

## v0.4.4 � Pending live user verification
- Extract both printed Pendulum scales from `scale_left_txt` and `scale_right_txt` into renderer-compatible `visual.scaleLeft` / `visual.scaleRight` metadata. Scale 0 is retained; hidden, missing and invalid placeholders remain unresolved.
- Prefer duplicates with scale metadata and preserve saved annotations and visual metadata on rescan.
- All 59 extension tests pass in Edge, including official/custom scales, hidden Extra Deck cards, duplicate selection, renderer integration and storage/JSON round trips.
- Updated the popup version and Windows updater runtime checksums. Reload, refresh DuelingBook, rescan and re-export older Cubes to include scales.

## v0.4.3 � Pending live user verification
- Include Extra Deck (`extra_cards`) containers by ID or CSS class in editor detection, scans and full-card previews.
- Preserve duplicate handling, saved copies and manual section annotations.
- All 54 extension tests pass in Edge, including standalone/hidden/empty Extra Decks, rescans, official/custom imports and overlapping selectors.
- Updated the popup version and Windows updater runtime checksums.

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
