const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { loadAssets, loadLocalStatsFont, renderCard } = require("./render.cjs");
test("Matrix Regular names compress only after their natural width exceeds the row", async t => {
  if (!fs.existsSync(path.join(__dirname, "data/fonts/MatrixRegularSmallCaps.ttf"))) return t.skip("Local font absent");
  const registry = loadLocalStatsFont(loadAssets(path.join(__dirname, "packs"), require("./packs/manifest.json")));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  for (let count = 8; count <= 24; count++) {
    await page.setContent(renderCard({name: "A".repeat(count), type: "Dragon / Effect"}, registry, require("./style.default.json")).svg);
    const result = await page.evaluate(async () => {
      await document.fonts.ready;
      const text = document.querySelector('[data-text-block="name"]');
      const compressed = text.hasAttribute("textLength");
      text.removeAttribute("textLength");
      return {compressed, width: text.getComputedTextLength()};
    });
    assert.equal(result.compressed, result.width > 600, `${count} letters: natural width ${result.width}`);
  }
});
