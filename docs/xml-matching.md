# XML ID reconciliation in v0.5.0

## Workflow and supported files

Use **Match card IDs from XML** to select a DuelingBook deck export. The existing
Cube is annotated; matching does not import new cards or change quantities. An
expandable result panel shows every distinct XML ID, its entry count and sections,
whether it matched, and why a candidate was skipped. XML names in the report are
rendered as text, not markup. Results are displayed for the current popup session.

The parser accepts a `<deck>` root with `<card id="123">Name</card>` entries
immediately inside `<main>`, `<extra>` or `<side>`. Card names can also come from a
`name` attribute. Namespaces are accepted when root/section/card share the same
namespace. XML entities and Unicode names are decoded by the browser XML parser.
If attribute and text names disagree after normalization, that ID is a conflict.

Malformed XML, a different root, unsupported card nesting, or a deck with no card
entries rejects the operation before any write. Individual rows with missing,
zero or nonnumeric IDs appear as Invalid and do not prevent independent valid
matches. IDs remain strings, with surrounding whitespace and leading zeros
normalized; no large ID is converted through a floating-point number.

## Matching rules

1. Match the XML ID against existing `duelingbookId` bindings or numeric custom
   card IDs. A known ID takes precedence over a changed XML/rendered name.
2. Without a known ID, compare normalized names. Normalization is Unicode NFC,
   whitespace folding and lowercase; punctuation is retained and no fuzzy matching
   is performed. There must be exactly one matching Cube record, including custom
   records in the ambiguity check, and the candidate must be an official card.
3. Preserve existing bindings. A name cannot replace an existing different ID or
   remap a custom card. Invalid stored IDs, contradictory custom/saved IDs,
   multiple Cube records claiming one ID, several XML IDs for one unbound name,
   or conflicting names for the same XML ID are reported as conflicts.
4. Resolve every candidate against the original collection before applying
   changes. Input order cannot decide which conflicting ID wins. Safe independent
   matches can still apply when other IDs are ambiguous, conflicting or unmatched.

Repeated occurrences of one XML ID produce one result and one possible update.
The entry count describes XML `<card>` elements, not the Cube quantity. If all
occurrences are in one section, matching assigns that section as before. If the
same ID appears in several sections, its ID can still be reconciled, but its
existing Cube section is kept and the report explains why. This avoids assigning
Main or Side based on whichever row happened to be processed last.

## Storage and installation compatibility

Storage remains `chrome.storage.local.dbcd_cards_v1` and JSON exports remain
`dbcd-cube-v1`. Local keys, official hashes and custom IDs are unchanged. Only
`duelingbookId` and, for a single-section match, `section` can be written. Copies,
artwork, names, import dates, notes and unknown metadata are retained.

Matching is queued with other popup edits. The whole plan is applied to a clone
and saved once, with results shown only after storage accepts the write. Failures
leave the saved/displayed collection intact. Matching with no actual changes
avoids a storage write. Malformed files clear any stale previous report.

`xml-matching.js` contains the XML parser and pure matching engine. The popup loads
it before `popup.js`. The Windows ZIP updater now verifies and installs **six**
runtime files, including this module. Download the v0.5 updater with its matching
ZIP; the v0.4 updater intentionally rejects these different checksums.

## Automated verification

`npm test` runs 89 checks: the existing 46, 30 pure matching tests and 13 browser
XML workflow tests. Coverage includes ID priority, global name ambiguity, XML
order independence, repeated/multiple-section entries, malformed/unsupported
files, namespaces and attribute names, no-op matching, failed-write recovery,
queued copy edits, escaped report text and JSON export/restore compatibility.
The popup report is also inspected at the extension's 464 px width.

The XML test data is synthetic. No actual DuelingBook XML export or signed-in
page was supplied for this change. The automatic Windows updater file/hash checks
are verified in Linux; its PowerShell execution remains a local check.

## Manual checks before merging

1. Export a Cube JSON backup. Update the same unpacked extension folder using the
   new ZIP/updater, reload the extension, and confirm **Prototype v0.5.0**.
2. Export a deck XML from DuelingBook with official/custom cards and Main, Extra
   and Side entries. Match it and compare the report with the actual export.
3. Check a custom exact-ID match and an initially unbound, uniquely named official
   card. Quantities, local keys, import dates and annotations unrelated to the
   matched section must stay unchanged.
4. Match the XML again: previously reconciled official IDs should match by ID.
   Rename the XML text while keeping its known ID and confirm it still matches
   without renaming the Cube card.
5. Test same-name artwork variants, a custom/official name collision and an XML
   name with two different IDs. Confirm these are skipped rather than guessed.
6. Put one card in both Main and Side. Confirm one result, preserved Cube copies
   and section, and a multi-section note. Duplicate Main entries must not multiply
   Cube copies.
7. Try malformed XML and a missing card ID. Verify the error/Invalid report and
   that no unrelated data changes. Close/reopen the popup to confirm saved ID/section annotations,
   then verify Cube JSON export/restore and deck-editor import still work.

Live XML structure, real-world card name variants and the Chrome profile update
remain the principal manual checks. XML deck export and multiplayer are outside
this change.
