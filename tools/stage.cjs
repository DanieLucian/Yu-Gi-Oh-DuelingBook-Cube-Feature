"use strict";
const fs = require("node:fs");
const path = require("node:path");

function stage(app) {
  const root = fs.realpathSync(path.resolve(__dirname, ".."));
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  if (fs.realpathSync(dist) !== dist) throw Error("dist must be inside the repository.");
  const output = path.join(dist, app);
  if (fs.existsSync(output) && fs.realpathSync(output) !== output) {
    throw Error("Build output must be inside dist.");
  }
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output);
  return output;
}

module.exports = { stage };
