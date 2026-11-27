"use strict";
// Development-only: the rendering server reads the generated JSON and needs no browser.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
async function build() {
  const root = path.join(__dirname, "packs/ygocarder");
  const fonts = {
    name: "MatrixBoldSmallCaps.woff2",
    body: "stone-serif-regular-webfont.woff2",
  };
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const result = { version: 1, fonts: {} };
    for (const [role, file] of Object.entries(fonts)) {
      const bytes = fs.readFileSync(path.join(root, file));
      const measurements = await page.evaluate(async (encoded) => {
        const font = new FontFace(
          "MeasureCardFont",
          `url(data:font/woff2;base64,${encoded})`,
        );
        await font.load();
        document.fonts.add(font);
        const context = document.createElement("canvas").getContext("2d");
        const em = 1000;
        context.font = `${em}px MeasureCardFont`;
        context.fontKerning = "normal";
        const characters = [];
        for (let i = 32; i <= 591; i++)
          characters.push(String.fromCodePoint(i));
        for (let i = 0x300; i <= 0x52f; i++)
          characters.push(String.fromCodePoint(i));
        for (let i = 0x2000; i <= 0x206f; i++)
          characters.push(String.fromCodePoint(i));
        const widths = {},
          kernings = {};
        for (const ch of characters)
          widths[ch] = Number((context.measureText(ch).width / em).toFixed(6));
        for (let a = 32; a <= 126; a++)
          for (let b = 32; b <= 126; b++) {
            const pair = String.fromCharCode(a, b),
              adjust =
                context.measureText(pair).width / em -
                widths[pair[0]] -
                widths[pair[1]];
            if (Math.abs(adjust) > 0.0001)
              kernings[pair] = Number(adjust.toFixed(6));
          }
        const sample = context.measureText("ÁÉHgjpq");
        const ascent = sample.actualBoundingBoxAscent / em,
          descent = sample.actualBoundingBoxDescent / em;
        document.fonts.delete(font);
        return { ascent, descent, widths, kernings };
      }, bytes.toString("base64"));
      result.fonts[role] = {
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        ...measurements,
      };
    }
    fs.writeFileSync(
      path.join(__dirname, "font-metrics.json"),
      JSON.stringify(result) + "\n",
    );
    for (const [role, font] of Object.entries(result.fonts))
      console.log(role, {
        ascent: font.ascent,
        descent: font.descent,
        glyphs: Object.keys(font.widths).length,
        pairs: Object.keys(font.kernings).length,
      });
  } finally {
    await browser.close();
  }
}
if (require.main === module)
  build().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { build };
