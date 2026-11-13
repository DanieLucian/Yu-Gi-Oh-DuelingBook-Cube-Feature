# Cube Draft platform: first release design

Status: architecture + interactive interface prototype. This branch does not run
a multiplayer service yet. The prototype opens as `index.html` and uses browser
storage and simulated seats. Production storage and timing belong to your PC.
The Chrome extension is unchanged.

## Confirmed requirements and rules

- Everyone who joins may upload an exported Cube JSON from their computer.
- A shared Cube library survives server/browser restarts on the host PC.
- Each room has 2–6 players, configurable cards per pack, packs per player, and
  maximum seconds per pick. Settings lock when the host starts the draft.
- Packs are randomly drawn from the chosen Cube's copy counts without replacement.
  Each physical copy has its own instance ID. Round 1 passes left, round 2 right,
  and so on. A server-side random pick occurs when the deadline expires.
- MVP uses synchronized pick steps: everyone picks once, then packs pass as soon
  as all seats have picked (manually or by timeout). Fast players wait; other
  players cannot see which card they chose.
- Hover a card to inspect it at the left. Click it to put a Yes/No confirmation
  directly on that card. No, Escape, or a click outside the prompt cancels, with
  no pick and no timer reset. The enlarged selected card stays pinned while the
  prompt is open. A timeout still applies while confirming.
- The current pack occupies the center. The drafted pool/deck is on the right,
  or below on narrower screens. Full-card preview remains on the left on desktop.
- Export the constructed deck as XML. Direct DuelingBook import is a later
  investigation, not a dependency for this release.

## Screens and actions

**Cube library:** import/drop a JSON; show name, uploader, upload time, unique
cards, physical copy count and XML-ready count. All guests can add a new Cube;
only the PC host can delete library entries. Repeated uploads create a new
revision or explicitly reuse an identical card-data hash; they do not silently
replace a Cube used by a running room.

**Room lobby:** choose a Cube, set 2–6 seats, packs/player, cards/pack and pick time,
copy the join link, choose a display name and mark ready. The host starts only
when at least 2 actual players are present, the configured seats are filled and
ready, and there are enough physical copies. Display the capacity check:

`required copies = players × packs per player × cards per pack`

Proposed initial settings: 4 seats, 3 packs/player, 15 cards/pack, 30 seconds/pick.
These are editable defaults, not fixed drafting rules. A small imported Cube may
need fewer rounds or smaller packs; never create extra copies to fill a table.

**Draft table:** enlarged card on the left, pack grid in the center, own drafted
pool on the right, seats/readiness below. Confirmation overlays the chosen card,
not the page. During submission it locks to avoid duplicate requests. After a
committed pick, hide that pack and show Waiting for other players until the next
pack is available. At timeout the server commits an available card and closes any
obsolete confirmation, showing which card was auto-picked.

**Deck construction:** assign owned instances to Main, Extra, Side or Reserve.
Reserve is not exported. Moving a card does not create a copy. Show counts and
missing DuelingBook IDs. Yu-Gi-Oh! legality enforcement (e.g. Main Deck minimum,
Side/Extra limits and banlists) is not fixed by this design; agree on those rules
before making them export blockers. The invariant is ownership: a player cannot
export more copies than they drafted.

## Import contract and card previews

Accept the existing extension object:

```json
{
  "schema": "dbcd-cube-v1",
  "exportedAt": "2026-11-11T00:00:00Z",
  "cards": [{
    "id": "5975147",
    "name": "Example custom card",
    "origin": "custom",
    "duelingbookId": "5975147",
    "artwork": "https://www.duelingbook.com/custom-pics/0/5975147.jpg",
    "copies": 1,
    "section": "unknown"
  }]
}
```

The example documents structure; it is not a verified real card. Preserve local
IDs and unknown fields. Validate the schema, unique IDs, string names and integer
copies (1–99, matching the exporter), plus types for fields used by the renderer.
A provisional upload limit is 10 MB / 10,000 unique records; this is an operational
limit, not a draft rule, and can be configured. Store files under generated UUIDs,
never a supplied filename. Parse/validate before adding a library record.

### Server-rendered cards and local visual assets

