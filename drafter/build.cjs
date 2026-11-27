"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { stage } = require("../tools/stage.cjs");

const output = stage("drafter");
const files = [
  "backend/server.cjs", "backend/rooms.cjs", "backend/cube-db.cjs",
  "frontend/index.html", "frontend/room-client.js", "frontend/cube-library.js",
  "frontend/draft-renderer.js", "frontend/mock-cube.js",
  "renderer/render.cjs", "renderer/artwork-cache.cjs", "renderer/card-svg.cjs", "renderer/data-root.cjs",
  "renderer/style-profile.cjs", "renderer/style.default.json",
  "renderer/text-layout.cjs", "renderer/text-layout-core.cjs",
  "renderer/font-metrics.json", "renderer/book-font-metrics.json",
  "renderer/link-rating-font-metrics.json", "renderer/stats-font-metrics.json",
  "renderer/assets/manifest.example.json",
  "renderer/gallery.html", "renderer/gallery.js", "renderer/tester.html",
  "renderer/tester.js", "renderer/tester-build.cjs", "renderer/packs",
];
for (const file of files) {
  const target = path.join(output, "drafter", file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(__dirname, file), target, { recursive: true });
}
fs.mkdirSync(path.join(output, "shared"));
fs.copyFileSync(path.join(__dirname, "..", "shared", "cube-format.cjs"),
  path.join(output, "shared", "cube-format.cjs"));
fs.copyFileSync(path.join(__dirname, "start-production.cjs"), path.join(output, "start.cjs"));
console.log(`Drafting platform: ${output}`);
