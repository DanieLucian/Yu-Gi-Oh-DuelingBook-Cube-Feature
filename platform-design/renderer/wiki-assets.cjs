"use strict";
// Run separately from the rendering server. Cube uploads cannot invoke this tool.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { loadAssets } = require("./render.cjs");
const SOURCES = {
  fandom: {
    api: "https://yugioh.fandom.com/api.php",
    hosts: ["yugioh.fandom.com", "static.wikia.nocookie.net"],
  },
  yugipedia: {
    api: "https://yugipedia.com/api.php",
    hosts: ["yugipedia.com", "ms.yugipedia.com"],
  },
};
const EXAMPLE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "assets/manifest.example.json"), "utf8"),
);
const ATTRIBUTES = [
  "DARK",
  "LIGHT",
  "EARTH",
  "WATER",
  "FIRE",
  "WIND",
  "DIVINE",
];
const ICONS = {
  "icon.level": "Level",
  "icon.rank": "Rank",
  "icon.continuous": "Continuous",
  "icon.counter": "Counter",
  "icon.equip": "Equip",
  "icon.field": "Field",
  "icon.quick-play": "Quick-Play",
  "icon.ritual": "Ritual",
};
const EXACT = Object.fromEntries([
  ...ATTRIBUTES.map((name) => [
    "attribute." + name,
    [`File:${name}.svg`, `File:${name}.png`],
  ]),
  ...Object.entries(ICONS).map(([key, name]) => [
    key,
    [`File:${name}.svg`, `File:${name}.png`],
  ]),
]);
const SEARCHES = [
  ["border", "card border"],
  ...Object.keys(EXAMPLE.files)
    .filter((k) => k.startsWith("background."))
    .map((key) => [key, key.slice(11).replaceAll("-", " ") + " card template"]),
  ["icon.link-arrow", "Link Arrow"],
];
function checkedUrl(value, source) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !Object.hasOwn(SOURCES, source) ||
    !SOURCES[source].hosts.includes(url.hostname)
  )
    throw Error("Asset URL is outside the selected wiki/CDN.");
  return url;
}
async function requestBytes(value, source, redirects = 0) {
  const url = checkedUrl(value, source);
  if (redirects > 4) throw Error("Too many redirects.");
  if (
    (process.env.HTTPS_PROXY || process.env.https_proxy) &&
    !http.setGlobalProxyFromEnv
  )
    throw Error(
      "Install a current Node.js 24 LTS release to use the configured HTTPS proxy.",
    );
  http.setGlobalProxyFromEnv?.();
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "DuelingBookCubeDraft-AssetImporter/0.1 (local renderer asset research)",
          Accept: "application/json,image/*;q=0.9,*/*;q=0.1",
        },
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          try {
            resolve(
              requestBytes(
                new URL(response.headers.location, url).href,
                source,
                redirects + 1,
              ),
            );
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            Error(
              `Wiki request returned HTTP ${response.statusCode} for ${url.hostname}. Check network access or the site's response; no asset was installed.`,
            ),
          );
          return;
        }
        let size = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 10 * 1024 * 1024)
            response.destroy(Error("Wiki response exceeds 10 MB."));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    request.setTimeout(20000, () =>
      request.destroy(Error("Wiki request timed out.")),
    );
    request.on("error", reject);
  });
}
async function query(source, params, request = requestBytes) {
  if (!Object.hasOwn(SOURCES, source))
    throw Error("Source must be fandom or yugipedia.");
  const url = new URL(SOURCES[source].api);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    redirects: "1",
    prop: "imageinfo",
    iiprop: "url|mime|size|sha1|extmetadata",
    ...params,
  });
  const buffer = await request(url.href, source);
  let data;
  try {
    data = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw Error(
      "Wiki API did not return JSON. It may be blocked or serving a challenge page.",
    );
  }
  if (data.error)
    throw Error("Wiki API error: " + (data.error.code || "unknown"));
  if (data.warnings)
    throw Error(
      "Wiki API reported unsupported parameters. Inspect its response before downloading.",
    );
  return Array.isArray(data.query?.pages)
    ? data.query.pages
    : Object.values(data.query?.pages || {});
}
function info(page, source, keys = []) {
  const image = page.imageinfo?.[0];
  if (!image || page.missing === true || page.missing === "") return null;
  const originalUrl = checkedUrl(image.url, source).href;
  const metadata = image.extmetadata || {};
  const meta = (name) =>
    typeof metadata[name]?.value === "string" ? metadata[name].value : "";
  return {
    title: page.title,
    proposedKeys: keys,
    originalUrl,
    filePageUrl: image.descriptionurl || "",
    mime: image.mime,
    width: image.width,
    height: image.height,
    wikiSha1: image.sha1 || "",
    attribution: {
      artist: meta("Artist"),
      credit: meta("Credit"),
      license: meta("LicenseShortName"),
      licenseUrl: meta("LicenseUrl"),
      usageTerms: meta("UsageTerms"),
      attributionRequired: meta("AttributionRequired"),
    },
  };
}
async function discover({
  source = "fandom",
  request = requestBytes,
  pause = () => new Promise((r) => setTimeout(r, 350)),
} = {}) {
  if (!Object.hasOwn(SOURCES, source))
    throw Error("Source must be fandom or yugipedia.");
  const candidates = new Map(),
    titles = Object.values(EXACT).flat();
  function add(page, keys) {
    const asset = info(page, source, keys);
    if (!asset) return;
    const old = candidates.get(asset.title);
    candidates.set(asset.title, {
      ...asset,
      proposedKeys: [...new Set([...(old?.proposedKeys || []), ...keys])],
    });
  }
  const known = await query(source, { titles: titles.join("|") }, request);
  for (const page of known)
    add(
      page,
      Object.entries(EXACT)
        .filter(([, names]) => names.includes(page.title))
        .map(([key]) => key),
    );
  for (const [key, search] of SEARCHES) {
    await pause();
    const pages = await query(
      source,
      {
        generator: "search",
        gsrnamespace: "6",
        gsrsearch: search,
        gsrlimit: "8",
      },
      request,
    );
    for (const page of pages) add(page, [key]);
  }
  return {
    version: 1,
    source,
    discoveredAt: new Date().toISOString(),
    note: "Search results are candidates, not verified renderer layers. Inspect file pages/images before selecting frames. Empty results do not prove absence.",
    candidates: [...candidates.values()],
    selectionExample: { source, files: { "attribute.DARK": "File:DARK.svg" } },
  };
}
function rasterMime(buffer) {
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "jpg";
  if (
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP"
  )
    return "webp";
  return null;
}
async function rasterizeSvg(
  buffer,
  { executablePath = process.env.CHROMIUM_PATH } = {},
) {
  if (
    buffer.length > 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(buffer.toString("utf8"))
  )
    throw Error("SVG has a forbidden document type/entity or exceeds 1 MB.");
  const { chromium } = require("playwright");
  const browser = await chromium.launch({
    ...(executablePath
      ? { executablePath }
      : fs.existsSync("/usr/bin/chromium")
        ? { executablePath: "/usr/bin/chromium" }
        : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">",
    );
    const encoded = await page.evaluate(async (svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      if (
        doc.querySelector("parsererror") ||
        doc.documentElement.localName !== "svg" ||
        doc.documentElement.namespaceURI !== "http://www.w3.org/2000/svg"
      )
        throw Error("Invalid SVG image.");
      for (const node of doc.querySelectorAll("*")) {
        if (
          [
            "script",
            "foreignobject",
            "image",
            "iframe",
            "audio",
            "video",
            "animate",
            "animatetransform",
            "animatemotion",
            "set",
            "feimage",
          ].includes(node.localName.toLowerCase())
        )
          throw Error("SVG contains unsupported active/embedded content.");
        for (const attribute of node.attributes) {
          const value = attribute.value;
          if (
            /^on/i.test(attribute.name) ||
            (attribute.localName === "href" && !value.startsWith("#"))
          )
            throw Error("SVG contains an event handler or external reference.");
          if (
            /\\|@import|@font-face/i.test(value) ||
            [...value.matchAll(/url\(([^)]*)\)/gi)].some(
              (match) =>
                !match[1]
                  .trim()
                  .replace(/^['\"]|['\"]$/g, "")
                  .startsWith("#"),
            )
          )
            throw Error("Unsupported SVG style reference.");
        }
        if (
          node.localName === "style" &&
          (/\\|@import|@font-face/i.test(node.textContent) ||
            [...node.textContent.matchAll(/url\(([^)]*)\)/gi)].some(
              (match) =>
                !match[1]
                  .trim()
                  .replace(/^['\"]|['\"]$/g, "")
                  .startsWith("#"),
            ))
        )
          throw Error("Unsupported SVG stylesheet reference.");
      }
      const image = new Image();
      image.src =
        "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      await image.decode();
      const { naturalWidth: width, naturalHeight: height } = image;
      if (
        !width ||
        !height ||
        width > 4096 ||
        height > 4096 ||
        width * height > 16 * 1024 * 1024
      )
        throw Error("SVG dimensions exceed the rasterization budget.");
      const canvas = document.createElement("canvas");
      const scale = Math.min(
        4,
        4096 / width,
        4096 / height,
        Math.sqrt((16 * 1024 * 1024) / (width * height)),
      );
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png").split(",")[1];
    }, buffer.toString("utf8"));
    return Buffer.from(encoded, "base64");
  } finally {
    await browser.close();
  }
}
async function install({
  selection,
  assetRoot = path.join(__dirname, "assets"),
  request = requestBytes,
  convertSvg = rasterizeSvg,
  pause = () => new Promise((r) => setTimeout(r, 350)),
}) {
  const source = selection?.source;
  if (
    !Object.hasOwn(SOURCES, source) ||
    !selection.files ||
    typeof selection.files !== "object" ||
    Array.isArray(selection.files)
  )
    throw Error("Selection needs source and a files map.");
  const entries = Object.entries(selection.files);
  if (
    !entries.length ||
    entries.length > 40 ||
    entries.some(
      ([key, title]) =>
        !Object.hasOwn(EXAMPLE.files, key) ||
        key.startsWith("font.") ||
        typeof title !== "string" ||
        !title.startsWith("File:") ||
        title.length > 250 ||
        title.includes("|"),
    )
  )
    throw Error(
      "Select 1–40 known frame/icon keys with one wiki File: title per key. Fonts must be sourced separately.",
    );
  // Resolve selected titles afresh through the wiki, never trust a catalog-supplied download URL.
  const pages = await query(
    source,
    { titles: [...new Set(entries.map(([, title]) => title))].join("|") },
    request,
  );
  const selected = new Map(
    pages.map((page) => [page.title, info(page, source)]),
  );
  const root = fs.realpathSync(assetRoot),
    manifestFile = path.join(root, "manifest.json"),
    creditsFile = path.join(root, "wiki-attribution.json");
  const manifest = fs.existsSync(manifestFile)
    ? JSON.parse(fs.readFileSync(manifestFile, "utf8"))
    : structuredClone(EXAMPLE);
  const previous = fs.existsSync(creditsFile)
    ? JSON.parse(fs.readFileSync(creditsFile, "utf8"))
    : { version: 1, files: {} };
  const pending = [];
  for (const [key, title] of entries) {
    const candidate = selected.get(title);
    if (!candidate)
      throw Error(
        `Wiki file not found under the exact returned title: ${title}. Use a title from the discovery catalog.`,
      );
    if (
      !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(
        candidate.mime,
      )
    )
      throw Error(`Unsupported wiki file type for ${title}.`);
    await pause();
    const original = await request(candidate.originalUrl, source);
    let buffer = original,
      extension = rasterMime(original),
      converted = false;
    if (candidate.mime === "image/svg+xml") {
      buffer = await convertSvg(original);
      extension = rasterMime(buffer);
      converted = true;
    }
    if (!extension || buffer.length > 10 * 1024 * 1024)
      throw Error(`Downloaded file is not a supported raster image: ${title}.`);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const relative = `wiki-${sha256}.${extension}`;
    manifest.files[key] = relative;
    pending.push({
      key,
      buffer,
      relative,
      provenance: {
        source,
        title,
        sourceApi: SOURCES[source].api,
        ...candidate,
        originalSha256: crypto
          .createHash("sha256")
          .update(original)
          .digest("hex"),
        installedSha256: sha256,
        convertedFromSvg: converted,
        installedAt: new Date().toISOString(),
      },
    });
  }
  // Validate the completed manifest before replacing any active mapping.
  for (const item of pending) {
    const target = path.join(root, item.relative);
    if (fs.existsSync(target)) {
      if (!fs.readFileSync(target).equals(item.buffer))
        throw Error("Existing content-addressed asset has unexpected bytes.");
    } else fs.writeFileSync(target, item.buffer, { flag: "wx" });
  }
  loadAssets(root, manifest);
  for (const item of pending) previous.files[item.key] = item.provenance;
  fs.writeFileSync(creditsFile, JSON.stringify(previous, null, 2) + "\n");
  const temporary = path.join(
    root,
    ".manifest-" + crypto.randomUUID() + ".json",
  );
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n");
  fs.renameSync(temporary, manifestFile);
  return {
    installed: pending.map((item) => item.key),
    manifestFile,
    creditsFile,
  };
}
async function main() {
  const [command, ...args] = process.argv.slice(2),
    flags = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith("--") || !args[i + 1])
      throw Error("Expected --flag value.");
    flags[args[i].slice(2)] = args[i + 1];
  }
  if (command === "discover") {
    const catalog = await discover({ source: flags.source || "fandom" }),
      out = path.resolve(
        flags.out || path.join(__dirname, "data/wiki-assets/catalog.json"),
      );
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(catalog, null, 2) + "\n");
    console.log(
      `Discovered ${catalog.candidates.length} candidates. Catalog: ${out}`,
    );
  } else if (command === "install") {
    if (!flags.selection)
      throw Error("Provide --selection path/to/selection.json.");
    console.log(
      await install({
        selection: JSON.parse(fs.readFileSync(flags.selection, "utf8")),
        assetRoot: flags.assets ? path.resolve(flags.assets) : undefined,
      }),
    );
  } else
    throw Error(
      "Usage: node wiki-assets.cjs discover [--source fandom|yugipedia] [--out file] OR install --selection file [--assets directory]",
    );
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = {
  checkedUrl,
  query,
  discover,
  install,
  rasterizeSvg,
  rasterMime,
};
