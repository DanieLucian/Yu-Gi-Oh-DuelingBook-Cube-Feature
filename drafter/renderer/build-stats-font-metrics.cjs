"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { defaultDataRoot } = require("./data-root.cjs");
(async () => {
  const book = process.argv.includes("--book");
  const bytes = fs.readFileSync(path.join(defaultDataRoot, "fonts", book ? "MatrixBook.ttf" : "MatrixRegularSmallCaps.ttf"));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const metrics = await page.evaluate(async data => {
      const font = new FontFace("MatrixMeasure", `url(data:font/ttf;base64,${data})`);
      document.fonts.add(await font.load());
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = "1000px MatrixMeasure";
      ctx.fontKerning = "normal";
      const widths = {}, kernings = {};
      for (let code = 32; code <= 0x206f; code++) {
        const char = String.fromCodePoint(code);
        widths[char] = ctx.measureText(char).width / 1000;
      }
      for (let a = 32; a <= 126; a++) for (let b = 32; b <= 126; b++) {
        const pair = String.fromCharCode(a, b);
        const delta = ctx.measureText(pair).width / 1000 - widths[pair[0]] - widths[pair[1]];
        if (Math.abs(delta) > 0.0001) kernings[pair] = delta;
      }
      const sample = ctx.measureText("ÁÉHgjpq");
      return { widths, kernings, ascent: sample.actualBoundingBoxAscent / 1000, descent: sample.actualBoundingBoxDescent / 1000 };
    }, bytes.toString("base64"));
    fs.writeFileSync(path.join(__dirname, book ? "book-font-metrics.json" : "stats-font-metrics.json"), JSON.stringify({sha256: crypto.createHash("sha256").update(bytes).digest("hex"), ...metrics}) + "\n");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