The PC server owns card rendering. It combines the JSON with a local visual asset
pack: border, normal/effect/ritual/Extra Deck/Spell/Trap backgrounds, Pendulum
variants, Spell/Trap subtype icons, monster attributes, separate Level and Rank
icons, Link arrows, fonts and artwork. Each Pendulum background combines its
underlying monster frame with a Pendulum layout.

The renderer produces a self-contained image, cached by visual content, asset
content and renderer version. The pack and left spotlight use the same rendered
image at different sizes, so their appearance stays consistent. The server does
not compose an image again for every hover or for each physical copy of a card.
A first proof of concept composes SVG on the server; raster thumbnails can follow
when pack performance is measured.

See [renderer/README.md](renderer/README.md) for a working local rendering gallery,
asset manifest and optional `visual` metadata contract. This gallery is separate
from the single-file drafting simulation; its HTTP process is not the multiplayer
server. A bundled, credited YGO Carder pack now supplies frames, icons and fonts
from a pinned GitHub revision. Original files and checksums are preserved;
illustrations remain separate. Fandom requests still return HTTP 402 after the
domain grants became active, so this pack is not described as wiki-sourced.
Missing assets/details have explicit diagnostics.

Existing exports retain the `dbcd-cube-v1` schema and current fields. They do not
reliably describe Pendulum scales, Link arrows, Spell/Trap subtype icons or an
explicit Xyz Rank. Add optional visual metadata without changing IDs/copies or
requiring old collections to migrate. Existing records can render with known
fields and missing-detail diagnostics. Do not infer Normal Spell from a generic
`[ SPELL CARD ]` label or invent Link arrows from its rating.

Artwork is also stored locally, with an explicit map from the original URL to a
server asset file. The experiment performs no URL fetching; a later ingestion
step must restrict artwork downloads to supported sources and validated images.
Uploaded JSON cannot select arbitrary server paths or trigger arbitrary network
requests. Retain original records and render names/effects as escaped text. Exact
DuelingBook layout, font metrics, long effects and all card families need visual
comparison with representative real cards.

## PC server architecture

A practical first stack is a single Node.js 24 LTS application with a React +
TypeScript frontend, Socket.IO for real-time events, and SQLite for persistent
state. It serves the built frontend and HTTP/WebSocket endpoints on one port.
There is no required paid hosting service, cloud database or external game server.

```text
Guest browsers ── HTTP + WebSocket ── Your Windows PC
                                      ├─ web UI + API
                                      ├─ authoritative draft engine / timer
                                      └─ data/
                                         ├─ platform.sqlite
                                         ├─ cubes/<generated UUID>.json
                                         ├─ assets/ (frames, icons, fonts, artwork)
                                         └─ render-cache/ (derived card images)
```

Back up the whole data directory. Anonymous guest sessions have reconnect tokens
in an HTTP-only session cookie; display names are not proof of identity. A local
host/admin token controls destructive actions and room settings. Invite links
admit guests, who can upload and join; uploads do not grant host privileges.

Other computers on the same LAN connect using the PC's LAN address. Friends on
the internet need a separately configured HTTPS tunnel/VPN or router setup; a
localhost address cannot be shared directly. Opening a laptop browser does not
host the application. The PC must remain on and the server process running.
Windows firewall and internet reachability will be validated during deployment.

## Data model

| Entity | Main fields |
| --- | --- |
| Cube | UUID, name, uploader/session, timestamp, content hash, schema, JSON path |
| Draft | ID, join code, host session, immutable Cube snapshot, settings, phase, state version |
| Seat | Draft ID, seat number, guest session, display name, readiness, reconnect state |
| Physical card | Unique instance ID + reference to a Cube card ID |
| Pack | Draft/round/pack ID, current owner, ordered remaining instance IDs |
| Pick | Draft/round/pick step/seat, instance ID, manual/timeout reason, timestamp |
| Deck | Draft/seat, instance assignments to Main/Extra/Side/Reserve |

SQLite transactions record a pick and its pool/pack changes together. A uniqueness
constraint on draft + round + pick step + seat prevents a double pick. Persist
room progress after each accepted pick; after a server restart, restore incomplete
rooms paused and let the host resume, instead of expiring timers while offline.
Each draft uses its own Cube snapshot so later uploads/edits cannot alter packs.

