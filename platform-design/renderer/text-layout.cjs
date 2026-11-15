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
module.exports = { metricsForFont, ...require("./text-layout-core.cjs") };
