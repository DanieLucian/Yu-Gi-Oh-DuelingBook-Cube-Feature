"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { metricsForFont } = require("./text-layout.cjs");
const { normalizeCard, composeCard } = require("./card-svg.cjs");
const { defaultDataRoot, legacyRendererDirectory } = require("./data-root.cjs");
const VERSION = "card-svg-v3";
function loadAssets(root, manifest) {
  if (
    manifest?.version !== 1 ||
    !manifest.files ||
    typeof manifest.files !== "object" ||
    Array.isArray(manifest.files)
  )
    throw Error("Expected asset manifest version 1 with files.");
  if (
    !manifest.artworks ||
    typeof manifest.artworks !== "object" ||
    Array.isArray(manifest.artworks)
  )
    throw Error("Manifest artworks must map source URLs to local paths.");
  const assets = new Map(),
    artworks = new Map(),
    base = fs.realpathSync(root);
  const fontMetrics = {};
  const imageSizes = new Map();
  const entries = [
    ...Object.entries(manifest.files),
    ...Object.entries(manifest.artworks),
  ];
  if (entries.length > 10000) throw Error("Asset manifest is too large.");
  let bytes = 0;
  function read(relative, key) {
    if (relative == null) return null;
    if (
      typeof relative !== "string" ||
      path.isAbsolute(relative) ||
      relative.includes("\\") ||
      /^[a-z]+:/i.test(relative)
    )
      throw Error("Assets require relative local file paths.");
    const file = fs.realpathSync(path.resolve(base, relative));
    if (!file.startsWith(base + path.sep) || !fs.statSync(file).isFile())
      throw Error("Asset path escapes its directory.");
    const size = fs.statSync(file).size;
    if (size > 10 * 1024 * 1024 || (bytes += size) > 256 * 1024 * 1024)
      throw Error("Asset byte limit exceeded.");
    const buffer = fs.readFileSync(file),
      font = key.startsWith("font.");
    const mime =
      font && buffer.subarray(0, 4).toString() === "wOF2"
        ? "font/woff2"
        : ["font.type", "font.stats", "font.text"].includes(key) && buffer.length >= 4 && buffer.readUInt32BE(0) === 0x00010000
          ? "font/ttf"
        : !font &&
            buffer
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "image/png"
          : !font && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
            ? "image/jpeg"
            : !font &&
                buffer.subarray(0, 4).toString() === "RIFF" &&
                buffer.subarray(8, 12).toString() === "WEBP"
              ? "image/webp"
              : null;
    if (!mime)
      throw Error(
        `Unsupported asset format for ${key}. Use PNG/JPEG/WebP, WOFF2 fonts, or a TTF monster type font.`,
      );
    if (font) fontMetrics[key.slice(5)] = metricsForFont(buffer, key.slice(5));
    const data = `data:${mime};base64,${buffer.toString("base64")}`;
    if (mime === "image/png" && buffer.length >= 24) {
      const width = buffer.readUInt32BE(16),
        height = buffer.readUInt32BE(20);
      if (width && height) imageSizes.set(data, { width, height });
    }
    return data;
  }
  for (const [key, file] of Object.entries(manifest.files))
    assets.set(key, read(file, key));
  for (const [url, file] of Object.entries(manifest.artworks))
    artworks.set(url, read(file, "artwork"));
  if (
    manifest.profile != null &&
    !["schematic", "tcg-813-v1", "predefined-813-v1"].includes(manifest.profile)
  )
    throw Error("Unknown card layout profile.");
  const compositeSpecs = manifest.composites ?? {};
  if (
    !compositeSpecs ||
    typeof compositeSpecs !== "object" ||
    Array.isArray(compositeSpecs) ||
    Object.keys(compositeSpecs).length > 100
  )
    throw Error("Invalid asset composites.");
  const composites = new Map();
  const dimension = (value) =>
    Number.isFinite(value) && value > 0 && value <= 4096;
  for (const [key, spec] of Object.entries(compositeSpecs)) {
    if (
      !spec ||
      !dimension(spec.width) ||
      !dimension(spec.height) ||
      !Array.isArray(spec.layers) ||
      !spec.layers.length ||
      spec.layers.length > 8
    )
      throw Error("Invalid composite dimensions or layer count.");
    const layers = spec.layers.map((layer) => {
      if (
        !layer ||
        typeof layer.key !== "string" ||
        !assets.get(layer.key) ||
        layer.key.startsWith("font.") ||
        !Number.isFinite(layer.x) ||
        !Number.isFinite(layer.y) ||
        Math.abs(layer.x) > 4096 ||
        Math.abs(layer.y) > 4096 ||
        !dimension(layer.width) ||
        !dimension(layer.height)
      )
        throw Error(
          "Composite must reference local raster layers and finite coordinates.",
        );
      return { ...layer, data: assets.get(layer.key) };
    });
    composites.set(key, { width: spec.width, height: spec.height, layers });
  }
  return {
    assets,
    artworks,
    composites,
    profile: manifest.profile ?? "schematic",
    fontMetrics,
    imageSizes,
  };
}
function renderCard(card, registry, style) {
  const result = composeCard(card, registry, style);
  const hash = crypto
    .createHash("sha256")
    .update(VERSION)
    .update(result.svg)
    .digest("hex");
  return { ...result, hash };
}
function loadLocalFont(registry, key, file, dataRoot) {
  if (registry.assets.get(key)) return registry;
  const root = path.join(dataRoot, "fonts");
  if (!fs.existsSync(path.join(root, file))) return registry;
  const local = loadAssets(root, {
    version: 1, files: { [key]: file }, artworks: {},
  });
  registry.assets.set(key, local.assets.get(key));
  registry.fontMetrics[key.slice(5)] = local.fontMetrics[key.slice(5)];
  return registry;
}
function loadLocalLinkFont(registry, dataRoot = defaultDataRoot) {
  return loadLocalFont(registry, "font.link-rating", "EurostileCandyW02-Bold.woff2", dataRoot);
}
function loadLocalTypeFont(registry, dataRoot = defaultDataRoot) {
  return loadLocalFont(registry, "font.type", "StoneSerif-BoldSmallCaps.ttf", dataRoot);
}
function loadLocalStatsFont(registry, dataRoot = defaultDataRoot) {
  loadLocalFont(registry, "font.text", "MatrixBook.ttf", dataRoot);
  return loadLocalFont(registry, "font.stats", "MatrixRegularSmallCaps.ttf", dataRoot);
}
function defaultAssetRoot(directory = __dirname) {
  const custom = path.join(directory, "assets");
  if (fs.existsSync(path.join(custom, "manifest.json"))) return custom;
  const legacy = path.join(legacyRendererDirectory, "assets");
  if (directory === __dirname && fs.existsSync(path.join(legacy, "manifest.json"))) return legacy;
  return path.join(directory, "packs");
}
module.exports = { normalizeCard, defaultAssetRoot, loadAssets, loadLocalLinkFont, loadLocalTypeFont, loadLocalStatsFont, renderCard, VERSION };
