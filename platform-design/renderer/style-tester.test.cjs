"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");
const { normalizeStyle, DEFAULT_STYLE } = require("./style-profile.cjs");
const { loadAssets, renderCard } = require("./render.cjs");
const { createRenderServer } = require("../server.cjs");
const { testerState, testerHtml } = require("./tester-build.cjs");
const projectStyle = normalizeStyle(require("./style.default.json"));
const root = path.join(__dirname, "packs");
const registry = loadAssets(
  root,
  JSON.parse(fs.readFileSync(path.join(root, "manifest.json"))),
);
const card = {
  name: "A Normal Test Monster",
  type: "Dragon / Normal",
  attribute: "DARK",
  level: 4,
  atk: "1800",
  def: "1200",
  effect: "A dragon that guards the mountain and watches the passing seasons.",
  visual: { frame: "normal" },
};
const fontFile = path.join(root, "ygocarder/stone-serif-regular-webfont.woff2");
let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
});
after(async () => browser?.close());
async function fixture(t) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cube-style-tester-"));
  const server = createRenderServer({ dataRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const pages = [];
  t.after(async () => {
    await Promise.all(pages.map((page) => page.close()));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  return {
    server,
    dataRoot,
    url: "http://127.0.0.1:" + server.address().port,
    page: async (options) => {
      const page = await browser.newPage(options);
      pages.push(page);
      return page;
    },
  };
}
function save(f, style, origin = f.url) {
  return fetch(f.url + "/api/style", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(style),
  });
}
async function rendered(url) {
  const response = await fetch(url + "/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  return { ...result, svg: await (await fetch(url + result.url)).text() };
}
async function preview(page) {
  await page.waitForFunction(() => {
    const img = document.querySelector("#card");
    return img.complete && img.naturalWidth === 813;
  });
  return page.evaluate(() =>
    fetch(document.querySelector("#card").src).then((response) =>
      response.text(),
    ),
  );
}

test("style profiles round-trip with fonts and reject executable input, invalid files and unreasonable geometry", () => {
  const value = normalizeStyle({
    version: 1,
    regions: { name: { size: 76 }, effect: { letterSpacing: 0.4 } },
    fonts: {
      "upload-test": {
        name: "Card font.woff2",
        data: fs.readFileSync(fontFile).toString("base64"),
        metrics: { widths: { A: 0.7 }, ascent: 0.9, descent: 0.2 },
      },
    },
  });
  assert.deepEqual(normalizeStyle(value), value);
  assert.equal(value.regions.name.size, 76);
  assert.equal(DEFAULT_STYLE.regions.name.size, 80);
  for (const change of [
    (p) => (p.regions.name.font = 'serif" onload="alert(1)'),
    (p) => (p.regions.effect.size = Infinity),
    (p) => (p.regions.effect.lineHeight = 0),
    (p) => (p.regions.effect.minSize = 50),
    (p) => (p.stars.gap = -1),
    (p) => (p.stats.atkX = 999),
    (p) =>
      (p.fonts["upload-test"].data = Buffer.from(
        "<svg onload='alert(1)'>",
      ).toString("base64")),
    (p) => (p.fonts["upload-test"].metrics.widths = { AB: 0.7 }),
    (p) => (p.fonts["upload-test"].metrics.widths.A = -1),
    (p) => (p.regions.name.src = "https://example.test/font.woff2"),
  ]) {
    const invalid = structuredClone(value);
    change(invalid);
    assert.throws(() => normalizeStyle(invalid));
  }
});

test("Normal Monster flavor text always uses italic while Pendulum effects, Effect Monsters and Spell/Trap text retain their styles", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const legacyRoot = path.join(root, "ygocarder");
  const legacy = loadAssets(
    legacyRoot,
    JSON.parse(fs.readFileSync(path.join(legacyRoot, "manifest.json"))),
  );
  for (const assets of [
    registry,
    legacy,
    { assets: new Map(), artworks: new Map() },
  ])
    for (const frame of ["normal", "effect", "spell", "trap"]) {
      const pendulum = ["normal", "effect"].includes(frame);
      const value = {
        ...card,
        type:
          frame === "spell"
            ? "Normal Spell"
            : frame === "trap"
              ? "Normal Trap"
              : card.type,
        pendulumEffect: pendulum ? "A separate Pendulum effect." : "",
        visual: {
          frame,
          pendulum,
          scaleLeft: 2,
          scaleRight: 8,
          spellTrapIcon: "normal",
        },
      };
      const source = structuredClone(value);
      await page.setContent(
        renderCard(value, assets, {
          version: 1,
          regions: { effect: { italic: false }, pendulum: { italic: false } },
        }).svg,
      );
      const styles = await page.evaluate(() =>
        Object.fromEntries(
          [
            ...document.querySelectorAll(
              '[data-text-block="effect"], [data-text-block="pendulum"]',
            ),
          ].map((node) => [
            node.dataset.textBlock,
            {
              italic: getComputedStyle(node).fontStyle,
              fill: getComputedStyle(node.querySelector("text") || node).fill,
            },
          ]),
        ),
      );
      assert.equal(
        styles.effect.italic,
        frame === "normal" ? "italic" : "normal",
      );
      assert.equal(styles.effect.fill, "rgb(0, 0, 0)");
      if (pendulum) assert.equal(styles.pendulum.italic, "normal");
      assert.deepEqual(value, source, "Rendering must not mutate Cube records");
    }
});

test("server style saves are validated, preserve the last good profile and persist fonts/layout through restart", async (t) => {
  const f = await fixture(t),
    first = await rendered(f.url);
  assert.deepEqual(
    (await (await fetch(f.url + "/api/style")).json()).style,
    projectStyle,
  );
  assert.equal(
    first.svg,
    renderCard(card, registry, projectStyle).svg,
    "A fresh server must render with the selected project style",
  );
  const style = normalizeStyle({
    version: 1,
    regions: { name: { size: 72 }, stats: { font: "upload-stats" } },
    stars: { gap: 12 },
    stats: { atkX: 606, defX: 754 },
    fonts: {
      "upload-stats": {
        name: "Stats.woff2",
        data: fs.readFileSync(fontFile).toString("base64"),
      },
    },
  });
  assert.equal(
    (await save(f, style, "https://other-site.example")).status,
    403,
  );
  assert.equal((await save(f, style, null)).status, 403);
  assert.equal((await save(f, style)).status, 200);
  const second = await rendered(f.url);
  assert.notEqual(second.url, first.url);
  assert.match(second.svg, /font-size="72"[^>]*data-text-block="name"/);
  assert.match(second.svg, /<text x="606"[^>]*data-text-block="atk"/);
  assert.ok(second.svg.includes(style.fonts["upload-stats"].data));
  assert.equal((await save(f, { version: 1, stars: { gap: -4 } })).status, 400);
  assert.deepEqual(
    (await (await fetch(f.url + "/api/style")).json()).style,
    style,
  );
  const editor = await (await fetch(f.url + "/api/tester-state")).json();
  assert.deepEqual(editor.style, style, "Saved local styles take precedence");
  assert.deepEqual(
    editor.defaults,
    projectStyle,
    "Reset retains the project style separately",
  );
  const restart = createRenderServer({ dataRoot: f.dataRoot });
  await new Promise((resolve) => restart.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    restart.closeAllConnections();
    return new Promise((resolve) => restart.close(resolve));
  });
  const third = await rendered("http://127.0.0.1:" + restart.address().port);
  assert.equal(third.url, second.url);
  assert.equal(third.cacheHit, true);
  const large = await save(f, {
    version: 1,
    padding: "x".repeat(8 * 1024 * 1024),
  });
  assert.equal(large.status, 413);
});

test(
  "live tester controls, WOFF2 loading and exported profiles produce the exact same SVG as saved server rendering",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t),
      page = await f.page({ viewport: { width: 1440, height: 1050 } }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(f.url + "/tester");
    await preview(page);
    await page.locator("#cube-file").setInputFiles({
      name: "cube.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ schema: "dbcd-cube-v1", cards: [card] }),
      ),
    });
    await page.waitForFunction(
      (name) => document.querySelector("#cardName").value === name,
      card.name,
    );
    await page.locator("#region").selectOption("name");
    await page.locator("#size").fill("74");
    await page.locator("#weight").fill("200");
    await page.locator("#starGap").fill("11");
    await page.locator("#atkX").fill("605");
    await page.locator("#defX").fill("754");
    await page.locator("#region").selectOption("effect");
    await page.locator("#letterSpacing").fill("0.3");
    await page.locator("#lineHeight").fill("1.2");
    await page.locator("#font-file").setInputFiles(fontFile);
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("Font loaded"),
    );
    const live = await preview(page);
    const geometry = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml"),
        stars = [...doc.querySelectorAll("[data-star-index]")];
      return {
        step:
          Number(stars[1].getAttribute("x")) -
          Number(stars[0].getAttribute("x")),
        atk: doc.querySelector('[data-text-block="atk"]').getAttribute("x"),
        def: doc.querySelector('[data-text-block="def"]').getAttribute("x"),
      };
    }, live);
    assert.deepEqual(geometry, {
      step: projectStyle.stars.size + 11,
      atk: "605",
      def: "754",
    });
    assert.equal(
      (await (await fetch(f.url + "/api/style")).json()).style.regions.name
        .size,
      projectStyle.regions.name.size,
      "Previewing must not change server defaults",
    );
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export").click();
    const download = await downloadPromise;
    const exported = normalizeStyle(
      JSON.parse(fs.readFileSync(await download.path(), "utf8")),
    );
    assert.equal(exported.regions.name.size, 74);
    assert.equal(exported.regions.name.weight, 200);
    assert.equal(exported.regions.effect.letterSpacing, 0.3);
    assert.equal(Object.keys(exported.fonts).length, 1);
    const custom = Object.values(exported.fonts)[0];
    assert.equal(custom.data, fs.readFileSync(fontFile).toString("base64"));
    assert.ok(Object.keys(custom.metrics.widths).length > 1000);
    await page.locator("#save").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#status")
        .textContent.startsWith("Saved to server"),
    );
    assert.equal(
      (await rendered(f.url)).svg,
      live,
      "The tester and server must use the same compositor and settings",
    );
    await page.locator("#reset").click();
    await page.locator("#region").selectOption("name");
    assert.equal(
      await page.locator("#size").inputValue(),
      String(projectStyle.regions.name.size),
    );
    assert.equal(
      (await (await fetch(f.url + "/api/style")).json()).style.regions.name
        .size,
      74,
      "Resetting the preview must not change the saved local style",
    );
    await page.locator("#profile-file").setInputFiles({
      name: "style.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(exported)),
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#status")
        .textContent.startsWith("Imported style"),
    );
    assert.equal(await preview(page), live);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
  },
);

test(
  "downloadable tester renders and edits without a server or external asset requests",
  { timeout: 60000 },
  async (t) => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
    });
    t.after(() => page.close());
    const requests = [],
      errors = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    // Managed Chromium disables file:// navigation. Loading the exact standalone
    // document in an empty page verifies its offline runtime without that policy.
    await page.setContent(testerHtml(testerState(registry, DEFAULT_STYLE)), {
      waitUntil: "load",
    });
    const initial = await preview(page);
    assert.match(initial, /font-style="italic"/);
    assert.match(
      await page.locator("#mode").textContent(),
      /Standalone tester/,
    );
    await page.locator("#region").selectOption("name");
    await page.locator("#size").fill("68");
    await page.waitForFunction(async () => {
      const svg = await (
        await fetch(document.querySelector("#card").src)
      ).text();
      return svg.includes('font-size="68"');
    });
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export").click();
    const download = await downloadPromise;
    assert.equal(
      JSON.parse(fs.readFileSync(await download.path(), "utf8")).regions.name
        .size,
      68,
    );
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  },
);
