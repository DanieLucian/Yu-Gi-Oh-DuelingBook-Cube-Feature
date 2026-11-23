"use strict";
const crypto = require("node:crypto");
const metrics = require("./font-metrics.json");
function metricsForFont(bytes, role) {
  const font = role === "link-rating"
    ? require("./link-rating-font-metrics.json")
    : role === "stats" ? require("./stats-font-metrics.json") : role === "text" ? require("./book-font-metrics.json") : metrics.fonts[role];
  return font &&
    crypto.createHash("sha256").update(bytes).digest("hex") === font.sha256
    ? font
    : null;
}
module.exports = { metricsForFont, ...require("./text-layout-core.cjs") };
