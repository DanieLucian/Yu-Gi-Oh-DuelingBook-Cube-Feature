# Wiki asset collection

`wiki-assets.cjs` discovers candidate files through the Yu-Gi-Oh! Wiki or
Yugipedia MediaWiki API and installs selected assets into the existing server
manifest. It runs separately from the renderer; a guest's Cube JSON cannot invoke
it. **No original wiki assets have been downloaded or verified yet.** After the
domain grants became active, fresh Fandom API, article and image-host requests
returned HTTP 402 with “Please contact the site owner for access.” This differs
from the earlier proxy tunnel denial (403); adding the domains did not establish
usable wiki access. Automated importer tests use synthetic responses/test images.

The renderer now has a working [bundled YGO Carder pack](packs/ygocarder/NOTICE.md)
from a separate, reachable GitHub source. Its provenance is recorded separately;
it is not claimed to be wiki-sourced.

For Yu-Gi-Oh! Wiki, the environment needs access to:

- `yugioh.fandom.com` — pages and API.
- `static.wikia.nocookie.net` — original file downloads.

The alternative `--source yugipedia` uses `yugipedia.com` and
`ms.yugipedia.com`. These are separate sources; choose the one you intend to use.
The helper honors the inherited proxy and CA settings on Node.js 24 LTS. It does
not bypass policy denials or website challenges.

## Discover and inspect

From the repository root:

```sh
node platform-design/renderer/wiki-assets.cjs discover --source fandom
```

This writes `platform-design/renderer/data/wiki-assets/catalog.json` after a
successful discovery. It resolves candidate Attribute/Spell/Trap/Level/Rank file
titles and searches for renderer background families, border and Link arrows.
It records original file URLs, dimensions, MIME type, file page, wiki hash,
artist/credit and reported license metadata. Empty metadata stays empty rather
than receiving an assumed license. Requests are spaced and errors stop the run.

**Candidates need visual inspection.** A search hit may be a finished card scan,
a diagram or a template with different geometry. It is not automatically suitable
as a transparent layer. Discovery is a bounded search, not an exhaustive wiki
crawl, and does not establish that every frame, font or icon is available.

Create a selection JSON using exact returned `File:` titles, for example:

```json
{
  "source": "fandom",
  "files": {
    "attribute.DARK": "File:DARK.svg"
  }
}
```

This is a selection-format example, not confirmation that this filename exists
on the selected source. Use titles from the real catalog. Supported keys are the
frame/icon/attribute/border entries in `assets/manifest.example.json`. Font files
and card artwork are not collected by this helper; their actual sources still
need to be established.

## Install selected files

Save the selection as `platform-design/renderer/data/wiki-assets/selection.json`:

```sh
node platform-design/renderer/wiki-assets.cjs install --selection platform-design/renderer/data/wiki-assets/selection.json
```

The installer resolves the selected file titles afresh through the source API,
accepts downloads only from that wiki and its known image host, and verifies
raster signatures. HTML error/challenge responses are rejected. PNG/JPEG/WebP
files are preserved. Self-contained SVG icons are decoded in an isolated Chromium
image context, then rasterized to PNG at up to 4× intrinsic size within pixel and
byte limits. No visual redrawing is involved. Active content, external image/font
references and XML entities are rejected; all browser network requests are blocked.

SVG conversion uses the repository's existing Playwright dependency. Run `npm ci`
and, if needed, `npx playwright install chromium` once. Alternatively set
`CHROMIUM_PATH` to an installed Chrome/Chromium executable. Linux's
`/usr/bin/chromium` is used when present.

Installed files use content hashes under `assets/`. Existing manifest entries and
artwork mappings are retained. All requested files must download and validate
before the active manifest is replaced. Repeating an installation reuses identical
files. Source URLs, file titles, artist/credit, reported license, original/installed
checksums and SVG conversion status are saved in `assets/wiki-attribution.json`.
Existing metadata from other imported keys is retained.

The downloaded files, attribution log, active manifest and discovery catalog are
local data, excluded from Git by the existing assets/data ignore rules. Keep the
attribution log with the asset pack when backing it up or distributing it. Restart
the renderer after installing, then compare the generated cards with the source.

## Verification

```sh
node --test platform-design/renderer/wiki-assets.test.cjs
```

Offline tests cover source/CDN boundaries, catalog discovery, attribution,
repeatability, preserved mappings, rejected bad downloads and SVG rasterization.
Live API availability, exact file names, license metadata, source image quality,
transparency and compatibility with the card geometry remain unverified until
wiki access is available.
