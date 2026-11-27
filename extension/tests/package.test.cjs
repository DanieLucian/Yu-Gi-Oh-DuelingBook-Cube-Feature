const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

test("the Chrome Web Store package has the same runtime files the Windows updater verifies", () => {
  const directory = path.resolve(__dirname, "../../dist/extension");
  const files = fs.readdirSync(directory).sort();
  assert.deepEqual(files, ["content.js", "manifest.json", "popup.css", "popup.html", "popup.js"]);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(files.includes(manifest.action.default_popup));
  assert.ok(manifest.content_scripts.every(script => script.js.every(file => files.includes(file))));
  const updater = fs.readFileSync(path.join(__dirname, "../scripts/update-from-zip.ps1"), "utf8");
  const hashes = Object.fromEntries(Array.from(
    updater.matchAll(/^\s*'([^']+)' = '([a-f0-9]{64})'/gm), ([, file, hash]) => [file, hash],
  ));
  assert.deepEqual(Object.keys(hashes).sort(), files);
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(directory, file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hashes[file], file);
  }
});
