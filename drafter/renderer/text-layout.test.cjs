const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  metricsForFont,
  measureText,
  wrapText,
  fitText,
} = require("./text-layout.cjs");
const bytes = fs.readFileSync(
  path.join(__dirname, "packs/ygocarder/stone-serif-regular-webfont.woff2"),
);
const font = metricsForFont(bytes, "body");
const effect =
  "When a monster(s) is Summoned: Destroy all monsters on the field.";

test("font measurements are tied to the exact font bytes and reproduce the reference line break", () => {
  assert.ok(font);
  assert.equal(
    metricsForFont(Buffer.concat([bytes, Buffer.from("different")]), "body"),
    null,
  );
  const layout = fitText(effect, { font, width: 685, height: 205 });
  assert.equal(layout.fontSize, 26);
  assert.deepEqual(layout.lines, [
    "When a monster(s) is Summoned: Destroy all monsters",
    "on the field.",
  ]);
  assert.equal(layout.overflow, false);
});

test("long effects reduce in size and stay within the text box without losing words", () => {
  const text = Array(5).fill(effect).join(" "),
    height = 149,
    width = 685;
  const layout = fitText(text, { font, width, height });
  assert.ok(layout.fontSize < 26 && layout.fontSize >= 16);
  assert.equal(layout.overflow, false);
  assert.equal(layout.lines.join(" "), text);
  for (const line of layout.lines)
    assert.ok(measureText(line, font, layout.fontSize) <= width + 0.01);
  assert.ok(
    layout.ascent +
      (layout.lines.length - 1) * layout.lineHeight +
      font.descent * layout.fontSize <=
      height,
  );
  assert.equal(
    fitText(effect.repeat(100), { font, width, height }).overflow,
    true,
  );
});

test("wrapping retains paragraphs and handles long words, diacritics and unknown glyphs", () => {
  assert.deepEqual(wrapText("First\n\nThird", 200, font, 26), [
    "First",
    "",
    "Third",
  ]);
  const lines = wrapText("Știință " + "W".repeat(50) + " 😀😀", 90, font, 26);
  for (const line of lines) assert.ok(measureText(line, font, 26) <= 90 + 0.01);
  assert.equal(
    lines.join("").replaceAll(" ", ""),
    "Știință" + "W".repeat(50) + "😀😀",
  );
  assert.equal(fitText("", { font, width: 685, height: 100 }).lines.length, 0);
});

test("uploaded font measurements support fractional sizes, letter spacing and adjustable line height without pair data", () => {
  const captured = {
    widths: font.widths,
    ascent: font.ascent,
    descent: font.descent,
  };
  const source = Array(3).fill(effect).join(" ");
  const width = 685,
    height = 149,
    letterSpacing = 0.6,
    ratio = 1.3;
  const layout = fitText(source, {
    font: captured,
    width,
    height,
    preferredSize: 24.5,
    minSize: 16.5,
    letterSpacing,
    lineHeight: ratio,
  });
  assert.equal(layout.overflow, false);
  assert.equal(layout.lines.join(" "), source);
  assert.ok(layout.fontSize >= 16.5 && layout.fontSize <= 24.5);
  assert.equal(layout.lineHeight, Math.ceil(layout.fontSize * ratio));
  for (const line of layout.lines)
    assert.ok(
      measureText(line, captured, layout.fontSize, letterSpacing) <= width,
    );
  assert.ok(
    layout.ascent +
      (layout.lines.length - 1) * layout.lineHeight +
      captured.descent * layout.fontSize <=
      height,
  );
});
