# Chrome extension

An unofficial Chrome extension prototype to import custom and official Yu-Gi-Oh! cards from the DuelingBook deck editor or deck/card pages and build a local Cube collection.

See the [changelog](CHANGELOG.md) for the release history.

## Build, install, and package

From the repository root with Node.js 24, run `node extension/build.cjs`.
The five runtime files are written to `dist/extension/`. In
`chrome://extensions` → **Developer mode** → **Load unpacked**, select
that folder. Rebuild into the same folder and click **Reload** after changes.

Before switching an older unpacked install to a new directory, export its
Cube JSON from the popup. Chrome can assign a different extension ID to a
different unpacked path. Import the backup in the new install. If your
extension already lives in a dedicated directory, update that directory in
place with the [Windows ZIP updater](docs/windows-update.md) and reload.
Chrome Web Store installs receive updates under their existing listing ID.

Use the inner `duelingbook-extension.zip` from the **chrome-web-store**
artifact of the [Chrome extension workflow](../.github/workflows/extension.yml).
The ZIP has `manifest.json` at its root. To create it from a local build on Windows:

~~~powershell
Compress-Archive -Path .\dist\extension\* -DestinationPath .\dist\duelingbook-extension.zip -Force
~~~

On Linux or macOS, run `(cd dist/extension && zip -X ../duelingbook-extension.zip manifest.json content.js popup.html popup.css popup.js)`.
Upload the inner ZIP to the existing Chrome Web Store listing. For an extension
release, bump the version in the manifest and popup and refresh the five
updater hashes from the built files. The packaging test verifies those hashes.

## Import from the deck editor

Reload the extension and refresh your DuelingBook tab after updating. Open the
Deck Constructor/editor, load a deck, then use **Scan & import current page**.
All recognized cards inside `deck_cards`, `extra_cards` and `side_cards` containers (IDs or
CSS classes) are included. Search
results and hover cards outside those containers are excluded. Existing IDs are
refreshed without increasing saved copy counts or replacing manual annotations.
See [deck-editor checks](docs/deck-editor.md) for details and remaining live checks.

Spell/Trap scans now include `visual.spellTrapIcon` (`normal`, `continuous`,
`counter`, `equip`, `field`, `quick-play`, or `ritual`) from the displayed subtype
icon. Normal cards correctly have no icon. Unknown or unavailable subtype data
is left unresolved. Scanning preserves saved copies, sections and other visual
metadata, and Cube JSON export/restore carries the subtype through to the renderer.

To repair older exports with missing icons, reload the extension, refresh
DuelingBook, scan each deck containing your Cube cards again, then export a fresh
Cube JSON and load it into the drafting platform/renderer. Old JSON alone cannot
recover a subtype that was never extracted.

Pendulum scans save both printed scales as `visual.scaleLeft` and
`visual.scaleRight`, including scale 0. Reload the extension, refresh DuelingBook,
rescan decks containing Pendulum cards and export a fresh Cube JSON to repair
older exports. Existing copies, sections and other visual metadata are preserved.

Official cards using `https://images.duelingbook.com/low-res/<id>.jpg` now save
that numeric ID in `duelingbookId`. Existing `official:` collection keys remain
unchanged, so rescanning fills missing IDs without duplicating saved cards.
External or unrecognized artwork URLs still require XML matching. Previously
XML-matched IDs are preserved. Reload, refresh DuelingBook and rescan to update
older records, then export a fresh Cube JSON.

Xyz scans now count the separate `.rank` stars and save `visual.rank`. To repair
Cube JSON with missing ranks, reload the extension, refresh DuelingBook, rescan
your Xyz cards, export a fresh Cube JSON and import it into the drafting page.
The missing ranks cannot be recovered from an old export alone.

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

From the repository root, install the locked test dependencies and a browser:

~~~sh
npm ci
npx playwright install chromium
npm run test:extension
~~~

Set `CHROMIUM_PATH` to use an existing Chrome or Edge executable.
The independent extension suite exercises the built runtime with synthetic
DuelingBook pages. Run `npm run test:integration` to check that exports
also reach the drafter renderer. See [preview checks](docs/preview-review.md).
