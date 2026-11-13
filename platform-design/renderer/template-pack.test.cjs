const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { loadAssets, renderCard } = require("./render.cjs");
const root = path.join(__dirname, "packs/ygocarder");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json")));
const card = {
  name: "Example Monster",
  type: "Warrior / Effect",
  attribute: "DARK",
  level: 4,
  atk: "1800",
  def: "1200",
  effect: "Example effect.",
};

test("every bundled source file matches its pinned upstream checksums and dimensions", () => {
  const source = JSON.parse(
    fs.readFileSync(path.join(root, "provenance.json")),
  );
  assert.equal(source.commit, "975387bc89a917e4422add3ece85f48170182ce6");
  assert.equal(source.files.length, 67);
  assert.equal(source.filesUnmodified, true);
  const dimensions = new Map(
    source.files.map((file) => [file.file, file.dimensions]),
  );
  for (const spec of Object.values(manifest.composites))
    for (const layer of spec.layers)
      assert.deepEqual(
        [layer.width, layer.height],
        dimensions.get(manifest.files[layer.key]),
        "Template layers retain their native geometry",
      );
  for (const file of source.files) {
    assert.equal(path.basename(file.file), file.file);
    const bytes = fs.readFileSync(path.join(root, file.file));
    assert.equal(bytes.length, file.bytes);
    assert.equal(
      crypto.createHash("sha256").update(bytes).digest("hex"),
      file.sha256,
    );
    assert.equal(
      crypto
        .createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex"),
      file.gitBlobSha1,
    );
    if (file.dimensions)
      assert.deepEqual(
        [bytes.readUInt32BE(16), bytes.readUInt32BE(20)],
        file.dimensions,
      );
  }
});

test("all common frame families render without missing template assets, including Pendulum and Link", () => {
  const registry = loadAssets(root, manifest);
  const variants = [
    ...["Normal", "Effect", "Ritual", "Fusion", "Synchro", "Xyz"].flatMap(
      (frame) =>
        [false, true].map((pendulum) => ({
          ...card,
          type: `Dragon / ${frame}${pendulum ? " / Pendulum" : ""}`,
          visual: { rank: 4, scaleLeft: 2, scaleRight: 8 },
          pendulumEffect: pendulum ? "Pendulum effect." : "",
        })),
    ),
    {
      ...card,
      type: "Cyberse / Link / Effect",
      link: "LINK-3",
      visual: { linkArrows: ["top", "bottom-left", "bottom-right"] },
    },
    { ...card, type: "Quick-Play Spell" },
    { ...card, type: "Counter Trap" },
  ];
  for (const value of variants) {
    const result = renderCard(value, registry);
    assert.deepEqual(
      result.diagnostics,
      ["missing-artwork: local source URL mapping required"],
      value.type,
    );
    assert.match(result.svg, /data:image\/png;base64,/);
    assert.match(result.svg, /data:font\/woff2;base64,/);
    assert.doesNotMatch(result.svg, /<image[^>]*href="https?:/);
  }
  const first = renderCard(card, registry).hash;
  const moved = structuredClone(manifest);
  moved.composites["background.effect"].layers[1].x = 1;
  assert.notEqual(
    renderCard(card, loadAssets(root, moved)).hash,
    first,
    "Changed layer placement invalidates cache",
  );
});

test("composites reject recursion, missing images, font images and invalid geometry", () => {
  for (const change of [
    (spec) => (spec.layers[0].key = "background.effect"),
    (spec) => (spec.layers[0].key = "missing"),
    (spec) => (spec.layers[0].key = "font.name"),
    (spec) => (spec.layers[0].x = '0" onload="alert(1)'),
    (spec) => (spec.width = Infinity),
    (spec) => (spec.layers = []),
  ]) {
    const invalid = structuredClone(manifest);
    change(invalid.composites["background.effect"]);
    assert.throws(() => loadAssets(root, invalid));
  }
});

test("server defaults to bundled templates and preserves an explicitly selected custom manifest", async (t) => {
  const { createRenderServer, defaultAssetRoot } = require("./server.cjs");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cube-bundled-test-"));
  t.after(() => fs.rmSync(dataRoot, { force: true, recursive: true }));
  assert.equal(
    defaultAssetRoot(dataRoot),
    path.join(dataRoot, "packs/ygocarder"),
  );
  const server = createRenderServer({ assetRoot: root, dataRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(url + "/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).diagnostics, [
    "missing-artwork: local source URL mapping required",
  ]);
  const customRoot = path.join(dataRoot, "assets");
  fs.mkdirSync(customRoot);
  fs.writeFileSync(
    path.join(customRoot, "manifest.json"),
    JSON.stringify({ version: 1, files: {}, artworks: {} }),
  );
  assert.equal(defaultAssetRoot(dataRoot), customRoot);
  const custom = createRenderServer({
    assetRoot: customRoot,
    dataRoot: path.join(dataRoot, "custom-cache"),
  });
  await new Promise((resolve) => custom.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => custom.close(resolve)));
  const result = await (
    await fetch("http://127.0.0.1:" + custom.address().port + "/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    })
  ).json();
  assert.ok(result.diagnostics.includes("missing-asset:font.name"));
});

test(
  "Chromium decodes the bundled templates for every gallery family without remote asset requests",
  { timeout: 60000 },
  async (t) => {
    const { chromium } = require("playwright");
    const { createRenderServer } = require("./server.cjs");
    const dataRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "cube-template-browser-"),
    );
    const server = createRenderServer({ assetRoot: root, dataRoot });
    let browser;
    t.after(async () => {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataRoot, { recursive: true, force: true });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = [],
      external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().startsWith(url)) external.push(request.url());
    });
    await page.goto(url);
    // Let the initial render finish before watching responses for a new selection.
    await page.waitForFunction(() => {
      const image = document.querySelector("#card");
      return !image.hidden && image.complete && image.naturalWidth === 813;
    });
    const count = await page.locator("#sample option").count();
    for (let i = 0; i < count; i++) {
      const response = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/render") && response.status() === 200,
      );
      await page.locator("#sample").selectOption(String(i));
      const result = await (await response).json();
      assert.deepEqual(result.diagnostics, [
        "missing-artwork: local source URL mapping required",
      ]);
      await page.waitForFunction((src) => {
        const image = document.querySelector("#card");
        return (
          image.getAttribute("src") === src &&
          image.complete &&
          image.naturalWidth === 813
        );
      }, result.url);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  },
);
