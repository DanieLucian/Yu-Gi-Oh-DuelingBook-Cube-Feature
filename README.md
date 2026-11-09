# DuelingBook Cube Draft

An unofficial Chrome extension prototype to import custom and official Yu-Gi-Oh! cards from DuelingBook deck pages and build a local Cube collection. Online drafting is planned.

## Versions

- **v0.1.0** — Initial custom-card import and Cube management. User verified successful import of 26 unique custom cards and persistence across imports.
- **v0.2.0** — Experimental full-card previews (not yet verified by user).
- **v0.3.0** — Mixed official/custom-card import and full-card previews.
- **v0.4.0** — Cube JSON restore and manual section editing (pending user verification).

## Install / update

Use Chrome's `chrome://extensions` → **Developer mode** → **Load unpacked** and select this repository folder. For updates, replace the files in the *same* directory and click **Reload** in Chrome; do not remove the extension without backing up your saved Cube JSON.

## Roadmap

1. Validate complete-card previews and mixed official/custom imports.
2. Improve Cube editing, duplicate/copy management, and XML ID reconciliation.
3. Add synchronized four-player drafting and final 40-card deck building.
4. Export DuelingBook-compatible XML decks.

This project is unofficial and not affiliated with DuelingBook. Only import cards you have rights to access and use.

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

## Development and automated checks

No application build or runtime dependencies are required. Load this directory as
an unpacked Chrome extension. Test tooling requires Node.js 20+ and Chromium:

```sh
npm ci
CHROMIUM_PATH=/usr/bin/chromium npm test
```

Set `CHROMIUM_PATH` to your Chromium/Chrome executable if it is elsewhere. Tests
use Playwright with an isolated browser and synthetic page fixtures; they do not
contact DuelingBook. They cover backup restore, collection edits and preview
rendering. See [preview review and manual checks](docs/preview-review.md).
