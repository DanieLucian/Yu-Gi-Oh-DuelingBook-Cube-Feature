# Server-side card rendering proof of concept

The PC server combines card JSON with **local** backgrounds, border, icons, fonts
and artwork into one self-contained SVG. Browsers display the generated image;
they do not rebuild the card or contact DuelingBook. Rendered images are cached
on disk, with identity based on visual content, embedded asset bytes and renderer
version. Changes to copies/sections do not regenerate an identical card image.

A **bundled template pack** now supplies 67 unchanged PNG/WOFF2 files from
[YGO Carder](https://github.com/lauqerm/ygocarder). See the
[original authors and source notice](packs/ygocarder/NOTICE.md) and per-file
checksums in `packs/ygocarder/provenance.json`. These files came from GitHub,
not the wiki. Card illustrations remain separate.

The local gallery uses this pack automatically unless `assets/manifest.json`
is present. Missing files/details produce diagnostics. Coordinates follow the
pack's 813 × 1185 layout with DuelingBook presentation rules. Width-aware text
fitting is implemented; exact matching and non-Latin fallbacks still need real-card
comparison. This is a rendering experiment, separate from
the draft simulation and multiplayer server.

![Bundled frame and icons in the server rendering gallery](template-preview.jpg)

## Run on your PC

Install Node.js 24 LTS, open a terminal at the repository root, then run:

```sh
node platform-design/renderer/server.cjs
```

Open the address printed in that terminal (`http://127.0.0.1:3210`). The process
listens only on your PC's loopback interface. Set `PORT` if that port is occupied.
No npm installation is needed for the renderer itself.

The gallery has fictional Normal/Effect/Ritual/Fusion/Synchro/Xyz/Link/Pendulum,
Spell and Trap records. You can also select an extension Cube JSON and choose a
card from it. That sends one selected card to the local renderer, not the whole
Cube library. The gallery does not save Cubes, change the JSON, or perform a draft.

## DuelingBook appearance

The supplied **Torrential Tribute** screenshot is the current style reference.
The gallery includes a text-only Torrential Tribute sample; its illustration
remains a placeholder.

![Torrential Tribute appearance reference, without artwork](torrential-preview.png)

- Names are white for Spell, Trap and Xyz frames, including Xyz Pendulum, and
  black for all other frames, including Link.
- Names use an 80 px small-cap face and compress horizontally when necessary.
  Their rendered strokes are softened slightly because the bundled font's bold
  outlines are baked in. Glyph shape, height and spacing stay unchanged.
- Artwork borders use one neutral gray bevel for all card families. Main text
  boxes share the reference's gold/bronze outline; their pale type-specific
  background textures remain distinct.
- Ordinary effect text starts at 26 px instead of 21 px. Line breaks use measured
  font widths. Dense effects reduce gradually to 16 px to fit the available area.
  Pendulum and monster effects keep separate regions, and stats retain their space.
- Normal Spell/Trap headers align to the right without reserving an empty subtype
  icon slot. Their subtype icons remain separate when present.

The shared borders reuse crops of the unchanged Effect frame in the generated
SVG. The artwork bevel is desaturated at render time. Original PNG/WOFF2 files
and their source checksums are unchanged.

`font-metrics.json` contains precomputed glyph advances and pair adjustments for
the bundled fonts, tied to their SHA-256 hashes. This keeps rendering independent
of browser/font-engine installation on the PC server. Only developers regenerating
the measurements need Playwright:

```sh
node platform-design/renderer/build-font-metrics.cjs
```

Custom font files without matching measurements use approximate widths and report
that in diagnostics. Unsupported glyphs use conservative estimates; validate
non-Latin and fallback-font cards visually on the target computer.

## Collect assets from a wiki

A separate [wiki asset importer](WIKI-ASSETS.md) can discover and install selected
frames/icons through the Yu-Gi-Oh! Wiki or Yugipedia API, retaining source credits
and converting self-contained SVG icons to PNG. Its offline tests pass; live
collection remains unavailable: after the domain grants became active, Fandom
and its image CDN returned HTTP 402 with “Please contact the site owner for
access.” No wiki files are bundled or verified. The working bundled pack uses
the separately credited GitHub source above.

## Use or customize the asset pack

The bundled pack is ready to use with the start command above. It contains nine
base frame families, separate Pendulum layers, attributes, subtype/Level/Rank
icons, Link arrow layers and two fonts. Its manifest composes these original
layers without changing their bytes. Template originals are stored and served
from your PC, with no runtime request to GitHub or the wiki.

To customize it, copy the **whole** `packs/ygocarder/` directory into `assets/`,
including its notice and provenance, then edit `assets/manifest.json`. This lets
you add `artworks` mappings while retaining the supplied frames and fonts. An
existing custom manifest takes precedence and is not overwritten automatically.

For an independent pack with your own files:

1. Copy `assets/manifest.example.json` to `assets/manifest.json`.
2. Put the frame, border, icon, artwork and font files under `assets/`.
3. Replace the corresponding `null` values with paths relative to that directory.
   Entries left null remain explicit missing assets.
4. Restart the renderer after editing the manifest or asset files.

For example, **merge** these entries into the example manifest:

```json
{
  "version": 1,
  "files": {
    "border": "frames/border.png",
    "background.effect": "frames/effect.webp",
    "background.effect-pendulum": "frames/effect-pendulum.webp",
    "attribute.DARK": "attributes/dark.png",
    "icon.level": "icons/level.png",
    "icon.rank": "icons/rank.png",
    "icon.quick-play": "icons/quick-play.png",
    "font.name": "fonts/name.woff2",
    "font.body": "fonts/body.woff2"
  },
  "artworks": {
    "https://www.duelingbook.com/custom-pics/0/42.jpg": "artwork/42.jpg"
  }
}
```

The artwork map uses the **exact** `artwork` string in the Cube JSON, including
any query string. This makes asset resolution explicit. An uploaded URL is never
treated as a server file path or fetched over the network. Automated artwork
acquisition is not implemented; the original files must be placed locally first.

The manifest covers:

| Asset | Convention |
| --- | --- |
| Border | Full 813 × 1185 canvas, transparent except for the outer border; painted last |
| Background | Full 813 × 1185 canvas; normal, effect, ritual, fusion, synchro, xyz, link, spell, trap |
| Pendulum background | Separate `<monster frame>-pendulum` variants, including Extra Deck variants |
| Attributes / badges | DARK, LIGHT, EARTH, WATER, FIRE, WIND, DIVINE; Spell/Trap header badges |
| Level/Rank | Separate transparent icons; repeated by the known Level/Rank |
| Spell/Trap subtype | continuous, counter, equip, field, quick-play, ritual; Normal has no subtype icon |
| Link arrows | One transparent upward arrow, rotated to the selected compass directions |
| Fonts | Name/body WOFF2 files |
| Artwork | PNG, JPEG or WebP mapped from source artwork URL |

Image assets must be PNG, JPEG or WebP; active SVG assets are rejected. Fonts must
be WOFF2. Files must stay inside the assets directory, including symlink targets.
The loader checks file signatures/size, not pixel dimensions or full image/font
integrity: check those visually in the gallery. Limits are 10 MB/file and 256 MB
loaded asset bytes for this experiment. Original source geometry may require
adjusting coordinates for a different pack. The optional `tcg-813-v1` profile
uses the bundled geometry; omit it for the original schematic layout.

A manifest can also define `composites`: each composite has a `width`, `height`
and up to eight `layers`, each specifying a local raster key, `x`, `y`, `width`
and `height`. Font references, nested composites, missing layers and non-finite
coordinates are rejected. See the bundled manifest for complete examples.
Changing layers, placements, profile or file bytes changes the rendered cache key.

## Compatible JSON and missing visual metadata

Existing `dbcd-cube-v1` records remain valid. The renderer reads their existing
`name`, `artwork`, `frame`, `attribute`, `level`, `type`, `effect`, `pendulumEffect`,
`atk`, `def` and `link` fields without changing IDs, copies or sections.

Legacy frame filenames ending in `_front[digits].webp/png/jpg` can identify
normal/effect/ritual/fusion/synchro/xyz/link/spell/trap, including
`effect_pendulum` and `pendulum_effect`. Unknown patterns produce diagnostics;
they are not assumed to be a Normal Monster. Explicit metadata takes priority,
then recognized frame filenames, then type text. "Spellcaster" is not a Spell.

Optional `visual` metadata can remove ambiguity while retaining the v1 schema:

```json
{
  "visual": {
    "version": 1,
    "frame": "xyz",
    "pendulum": true,
    "rank": 7,
    "scaleLeft": 4,
    "scaleRight": 4
  }
}
```

For Spell/Trap cards, `visual.spellTrapIcon` accepts `normal`, `continuous`,
`counter`, `equip`, `field`, `quick-play` or `ritual`. When absent, the renderer
only infers a subtype explicitly present in the type line. A generic
`[ SPELL CARD ]` line cannot distinguish Normal from Quick-Play, for example.

For Link cards, `visual.linkArrows` is an array of unique positions from `top`,
`top-right`, `right`, `bottom-right`, `bottom`, `bottom-left`, `left`, `top-left`.
The existing `link` field supplies the printed rating. Link cards show no DEF or
Level/Rank stars. Pendulum cards retain separate monster and Pendulum effects.

`level` and optional rank/scales accept integer values 0–99. Up to 13 stars fit
in the demonstration row; higher custom counts show a numeric label and a layout
warning. This display limit does not alter draft rules or change card values.

The current extension counts visible `.level` nodes without an explicit rank
field. For Xyz, the renderer can use that legacy value as Rank, but reports that
it needs comparison with the original. Missing scales/arrows/subtype are reported,
not guessed. No extractor changes are included while extension work is set aside.

Text fitting preserves words, explicit paragraph breaks and long identifiers.
The server first tries the taller size, then smaller sizes within the bounds.
Extremely long text that cannot fit at the minimum size still reports overflow;
the complete text is retained in the SVG description and the gallery JSON. No
card data is truncated or changed.

## HTTP and cache

- `POST /api/render`: one card object, at most 128 KB; returns `{url, diagnostics,
  cacheHit}`. No caller-provided asset paths, remote URL fetching or executable
  markup is accepted.
- `GET /renders/<sha256>.svg`: the cached image with embedded local raster/font
  assets, a restrictive content policy and no external image references.
- `data/render-cache/`: generated SVGs, retained across process restarts. The
  default cache budget is 256 MB; a full cache returns a clear error. Stop the
  process before clearing this directory. Asset files and cached renders are
  git-ignored.

Production integration will authenticate image access against room/Cube access
and hide undisclosed packs. This local service has no guest accounts, upload
library or network hosting controls; do not expose it as the multiplayer service.
A production ingestion step can add controlled artwork downloads, persistence,
thumbnail rasterization and a versioned asset pack after this visual contract
has been validated.

## Checks

```sh
node --test platform-design/renderer/*.test.cjs
```

Tests cover card families, rank/level repetition, Pendulum scales, Link arrows,
legacy JSON preservation, text escaping, missing metadata, local asset resolution,
cache invalidation/restart, HTTP limits and Chromium SVG decoding for all examples.
Additional checks verify the requested name colors, border pixels across every
family, artwork visibility, font-file identity, the reference's two-line effect,
and measured fitting of denser effects. The title's rendered glyph bounds are
checked separately from its nominal font size. Repeated PNG layers are embedded
once per SVG and reused by reference.
Browser tests use the existing Playwright dependency and `CHROMIUM_PATH` option.

Still required: card illustration ingestion/mapping, comparison of every card
family with DuelingBook, dense-text and non-Latin fitting on real data, image crops and
custom frame variants. Server-generated SVGs embed the templates/fonts and are
currently about 1–3 MB each; thumbnail delivery and cache eviction need work
before integrating this experiment with real drafts.
