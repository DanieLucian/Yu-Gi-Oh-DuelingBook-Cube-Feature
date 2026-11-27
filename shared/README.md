# Cube and card interchange format

`cube-format.cjs` defines the `dbcd-cube-v1` envelope and the predicates both
applications use to read it. An example export:

~~~json
{
  "schema": "dbcd-cube-v1",
  "exportedAt": "2026-11-27T10:00:00.000Z",
  "cards": [
    { "id": "42", "name": "Example card", "copies": 2, "section": "main" }
  ]
}
~~~

Card records carry their existing IDs, names, copy counts, and optional source
and rendering metadata. The predicates check the envelope, nonblank card
names, and integer copy counts. Callers keep their own existing policies.
For example, the extension accepts empty backups and caps copies at 99 per
record, while the drafter import requires at least one card and allows up to
1,000 copies per record. See the [renderer contract](../drafter/renderer/README.md)
for optional `visual` fields.
