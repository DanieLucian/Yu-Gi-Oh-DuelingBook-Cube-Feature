# Chrome Web Store permission audit

This audit covers `main` (v0.4.1). Pending XML reconciliation PR #2 uses the same
Chrome API surface; its parser/report module introduces no additional Chrome
APIs. This permission-only PR is independently based on `main`, not on PR #2.

## Decision

Remove `activeTab`. Keep only:

```json
"permissions": ["storage"],
"host_permissions": ["https://www.duelingbook.com/*"]
```

Keep declarative `content_scripts.matches` at that same exact HTTPS host. No
`tabs`, `scripting`, `downloads`, `cookies`, `unlimitedStorage`, optional permissions,
all-sites permission, HTTP scheme, wildcard subdomain or other host is needed.

## Complete runtime Chrome API inventory

| API | Implementation and purpose | Permission dependency |
| --- | --- | --- |
| `chrome.storage.local.get` | `popup.js`: load `dbcd_cards_v1` | `storage` |
| `chrome.storage.local.set` | `popup.js`: save edits/imports/ID and section annotations | `storage` |
| `chrome.tabs.query({active:true,currentWindow:true})` | `popup.js`: obtain the active tab ID and inspect its URL | Querying basic tabs needs no `tabs` permission; the matching host grant makes the DuelingBook URL available |
| `chrome.tabs.sendMessage` | `popup.js`: send `DBCD_CONTEXT`, `DBCD_SCAN` and `DBCD_PREVIEW` to the already-injected content script | No `activeTab` or `tabs` permission for messaging; a receiving content script must exist |
| `chrome.runtime.onMessage.addListener` | `content.js`: handle those internal messages | No extra named permission |

The `chrome.tabs` namespace is not itself gated by the `tabs` permission. Host
access already authorizes the sensitive matching tab URL used by the popup.
`activeTab` would supply temporary host access on a user invocation, duplicating
that access for DuelingBook and unnecessarily granting temporary access to an
unrelated active website when the action is invoked there. Without it, an unrelated
tab URL can be absent; the popup already handles that and disables site scanning
while continuing to provide local Cube and XML tools.

The content script is injected declaratively. There is no `chrome.scripting`
call or programmatic injection fallback that relies on `activeTab`. Full-card
preview clones and styles the rendered card DOM; it is not a screenshot or tab
capture. JSON export uses a Blob URL and a normal download link, not
`chrome.downloads`. JSON/XML files are selected through standard file inputs and
processed locally; neither filesystem access nor additional host access is needed.
Windows updater scripts and automated test-only Chrome/CDP calls are not extension
runtime API usage.

## Host and content-script scope

- The host grant is limited to `https://www.duelingbook.com/*`. It excludes HTTP,
  the apex hostname without `www`, arbitrary subdomains and unrelated sites.
  The popup accepts the same exact origin. No extra host is added for artwork.
- Host-permission paths are ignored by Chromium: writing `/deck*` there would not
  reduce the host grant. The path wildcard expresses that accurately.
- Declarative content-script paths do matter. Keeping only `/deck*` and `/card*`
  would break the verified constructor in the main app at `/` and app routes such
  as `/index.php`, including query/hash navigation. The current implementation
  supports constructor containers on any document route on this one origin;
  retain that supported scope. This is a deliberate site-wide path match, not a
  claim that all DuelingBook documents contain cards. A more restrictive route
  allowlist would require a tested route contract first.
- Default top-frame injection is retained. There is no `all_frames`,
  `match_about_blank`, `match_origin_as_fallback` or programmatic injection into
  other documents. The script registers a listener automatically on matching
  pages. Editor detection runs when the popup opens; card extraction and preview
  run when requested through the popup. Editor scans restrict cards to the
  deck/side containers (ID or class), excluding outside search/hover cards.

Removing the explicit host grant as well is not equivalent to this change: the
popup depends on reading the matching active tab's URL. Preserve that grant,
instead of adding broader `tabs` access or reintroducing temporary `activeTab`.

## Paste-ready Web Store justifications

**Single purpose**

> Import and manage Yu-Gi-Oh! cards from DuelingBook as a locally stored Cube
> collection, preview currently rendered full cards, back up the collection as
> JSON, and match existing cards to IDs and sections from a user-selected deck XML.

**`storage`**

> The extension uses chrome.storage.local to save the user's Cube collection so
> it persists across popup openings and browser restarts. This includes imported
> card metadata, artwork/source URLs, copy counts, deck sections and matched
> DuelingBook IDs. It supports local collection editing, JSON backup import/export
> and XML ID/section annotations. It does not use Chrome sync storage.

**Host access: `https://www.duelingbook.com/*`**

> Access is limited to the HTTPS www.duelingbook.com site. The popup reads the
> active matching tab's URL and communicates with the extension's bundled content
> script. When the user requests an import, the script reads rendered card data
> from a DuelingBook deck/card page or the constructor's deck and side containers.
> When the user requests a full-card preview, it displays a styled clone of the
> selected card on that page. Site-wide paths support the main app/constructor
> and its routes as well as published deck/card pages. No unrelated website or
> wildcard-subdomain access is requested.

**`activeTab`**

> Not requested. Existing DuelingBook host access and declarative content scripts
> cover the implemented workflow.

Do not claim that the extension implements online drafting, multiplayer or XML
deck export; those are not current features. Do not claim zero network activity:
card artwork and cloned page assets can cause normal image/asset requests to their
original URLs. There are no runtime fetch/XHR/WebSocket/analytics or collection
upload calls in the audited code, but imported source URLs and card text are saved
locally and included in user-requested JSON exports. Align privacy-form answers
with those actual data fields and asset requests.

## Validation and remaining publication check

`npm test`: 49 passed, 0 failed, 1 skipped. The existing 46 checks cover importing,
previews, persistence, quantities, JSON restore and XML annotations. Three new
checks lock down the minimal manifest/API inventory and exercise local storage
and XML with a withheld unrelated-tab URL.

A fourth new check loads the actual extension without an action invocation (so no
activeTab grant), checks granted permissions/host URL access, then imports cards,
persists XML annotations, displays a preview and checks unrelated URL redaction.
It is executable on Chromium with unpacked loading enabled. In this managed
runner it is explicitly skipped because Chromium returns **"Loading of unpacked
extensions is disabled by the administrator."** No policy bypass was attempted.
The regular browser tests use mocked Chrome APIs and cannot prove Chrome's
permission enforcement by themselves.

Before uploading to the Web Store, run this installed-extension check on an
unmanaged Chromium or manually load the branch in your Chrome profile. Verify
constructor import at `/` and an app route, published deck/card imports, full-card
preview, popup reopen/restart persistence, XML annotations, and local tools with
an unrelated active tab. Review Chrome's permission/site-access UI and confirm
only the DuelingBook host and local storage are requested. Revoking DuelingBook
site access should disable page integration, not erase saved Cube data.

The Windows ZIP updater's manifest checksum is refreshed for this manifest. Use
the matching branch ZIP/updater; an old updater intentionally rejects changed
manifest bytes. Pending PR #2 must also refresh its own manifest checksum when
this independent permission change is merged into it. No Web Store submission or
environment publication is performed by this PR.

## Chrome references

- [Tabs API permissions](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions)
- [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
- [Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chromium host-permission parser](https://github.com/chromium/chromium/blob/main/extensions/common/manifest_handlers/permissions_parser.cc)
