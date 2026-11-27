const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  checkedUrl,
  query,
  discover,
  install,
  rasterizeSvg,
  rasterMime,
} = require("./wiki-assets.cjs");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=",
  "base64",
);
const url = "https://static.wikia.nocookie.net/yugioh/images/0/00/DARK.svg";
const page = (title = "File:DARK.svg", mime = "image/png") => ({
  title,
  imageinfo: [
    {
      url,
      mime,
      width: 1,
      height: 1,
      sha1: "fixture-sha1",
      descriptionurl: "https://yugioh.fandom.com/wiki/" + title,
      extmetadata: {
        Artist: { value: "Fixture artist" },
        LicenseShortName: { value: "Fixture license" },
        Credit: { value: "Fixture credit" },
      },
    },
  ],
});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cube-wiki-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const apiResponse = (pages) =>
  Buffer.from(JSON.stringify({ query: { pages } }));
const pause = async () => {};

test("wiki URLs stay within the selected source and its image CDN", () => {
  assert.equal(checkedUrl(url, "fandom").hostname, "static.wikia.nocookie.net");
  for (const value of [
    "http://yugioh.fandom.com/api.php",
    "https://yugioh.fandom.com:8443/a",
    "https://user:password@yugioh.fandom.com/a",
    "https://127.0.0.1/a",
    "https://static.wikia.nocookie.net.evil.example/a",
  ])
    assert.throws(() => checkedUrl(value, "fandom"));
  assert.throws(() => checkedUrl("https://yugipedia.com/api.php", "fandom"));
  assert.throws(() => checkedUrl(url, "constructor"));
});

test("discovery records verified API metadata, deduplicates candidates and does not install guessed files", async () => {
  let calls = 0;
  const result = await discover({
    request: async (requestUrl) => {
      calls++;
      const request = new URL(requestUrl);
      assert.equal(request.hostname, "yugioh.fandom.com");
      return apiResponse(
        request.searchParams.has("titles")
          ? [page(), { title: "File:No.png", missing: true }]
          : [page("File:Template fixture.png")],
      );
    },
    pause,
  });
  assert.ok(calls > 10);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates[0].proposedKeys, ["attribute.DARK"]);
  assert.equal(result.candidates[0].attribution.artist, "Fixture artist");
  assert.equal(
    result.candidates[1].proposedKeys.includes("background.effect"),
    true,
  );
  assert.match(result.note, /candidates, not verified renderer layers/);
  await assert.rejects(
    query("fandom", {}, async () => Buffer.from("<html>Challenge</html>")),
    /did not return JSON/,
  );
});

test("installer preserves existing mappings, records attribution and is repeatable", async (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "existing.png"), png);
  fs.writeFileSync(
    path.join(root, "manifest.json"),
    JSON.stringify({
      version: 1,
      files: { border: "existing.png" },
      artworks: { "https://example.test/art.png": "existing.png" },
    }),
  );
  const request = async (requestUrl) =>
    new URL(requestUrl).pathname === "/api.php" ? apiResponse([page()]) : png;
  const selection = {
    source: "fandom",
    files: { "attribute.DARK": "File:DARK.svg" },
  };
  await install({ selection, assetRoot: root, request, pause });
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json")),
  );
  assert.equal(manifest.files.border, "existing.png");
  assert.equal(
    manifest.artworks["https://example.test/art.png"],
    "existing.png",
  );
  assert.match(manifest.files["attribute.DARK"], /^wiki-[a-f0-9]{64}\.png$/);
  assert.deepEqual(
    fs.readFileSync(path.join(root, manifest.files["attribute.DARK"])),
    png,
  );
  const attribution = JSON.parse(
    fs.readFileSync(path.join(root, "wiki-attribution.json")),
  ).files["attribute.DARK"];
  assert.equal(attribution.originalUrl, url);
  assert.equal(attribution.attribution.license, "Fixture license");
  assert.equal(attribution.installedSha256, attribution.originalSha256);
  await install({ selection, assetRoot: root, request, pause });
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, "manifest.json"))),
    manifest,
  );
});

test("failed downloads, HTML and unsupported selection keys leave the active manifest intact", async (t) => {
  const root = fixture(t),
    active = JSON.stringify({ version: 1, files: {}, artworks: {} });
  fs.writeFileSync(path.join(root, "manifest.json"), active);
  const selection = {
    source: "fandom",
    files: { "attribute.DARK": "File:DARK.svg" },
  };
  await assert.rejects(
    install({
      selection,
      assetRoot: root,
      request: async (requestUrl) =>
        new URL(requestUrl).pathname === "/api.php"
          ? apiResponse([page()])
          : Buffer.from("<html>Access denied</html>"),
      pause,
    }),
    /not a supported raster/,
  );
  assert.equal(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
    active,
  );
  for (const files of [
    { "../../private": "File:Any.png" },
    { "font.name": "File:font.woff2" },
    { border: "File:A|File:B" },
  ])
    await assert.rejects(
      install({
        selection: { source: "fandom", files },
        assetRoot: root,
        pause,
      }),
    );
  await assert.rejects(
    install({
      selection,
      assetRoot: root,
      pause,
      request: async () => apiResponse([page("File:Different.png")]),
    }),
    /not found/,
  );
  assert.equal(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
    active,
  );
});

test("SVG conversion creates a local PNG and accepts self-contained gradients", async () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><rect width="24" height="24" fill="url(#g)"/></svg>',
  );
  const converted = await rasterizeSvg(svg);
  assert.equal(rasterMime(converted), "png");
});

test("SVG conversion rejects active content, external references, entities and oversized images", async () => {
  const snippets = [
    "<script>alert(1)</script>",
    "<foreignObject/>",
    '<use href="https://example.test/a.svg#x"/>',
    '<rect width="4" height="4" fill="url(https://example.test/a)"/>',
  ];
  for (const snippet of snippets)
    await assert.rejects(
      rasterizeSvg(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${snippet}</svg>`,
        ),
      ),
    );
  await assert.rejects(
    rasterizeSvg(Buffer.from("<!DOCTYPE svg><svg/>")),
    /document type/,
  );
  await assert.rejects(
    rasterizeSvg(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="5000"/>',
      ),
    ),
    /dimensions/,
  );
});
