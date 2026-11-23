"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
(async () => {
  const bytes = fs.readFileSync(path.join(__dirname, "data/fonts/EurostileCandyW02-Bold.woff2"));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const measured = await page.evaluate(async (data) => {
      const font = new FontFace("MeasureLinkRating", `url(data:font/woff2;base64,${data})`);
      document.fonts.add(await font.load());
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = "1000px MeasureLinkRating";
      ctx.fontKerning = "none";
      const widths = {};
      for (let i = 32; i <= 126; i++)
        widths[String.fromCharCode(i)] = ctx.measureText(String.fromCharCode(i)).width / 1000;
      const bounds = ctx.measureText("0123456789?");
      return { widths, kernings: {}, ascent: bounds.actualBoundingBoxAscent / 1000, descent: bounds.actualBoundingBoxDescent / 1000 };
    }, bytes.toString("base64"));
    const result = { sha256: crypto.createHash("sha256").update(bytes).digest("hex"), ...measured };
    fs.writeFileSync(path.join(__dirname, "link-rating-font-metrics.json"), JSON.stringify(result, null, 2) + "\n");
    console.log("Measured Link Rating font:", result.sha256);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
