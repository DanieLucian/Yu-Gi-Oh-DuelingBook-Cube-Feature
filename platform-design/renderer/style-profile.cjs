"use strict";
const textRegion = (size, weight = 400) => ({
  font: "body",
  size,
  weight,
  italic: false,
  letterSpacing: 0,
  offsetX: 0,
  offsetY: 0,
});
const DEFAULT_STYLE = {
  version: 1,
  regions: {
    name: { ...textRegion(80), font: "name", edgeOpacity: 0.45 },
    effect: { ...textRegion(26), minSize: 16, lineHeight: 1.12 },
    pendulum: { ...textRegion(26), minSize: 16, lineHeight: 1.12 },
    kind: textRegion(40, 700),
    type: textRegion(26, 700),
    stats: textRegion(28),
  },
  stars: { size: 42, gap: 7 },
  stats: { atkX: 593, defX: 747, baseline: 1107 },
  fonts: {},
};
const FONT_IDS = ["name", "body", "serif", "sans-serif"];
function record(value, allowed, field) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`${field} must be an object.`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw Error(`Unknown ${field}.${key}.`);
}
function number(value, min, max, field) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw Error(`${field} must be ${min}–${max}.`);
  return value;
}
function normalizeStyle(input = DEFAULT_STYLE) {
  record(input, ["version", "regions", "stars", "stats", "fonts"], "style");
  if (input.version !== 1) throw Error("Expected style profile version 1.");
  const result = structuredClone(DEFAULT_STYLE);
  if (input.fonts != null) {
    const ids = Object.keys(input.fonts);
    record(input.fonts, ids, "fonts");
    if (ids.length > 6)
      throw Error("At most six uploaded fonts are supported.");
    let bytes = 0;
    for (const id of ids) {
      if (!/^upload-[a-z0-9-]{1,40}$/.test(id))
        throw Error("Invalid uploaded font ID.");
      const font = input.fonts[id];
      record(font, ["name", "data", "metrics"], "font");
      if (typeof font.name !== "string" || font.name.length > 120)
        throw Error("Invalid font name.");
      if (
        typeof font.data !== "string" ||
        font.data.length > 2800000 ||
        font.data.length % 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(font.data)
      )
        throw Error("Expected a WOFF2 font encoded as base64 (maximum 2 MB).");
      const decoded = atob(font.data);
      bytes += decoded.length;
      const declared =
        decoded.length >= 48
          ? decoded.charCodeAt(8) * 2 ** 24 +
            (decoded.charCodeAt(9) << 16) +
            (decoded.charCodeAt(10) << 8) +
            decoded.charCodeAt(11)
          : 0;
      if (
        decoded.slice(0, 4) !== "wOF2" ||
        declared !== decoded.length ||
        decoded.length > 2 * 1024 * 1024 ||
        bytes > 5 * 1024 * 1024
      )
        throw Error("Invalid WOFF2 header or font byte limit exceeded.");
      const validated = { name: font.name, data: font.data };
      if (font.metrics != null) {
        record(font.metrics, ["widths", "ascent", "descent"], "font metrics");
        const widths = font.metrics.widths;
        if (
          !widths ||
          typeof widths !== "object" ||
          Array.isArray(widths) ||
          Object.keys(widths).length > 8192
        )
          throw Error("Invalid font widths.");
        const safeWidths = {};
        for (const [char, width] of Object.entries(widths)) {
          if (Array.from(char).length !== 1)
            throw Error("Expected single-character font widths.");
          safeWidths[char] = number(width, 0, 4, "glyph width");
        }
        validated.metrics = {
          widths: safeWidths,
          ascent: number(font.metrics.ascent, 0.1, 2, "font ascent"),
          descent: number(font.metrics.descent, 0, 1, "font descent"),
        };
      }
      result.fonts[id] = validated;
    }
  }
  if (input.regions != null) {
    record(input.regions, Object.keys(DEFAULT_STYLE.regions), "regions");
    for (const [key, region] of Object.entries(input.regions)) {
      const defaults = DEFAULT_STYLE.regions[key];
      record(region, Object.keys(defaults), key);
      for (const [field, value] of Object.entries(region)) {
        if (field === "font") {
          if (![...FONT_IDS, ...Object.keys(result.fonts)].includes(value))
            throw Error("Choose a bundled, generic or uploaded font.");
        } else if (field === "italic") {
          if (typeof value !== "boolean")
            throw Error("Italic must be true or false.");
        } else if (field === "weight") {
          number(value, 100, 900, "font weight");
        } else {
          const bounds = {
            size: [8, 120],
            minSize: [8, 60],
            lineHeight: [0.8, 2],
            letterSpacing: [-2, 8],
            offsetX: [-80, 80],
            offsetY: [-60, 60],
            edgeOpacity: [0, 1],
          }[field];
          number(value, ...bounds, field);
        }
        result.regions[key][field] = value;
      }
      if (
        "minSize" in defaults &&
        result.regions[key].minSize > result.regions[key].size
      )
        throw Error("Minimum font size cannot exceed preferred size.");
    }
  }
  for (const [key, bounds] of Object.entries({
    stars: { size: [16, 60], gap: [0, 30] },
    stats: { atkX: [510, 640], defX: [690, 765], baseline: [1085, 1120] },
  })) {
    if (input[key] == null) continue;
    record(input[key], Object.keys(bounds), key);
    for (const [field, value] of Object.entries(input[key]))
      result[key][field] = number(value, ...bounds[field], field);
  }
  return result;
}
function regionFont(style, registry, region) {
  const font = style.regions[region].font;
  if (font === "name")
    return {
      family: "CardName, Georgia, serif",
      metrics: registry.fontMetrics?.name,
    };
  if (font === "body")
    return {
      family: "CardBody, Georgia, serif",
      metrics: registry.fontMetrics?.body,
    };
  if (font === "serif" || font === "sans-serif")
    return { family: font, metrics: null };
  return { family: `Custom_${font}`, metrics: style.fonts[font]?.metrics };
}
module.exports = { DEFAULT_STYLE, normalizeStyle, regionFont };
