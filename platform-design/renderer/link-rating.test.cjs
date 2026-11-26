"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");
const { createRenderServer } = require("../server.cjs");
const { loadAssets, loadLocalLinkFont, renderCard } = require("./render.cjs");
const style = require("./style.default.json");
const pack = path.join(__dirname, "packs");
const manifest = require("./packs/manifest.json");
const value = {
  name: "Link Font Example", type: "Dragon / Link / Effect", attribute: "DARK",
  atk: "1800", link: "LINK-3", effect: "A short effect.",
  visual: { frame: "link", linkArrows: ["top", "bottom-left", "bottom-right"] },
};
test("optional Link Rating font affects only the rating and preserves the no-font fallback", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cube-link-font-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const registry = loadAssets(pack, manifest);
  const original = renderCard(value, registry, style);
  loadLocalLinkFont(registry, dataRoot);
  assert.equal(renderCard(value, registry, style).svg, original.svg);
  fs.mkdirSync(path.join(dataRoot, "fonts"));
  // Use an existing distributable test font: the supplied Eurostile bytes stay local.
  fs.copyFileSync(path.join(pack, "ygocarder/MatrixBoldSmallCaps.woff2"),
    path.join(dataRoot, "fonts/EurostileCandyW02-Bold.woff2"));
  loadLocalLinkFont(registry, dataRoot);
  const rendered = renderCard(value, registry, style);
  assert.match(rendered.svg, /data-text-block="link"[^>]*font-family="CardLinkRating"/);
  assert.match(rendered.svg, /data-text-block="atk"[^>]*font-family="CardBody/);
  assert.notEqual(rendered.hash, original.hash);
  const normal = { ...value, type: "Dragon / Effect", level: 4, visual: { frame: "effect" } };
  assert.equal(renderCard(normal, registry, style).svg,
    renderCard(normal, loadAssets(pack, manifest), style).svg);
  // A custom manifest font takes precedence over the optional local installation.
  const customFont = registry.assets.get("font.body");
  registry.assets.set("font.link-rating", customFont);
  loadLocalLinkFont(registry, dataRoot);
  assert.equal(registry.assets.get("font.link-rating"), customFont);
});

test("server, live tester and standalone tester retain the Link Rating font and credits", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cube-link-tester-"));
  fs.mkdirSync(path.join(dataRoot, "fonts"));
  fs.copyFileSync(path.join(pack, "ygocarder/MatrixBoldSmallCaps.woff2"),
    path.join(dataRoot, "fonts/EurostileCandyW02-Bold.woff2"));
  const server = createRenderServer({ dataRoot });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"],
  });
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(url + "/api/render", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  });
  assert.equal(response.status, 200);
  const rendered = await response.json();
  const svg = await (await fetch(url + rendered.url)).text();
  assert.match(svg, /Linotype Design Studio/);
  assert.match(svg, /OnlineWebFonts.com/);
  const state = await (await fetch(url + "/api/tester-state")).json();
  assert.ok(state.registry.assets.some(([key]) => key === "font.link-rating"));
  assert.match(state.credits.find(credit => credit.name === "link-rating").notice, /Linotype GmbH/);
  const page = await browser.newPage();
  await page.goto(url + "/tester");
  await page.waitForFunction(() => document.querySelector("#card")?.naturalWidth === 813);
  await page.locator("#cube-file").setInputFiles({
    name: "link-cube.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schema: "dbcd-cube-v1", cards: [{ ...value, id: "1", copies: 1 }] })),
  });
  await page.waitForFunction(() => document.querySelector("#cardName").value === "Link Font Example");
  const live = await page.evaluate(() => fetch(document.querySelector("#card").src).then(r => r.text()));
  assert.equal(live, svg);
  // Run the standalone document with the same local assets and no server.
  const { testerHtml } = require("./tester-build.cjs");
  assert.match(testerHtml(state), /Linotype Design Studio/);
  assert.match(testerHtml(state), /font.link-rating/);
  const offlinePage = await browser.newPage();
  await offlinePage.setContent(testerHtml(state));
  await offlinePage.waitForFunction(() => document.querySelector("#card")?.naturalWidth === 813);
  await offlinePage.locator("#cube-file").setInputFiles({
    name: "link-cube.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schema: "dbcd-cube-v1", cards: [{ ...value, id: "1", copies: 1 }] })),
  });
  await offlinePage.waitForFunction(() => document.querySelector("#cardName").value === "Link Font Example");
  const offline = await offlinePage.evaluate(() => fetch(document.querySelector("#card").src).then(r => r.text()));
  assert.equal(offline, svg);
});
