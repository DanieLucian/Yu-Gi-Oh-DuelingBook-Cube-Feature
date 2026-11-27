"use strict";
const fs = require("node:fs");
const path = require("node:path");

const legacyRendererDirectory = path.resolve(__dirname, "../../platform-design/renderer");
const legacyDataRoot = path.join(legacyRendererDirectory, "data");
const defaultDataRoot = fs.statSync(legacyDataRoot, { throwIfNoEntry: false })?.isDirectory()
  ? legacyDataRoot
  : path.join(__dirname, "data");

module.exports = { defaultDataRoot, legacyRendererDirectory };
