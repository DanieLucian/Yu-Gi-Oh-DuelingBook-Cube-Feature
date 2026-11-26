"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
function supportedArtwork(source) {
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["www.duelingbook.com", "duelingbook.com", "images.duelingbook.com"].includes(url.hostname) &&
      /^\/(?:custom-pics\/\d+|pics|low-res|card-pics|small)\/\d+\.(?:png|jpe?g|webp)$/i.test(url.pathname);
  } catch { return false; }
}
function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  throw Error("Unsupported artwork format");
}
function createArtworkCache(registry, dataRoot, fetchImage = fetch) {
  const directory = path.join(dataRoot, "artwork-cache"), pending = new Map(), failures = new Map();
  fs.mkdirSync(directory, { recursive: true });
  const limit = 10 * 1024 * 1024;
  let total = fs.readdirSync(directory).filter(file => /^[a-f0-9]{64}\.img$/.test(file))
    .reduce((bytes, file) => bytes + fs.statSync(path.join(directory, file)).size, 0);
  async function load(source) {
    const filename = path.join(directory, crypto.createHash("sha256").update(source).digest("hex") + ".img");
    let bytes;
    if (fs.existsSync(filename)) {
      if (fs.statSync(filename).size > limit) throw Error("Artwork too large");
      bytes = fs.readFileSync(filename);
    } else {
      const response = await fetchImage(source, { redirect: "error", signal: AbortSignal.timeout(6000) });
      if (!response.ok || !response.body) throw Error("Artwork download failed");
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) throw Error("Artwork too large");
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks);
      imageMime(bytes);
      if (total + size > 256 * 1024 * 1024) throw Error("Artwork cache full");
      fs.writeFileSync(filename, bytes);
      total += size;
    }
    registry.artworks.set(source, `data:${imageMime(bytes)};base64,${bytes.toString("base64")}`);
  }
  return async source => {
    if (!source || registry.artworks.has(source) || !supportedArtwork(source)) return;
    if ((failures.get(source) || 0) > Date.now()) return;
    if (!pending.has(source)) pending.set(source, load(source).catch(() => {
      failures.set(source, Date.now() + 60000);
    }).finally(() => pending.delete(source)));
    await pending.get(source);
  };
}
module.exports = { createArtworkCache, supportedArtwork };
