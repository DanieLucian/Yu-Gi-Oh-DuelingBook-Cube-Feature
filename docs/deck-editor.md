# Import from the DuelingBook deck editor

## Behavior

The extension now recognizes the deck editor inside DuelingBook's main app,
including the root page and app routes with a query or hash. Its content script
runs on `https://www.duelingbook.com/*`, using the host permission it already had.
The popup checks for the editor's `deck_cards` or `side_cards` container before
enabling import on app routes. Lobby pages without either container stay disabled.
Published `/deck` and `/card` pages continue to work.

When either container exists, scan and preview candidates are restricted to
`.cardfront_content` elements within containers named `deck_cards` and
`side_cards`, matched by **ID or CSS class**. Both
containers are read each time; moving, adding or deleting editor cards is
reflected in the next scan. A hidden container or an offscreen card is included.
Empty containers return an empty import rather than falling back to unrelated
search results or hover previews elsewhere in the page.

The existing card extractor handles custom and official cards without changing
their IDs or the `dbcd_cards_v1` storage format. Duplicate IDs in either/both
containers become one Cube record. Deck occurrences do not increase Cube copies;
existing quantities and manual/XML annotations stay intact on reimport. New cards
use the existing defaults (one copy, Unassigned section); sections are not guessed
from the container, since one record can occur in both containers and the deck
container may include Extra Deck cards. Use the Section menu or XML matching to
assign them.

## v0.4.1 detection fix

v0.4.0 checked only element IDs. A constructor exposing `.deck_cards` and
`.side_cards` classes therefore returned `editor: false`, disabling the button.
v0.4.1 uses the same combined ID/class selector for detection, scanning and
preview. Mixed/overlapping matches do not count one node twice. Empty class-named
containers still exclude unrelated search cards. Regression fixtures reproduced
the disabled-button failure before the fix and pass afterward. The screenshot
alone does not confirm the live DOM structure; the fix still needs a test in the
user's signed-in constructor page.

## Automated checks

16 Chromium tests cover mixed official/custom deck and side cards, excluded
search/hover nodes, hidden cards, a single container, empty containers, changing
the editor after script injection, preview scoping, popup-to-content import from
the root and an app URL, duplicate reimport/storage preservation, lobby gating,
origin checks and missing content scripts. These run alongside the existing 30
checks (46 total).

Tests use synthetic DOM fixtures based on the supplied container names (both ID and class forms) and the
existing `.cardfront_content` card markup. Live DuelingBook rendering and timing
still require verification; no signed-in session or captured editor DOM is
available in the test suite.

## Manual Chrome and DuelingBook checks

1. Export your Cube as a backup. Replace files in the same unpacked extension
   directory, reload it in `chrome://extensions`, then **refresh the DuelingBook
   tab**. This refresh is needed for the expanded content-script URL matching.
2. Open Deck Constructor/editor and load a deck with official and custom cards
   across the deck and side containers. Wait for names and artwork to load.
3. Open the popup. It should show **DuelingBook deck editor detected** on the
   app page. Click **Scan & import current page** and check both containers' cards
   are represented; search results and hover cards should not be added.
4. Put the same card into both containers, scan twice, and confirm one unique
   record remains with its saved copy count and section. Existing cards in the
   Cube are retained if you remove them from the editor; import does not delete.
5. Add/remove/move editor cards, reopen the popup and scan again. Check the new
   cards appear and previews show the selected deck/side card rather than a hover
   duplicate. Test an empty deck with search results visible.
6. Open a published deck page and a single-card page to confirm their existing
   import and preview behavior. Check JSON export/restore remains compatible.
