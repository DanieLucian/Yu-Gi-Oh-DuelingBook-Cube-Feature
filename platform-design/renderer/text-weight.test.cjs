"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadAssets, loadLocalStatsFont, renderCard } = require("./render.cjs");
const { chromium } = require("playwright");
const style = require("./style.default.json");
const registry = loadAssets(path.join(__dirname, "packs"), require("./packs/manifest.json"));

test("all fixed-face text regions use solid strokes for heavy weights and preserve lighter masks", () => {
  for (const key of ["effect", "pendulum", "kind", "type", "stats"]) {
    const card = key === "kind"
      ? { name: "Spell", type: "Spell", visual: { frame: "spell", spellTrapIcon: "normal" } }
      : { name: "Monster", type: "Dragon / Pendulum / Effect", effect: "Effect text.", pendulumEffect: "Pendulum text.",
          level: 4, atk: "1800", def: "1200", visual: { frame: "effect", pendulum: true, scaleLeft: 1, scaleRight: 1 } };
    for (const font of ["body", "name"]) {
      const tuning = structuredClone(style);
      Object.assign(tuning.regions[key], { weight: 700, font });
      const heavy = renderCard(card, registry, tuning).svg;
      const filter = heavy.match(new RegExp(`<filter id="card-${key}-weight"[^>]*>(.*?)</filter>`))[1];
      assert.match(filter, /feFuncA type="linear" slope="5.2"/, `${key}/${font}: progressive coverage`);
      assert.doesNotMatch(filter, /feMorphology|weight-limit/, `${key}/${font}: no dilated halo`);
      assert.match(heavy, new RegExp(`filter="url\\(#card-${key}-weight\\)" stroke="#000" stroke-width="[0-9.]+" stroke-linejoin="round" paint-order="stroke fill"`));
      tuning.regions[key].weight = 100;
      const light = renderCard(card, registry, tuning).svg;
      assert.match(light, new RegExp(`id="card-${key}-weight"[^>]*><feMorphology[^>]*operator="erode"`));
      assert.doesNotMatch(light, new RegExp(`filter="url\\(#card-${key}-weight\\)" stroke=`));
    }
  }
});

test("Link rating shares the solid stats weight treatment", () => {
  const tuning = structuredClone(style);
  tuning.regions.stats.weight = 700;
  const svg = renderCard({ name: "Link", type: "Cyberse / Link", link: "3", atk: "2300", visual: { frame: "link" } }, registry, tuning).svg;
  assert.match(svg, /data-text-block="link"[^>]*filter="url\(#card-stats-weight\)" stroke="#000"/);
});

test("rendered weights remain continuous across 400 for every adjustable text area", async t => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const fonts = loadLocalStatsFont(loadAssets(path.join(__dirname, "packs"), require("./packs/manifest.json")));
  for (const key of ["name", "effect", "pendulum", "kind", "type", "stats"]) {
    const card = key === "kind" ? { name: "Spell", type: "Spell", visual: { frame: "spell", spellTrapIcon: "normal" } }
      : { name: "Smooth Font Weights", type: "Dragon / Pendulum / Effect", level: 4, atk: "1800", def: "1200",
          effect: "Draw one card, then discard one card.", pendulumEffect: "Once per turn: Draw one card.",
          visual: { frame: "effect", pendulum: true, scaleLeft: 1, scaleRight: 1 } };
    const coverage = [];
    for (const weight of [399, 400, 401, 402, 500, 700, 900]) {
      const tuning = structuredClone(style);
      tuning.regions[key].weight = weight;
      const svg = renderCard(card, fonts, tuning).svg;
      coverage.push(await page.evaluate(async ({ svg, key }) => {
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
        const source = doc.documentElement;
        const selector = key === "stats" ? '[data-text-block="atk"]' : `[data-text-block="${key}"]`;
        const text = source.querySelector(selector).cloneNode(true);
        for (const child of [...source.children])
          if (!["defs", "style"].includes(child.localName)) child.remove();
        source.append(text);
        const mounted = document.importNode(source, true);
        document.body.replaceChildren(mounted);
        await document.fonts.ready;
        const box = mounted.querySelector(selector).getBBox();
        source.setAttribute("viewBox", `${box.x - 4} ${box.y - 4} ${box.width + 8} ${box.height + 8}`);
        const width = Math.ceil((box.width + 8) * 2), height = Math.ceil((box.height + 8) * 2);
        source.setAttribute("width", width); source.setAttribute("height", height);
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(source)], { type: "image/svg+xml" }));
        try {
          const image = new Image(); image.src = url; await image.decode();
          const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, width, height).data;
          let ink = 0;
          for (let i = 0; i < pixels.length; i += 4) ink += 255 - pixels[i];
          return ink;
        } finally { URL.revokeObjectURL(url); }
      }, { svg, key }));
    }
    const [below, base, first, second, middle, heavy, maximum] = coverage;
    assert.ok(Math.abs(first - base) < base * .035, `${key}: 400 to 401 must be a small change (${coverage})`);
    assert.ok(Math.abs(second - first) < base * .035, `${key}: 401 to 402 must be a small change`);
    assert.ok(Math.abs(base - below) < base * .035, `${key}: 399 to 400 must be a small change`);
    assert.ok(middle > first && heavy > middle && maximum > heavy, `${key}: intermediate weights progressively increase coverage`);
  }
});
