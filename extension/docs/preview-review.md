# Preview architecture review

## Architecture and compatibility

`popup.js` owns the collection UI, Chrome local storage, JSON export and XML
annotation. `content.js` scans rendered DuelingBook DOM and answers `DBCD_SCAN`
and `DBCD_PREVIEW` messages. The manifest injects it on deck/card pages; there is
no background worker or server.

Storage remains `chrome.storage.local.dbcd_cards_v1`, keyed by the existing custom
IDs or deterministic `official:` keys. The `dbcd-cube-v1` export schema, extraction
fields, reimport merge behavior, and draft rules are unchanged. Preview code does
not write storage. A regression test loads an existing collection and verifies
copies, section, DuelingBook ID and import date survive reimport.

## Changes

- Replaced the fixed 813 × 1185 root override with source layout dimensions,
  ignoring ancestor grid transforms. A missing size now produces a useful error.
- Copy all computed styles, including clipping, visibility, background layers and
  typography, plus generated before/after content. Preserve type-specific hidden
  fields and child transforms; only reset the root placement and transform.
- Isolate the snapshot in a shadow root so ancestor/site selectors cannot change
  Monster, Spell, Trap, Fusion, Synchro, Xyz, Link or Pendulum layout after cloning.
- Freeze resolved image URLs and disable animation/transition on the snapshot.
- Prefer a laid-out duplicate, scale on resize, and clean up both keyboard and
  resize listeners when closing or replacing the preview. Focus the close button,
  contain Tab, support Escape/backdrop dismissal and restore prior focus.
- Added Chromium fixture tests for eight card types, repeated preview, scanning
  with an overlay open, narrow viewport resizing, close paths, missing IDs, and
  existing storage/reimport behavior.

## Potential bugs and remaining limitations

The old preview selected the first DOM match, forced one size onto different
layouts, copied only a subset of styles, and leaked its Escape listener when
replaced. These are addressed here.

The following remain outside this preview change:

- Import depends on DuelingBook's private DOM classes and includes hidden card
  nodes. Stale preview/template cards may be imported. Validate on real decks.
- Official IDs hash name + artwork URL, not the official DuelingBook ID. Artwork
  path or name changes can create a second record; XML reconciliation is still
  needed. Changing that scheme requires a deliberate storage migration.
- Concurrent popups may overwrite each other's whole-collection storage writes.
- Reimport overwrites unknown extension fields because it spreads the incoming
  card rather than the old record. The existing documented fields are preserved.
- Snapshot previews require a rendered source card, loaded fonts/assets, and
  layout dimensions. They cannot reconstruct cards from stored artwork alone.
- Computed style cloning cannot reproduce canvas contents, closed shadow roots,
  or dynamically changing page content. A transformed root or unusual parent
  layout may still need adaptation against the live site.

## Required DuelingBook checks

Automated tests use synthetic fixtures, not captured DuelingBook DOM. They verify
snapshot mechanics rather than certify the site's current visual output.

1. Reload the unpacked extension in the same Chrome profile, refresh the deck,
   and confirm the existing Cube still has the same cards/copies/annotations.
2. Import a mixed official/custom deck. Compare names and artwork and repeat the
   import to verify deduplication and annotation persistence.
3. Preview Normal/Effect/Ritual Monsters, Normal/Quick-Play/Continuous/Field/Equip
   Spells, Normal/Continuous/Counter Traps, Fusion, Synchro, Xyz, Link, and Pendulum
   cards (including Pendulum Extra Deck variants).
4. Compare frame layers, name colors, attribute/type icons, level/rank stars,
   artwork crop, type line, long effects, ATK/DEF, Link arrows/rating and Pendulum
   scales/effect with the original page. Check non-Latin names and custom fonts.
5. Check hidden/visible duplicate card nodes, long decks and lazy-loaded art;
   retry previews after art/fonts finish loading. Test card pages as well as decks.
6. Resize/zoom Chrome and use a small viewport. Replace previews repeatedly; close
   with Escape, button and backdrop. Ensure the source deck remains unchanged.
7. Export JSON and match an XML file before/after these checks; confirm no storage
   migration and unchanged `dbcd-cube-v1` output.
