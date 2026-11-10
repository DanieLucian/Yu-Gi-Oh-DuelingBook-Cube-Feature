# Changelog

## v0.5.0 — Pending user verification
- Match saved DuelingBook IDs before falling back to unique official-card names.
- Resolve the whole XML file before writing; report conflicting IDs, ambiguous names, unmatched cards and invalid entries.
- Group repeated XML IDs without increasing Cube copies; preserve the existing Cube section for multi-section IDs.
- Accept text or attribute names and compatible XML namespaces; reject malformed/unsupported deck documents.
- Keep storage keys/export schema and local card IDs unchanged, with transactional/no-op-aware saves.
- Add XML parser/matcher module and tests; include all six runtime files in the Windows updater.

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