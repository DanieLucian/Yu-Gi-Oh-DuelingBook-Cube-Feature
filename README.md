# DuelingBook Cube Draft

An unofficial Chrome extension prototype to import custom and official Yu-Gi-Oh! cards from the DuelingBook deck editor or deck/card pages and build a local Cube collection. Online drafting is planned.

## Versions

- **v0.1.0** — Initial custom-card import and Cube management. User verified successful import of 26 unique custom cards and persistence across imports.
- **v0.2.0** — Experimental full-card previews (not yet verified by user).
- **v0.3.0** — Mixed official/custom-card import and full-card previews.
- **v0.4.0** — Cube JSON restore, manual section editing and deck-editor imports.
- **v0.4.1** — Fixed constructor detection for class-named containers; user confirmed working.
- **v0.5.0** — Reliable XML ID matching and per-card result reporting (pending user verification).

## Install / update

Use Chrome's `chrome://extensions` → **Developer mode** → **Load unpacked** and select this repository folder. For updates, replace the files in the *same* directory and click **Reload** in Chrome; do not remove the extension without backing up your saved Cube JSON.

## Roadmap

1. Validate complete-card previews and mixed official/custom imports.
2. Improve Cube editing, duplicate/copy management, and XML ID reconciliation.
3. Add synchronized four-player drafting and final 40-card deck building.
4. Export DuelingBook-compatible XML decks.

This project is unofficial and not affiliated with DuelingBook. Only import cards you have rights to access and use.

Windows users can download the [ZIP updater and launcher](docs/windows-update.md)
into the same folder and double-click **run-update.cmd**, then choose the ZIP. The
target folder is prefilled, replaced runtime files are backed up, and startup
errors stay visible in the console.

## Import from the deck editor

Reload the extension and refresh your DuelingBook tab after updating. Open the
Deck Constructor/editor, load a deck, then use **Scan & import current page**.
All recognized cards inside `deck_cards` and `side_cards` containers (IDs or
CSS classes) are included. Search
results and hover cards outside those containers are excluded. Existing IDs are
refreshed without increasing saved copy counts or replacing manual annotations.
See [deck-editor checks](docs/deck-editor.md) for details and remaining live checks.

## Manage and restore a Cube

Use each card's **Section** menu to select Unassigned, Main Deck, Extra Deck or
Side Deck, and **Copies** to set its quantity (1–99). These are collection
annotations; they do not enforce deck legality or change drafting rules.

**Export Cube JSON** saves a backup. **Import Cube JSON** adds missing card IDs
from a backup in the existing `dbcd-cube-v1` format. Existing cards, quantities,
and annotations stay unchanged; repeated import does not add copies together.
Same-name cards with different IDs remain separate.

See [Cube management behavior and manual checks](docs/cube-management.md) for
validation details, exact-restore instructions and remaining limitations.

## Match DuelingBook XML IDs

Use **Match card IDs from XML** with an exported DuelingBook deck. Known IDs match
first; otherwise an official card must have a unique normalized name. Conflicting
bindings, ambiguous names and unmatched cards appear in the results panel. Matching
never creates cards or changes copies. Cards appearing in several XML sections
keep their current Cube section. See [XML matching rules and manual checks](docs/xml-matching.md).

## Development and automated checks

No application build or runtime dependencies are required. Load this directory as
an unpacked Chrome extension. Test tooling requires Node.js 20+ and Chromium:

```sh
npm ci
CHROMIUM_PATH=/usr/bin/chromium npm test
```

Set `CHROMIUM_PATH` to your Chromium/Chrome executable if it is elsewhere. Browser
tests use Playwright with isolated synthetic fixtures; pure matcher tests run in
Node. They cover backup restore, collection edits, previews and XML matching
without contacting DuelingBook. See [preview review and manual checks](docs/preview-review.md).