## Authority, timing and synchronization

- Shuffle and deal on the server with a suitable random source. A client receives
  only its current pack, own pool/deck and public seat/readiness information.
- Send server time and an absolute deadline. Browser clocks draw the countdown;
  the server alone determines whether a pick is on time.
- A pick command contains the pack ID, instance ID and request ID. Authenticate
  the seat from its session, not a client-supplied player number. Check phase,
  ownership, membership, deadline and whether a pick already exists.
- Manual pick and timeout share one commit path, serialized per room. Exactly
  one can win. A retry returns the committed result without granting another card.
- On timeout, choose randomly from that seat's remaining pack and record the
  reason. Disconnected players also time out; the room does not stall indefinitely.
- On reconnect, send the latest server snapshot/version and the guest's private
  pack/pool. Ignore stale requests for older packs. Finished/aborted rooms reject
  picks. A host pause freezes deadlines for all seats, not one player's timer.

Proposed commands/events: `room:join`, `room:ready`, `room:start`, `room:pause`,
`room:resume`, `draft:pick`, `room:state`, `draft:privateState`, `pick:committed`
and `room:error`. Never broadcast private pack contents or selected card IDs to
other seats. HTTP endpoints cover Cube list/upload/read, room creation/join,
deck assignments and XML export.

## XML and DuelingBook handoff

Resolve XML IDs from `duelingbookId`; custom cards may use their numeric custom
ID. An `official:...` local hash is not a DuelingBook XML ID or passcode. Reject
export when an included card has no confirmed numeric ID, with a list of cards
to reconcile. Allow drafting an unresolved Cube after a visible preflight notice.
Reserve-only unresolved cards do not block a deck export.

Create `<deck><main>…</main><extra>…</extra><side>…</side></deck>`, with one
`<card id="...">Name</card>` per included physical copy and proper XML escaping.
This follows the existing extension's XML matching structure, but needs a real
DuelingBook import/export round trip before being called compatible.

The first release downloads a file which the user loads through DuelingBook's
**Import Deck** control (visible in the user's existing constructor). No supported
public direct-import API has been verified in this work. Do not depend on private
DuelingBook account endpoints or collect login credentials. An optional future
extension-assisted handoff is a separate investigation, with explicit permission
and UI review; the file approach needs no new extension permissions.

The platform stores uploads/drafts on its host PC, which differs from the
extension's browser-local privacy model. Explain this to participants and provide
a platform-specific privacy policy before a public launch.

## Implementation order and acceptance checks

1. **Design review:** approve the screen and interaction prototype in this branch.
2. **Render assets and server/library:** validate the local rendering gallery
   with real frames/icons/fonts/artwork, then Windows start/stop and JSON upload/list,
   SQLite persistence and restart test. Two browsers must see the same upload.
3. **Lobby and engine:** 2–6 independent browser sessions, capacity/readiness
   checks, immutable snapshots, copy conservation and left/right round passing.
4. **Live draft UI:** authoritative deadlines, timeout/manual race tests,
   reconnects, confirmation No/outside/Escape, and pack visibility isolation.
5. **Deck/export:** ownership-safe assignments, unresolved IDs, repeated copies,
   XML escaping and real DuelingBook import round trips.
6. **PC hosting:** LAN access from another device, then invited internet access,
   data backup/restore and server restart/rejoin behavior.

The prototype currently covers local JSON import/library persistence, screen
layout, hover preview, on-card confirmation, configurable simulated tables,
copy-respecting pack passing, timeout picks, deck sections and XML serialization.
It does not implement shared PC persistence, real rooms, network multiplayer,
authentication, reconnects or direct DuelingBook import. Its random generator and
client timer are demonstration behavior, not the production authority model.

The separate renderer gallery implements a local HTTP process, asset manifest,
SVG composition, missing-detail diagnostics and disk cache. It does not yet feed
rendered images into the draft simulation. The bundled source files and layer
geometry are checked, while accurate font-metric text fitting and DuelingBook
comparisons remain required for faithful reproduction.
