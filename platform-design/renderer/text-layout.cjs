"use strict";
const crypto = require("node:crypto");
const metrics = require("./font-metrics.json");
function metricsForFont(bytes, role) {
  const font = metrics.fonts[role];
  return font &&
    crypto.createHash("sha256").update(bytes).digest("hex") === font.sha256
    ? font
    : null;
}
function measureText(value, font, size = 1) {
  let width = 0,
    last = "";
  for (const char of String(value)) {
    const fallback = /\p{Mark}/u.test(char)
      ? 0
      : char === " "
        ? 0.25
        : /[ilI.,'!|]/.test(char)
          ? 0.28
          : /[MW@]/.test(char)
            ? 0.9
            : char.codePointAt(0) > 0x2fff
              ? 1
              : 0.56;
    width +=
      (font?.widths[char] ?? fallback) + (font?.kernings[last + char] ?? 0);
    last = char;
  }
  return width * size;
}
function wrapText(value, width, font, size) {
  const lines = [];
  for (const paragraph of String(value).split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const next = line ? line + " " + word : word;
      if (measureText(next, font, size) <= width) {
        line = next;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      // A long identifier or URL still needs a physical line break.
      for (const char of word) {
        if (line && measureText(line + char, font, size) > width) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}
function fitText(
  value,
  { font, width, height, preferredSize = 26, minSize = 16 },
) {
  const source = String(value);
  if (!source.trim())
    return {
      lines: [],
      fontSize: preferredSize,
      lineHeight: Math.ceil(preferredSize * 1.12),
      ascent: (font?.ascent ?? 0.85) * preferredSize,
      overflow: false,
    };
  for (let size = preferredSize; size >= minSize; size--) {
    const lineHeight = Math.ceil(size * 1.12),
      ascent = (font?.ascent ?? 0.85) * size,
      descent = (font?.descent ?? 0.25) * size;
    const maxLines = Math.max(
      0,
      1 + Math.floor((height - ascent - descent) / lineHeight),
    );
    const lines = wrapText(source, width, font, size);
    if (lines.length <= maxLines || size === minSize)
      return {
        lines: lines.slice(0, maxLines),
        fontSize: size,
        lineHeight,
        ascent,
        overflow: lines.length > maxLines,
      };
  }
}
module.exports = { metricsForFont, measureText, wrapText, fitText };
