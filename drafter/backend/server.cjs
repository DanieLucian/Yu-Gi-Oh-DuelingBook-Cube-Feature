"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gzip } = require("node:zlib");
const { promisify } = require("node:util");
const gzipAsync = promisify(gzip);
const {
  defaultAssetRoot,
  normalizeCard,
  renderCard,
  loadAssets,
  loadLocalLinkFont,
  loadLocalTypeFont,
  loadLocalStatsFont,
} = require("../renderer/render.cjs");
const { normalizeStyle } = require("../renderer/style-profile.cjs");
const { createArtworkCache } = require("../renderer/artwork-cache.cjs");
const { defaultDataRoot } = require("../renderer/data-root.cjs");
const { createRooms } = require("./rooms.cjs");
const { createCubeDatabase } = require("./cube-db.cjs");
const MockCube = require("../frontend/mock-cube.js");
const {
  testerRuntime,
  testerState,
  testerHtml,
} = require("../renderer/tester-build.cjs");
const rendererDirectory = path.join(__dirname, "..", "renderer");
const frontendDirectory = path.join(__dirname, "..", "frontend");
const { files: bundledAssetFiles } = require("../renderer/packs/manifest.json");
const cardIconFiles = new Map(Object.entries(bundledAssetFiles)
  .filter(([key]) => key.startsWith("attribute.") || key.startsWith("icon.")));
const SVG_CSP =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; sandbox";
function createRenderServer({
  assetRoot = defaultAssetRoot(),
  dataRoot = defaultDataRoot,
  maxCacheBytes = 256 * 1024 * 1024,
  fetchArtwork,
  publicOnly = false,
} = {}) {
  const manifestFile = path.join(assetRoot, "manifest.json");
  const manifest = JSON.parse(
    fs.readFileSync(
      fs.existsSync(manifestFile)
        ? manifestFile
        : path.join(rendererDirectory, "assets", "manifest.example.json"),
      "utf8",
    ),
  );
  const registry = loadLocalStatsFont(loadLocalTypeFont(loadLocalLinkFont(loadAssets(assetRoot, manifest), dataRoot), dataRoot), dataRoot),
    cacheDir = path.join(dataRoot, "render-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const ensureArtwork = createArtworkCache(registry, dataRoot, fetchArtwork);
  for (let i = 1; i <= MockCube.count; i++) registry.artworks.set(`/mock-art/${i}.svg`, `data:image/svg+xml;base64,${Buffer.from(MockCube.artwork(i)).toString("base64")}`);
  const handleRooms = createRooms(dataRoot);
  const handleCubes = createCubeDatabase(dataRoot);
  const styleFile = path.join(dataRoot, "render-style.json");
  const defaultStyleFile = path.join(rendererDirectory, "style.default.json");
  const projectStyle = normalizeStyle(
    fs.existsSync(defaultStyleFile)
      ? JSON.parse(fs.readFileSync(defaultStyleFile, "utf8"))
      : undefined,
  );
  let activeStyle = fs.existsSync(styleFile)
    ? normalizeStyle(JSON.parse(fs.readFileSync(styleFile, "utf8")))
    : projectStyle;
  let cacheBytes = fs
    .readdirSync(cacheDir)
    .filter((f) => /^[a-f0-9]{64}\.svg$/.test(f))
    .reduce((n, f) => n + fs.statSync(path.join(cacheDir, f)).size, 0);
  // These indexes hold only metadata and compressed bytes. Original SVGs remain
  // content-addressed on disk, so the card appearance and existing URLs stay put.
  const renderIndex = new Map(), compressed = new Map();
  let compressedBytes = 0, styleVersion = 0;
  const compressedLimit = 24 * 1024 * 1024;
  function rememberRender(key, value) {
    if (renderIndex.has(key)) renderIndex.delete(key);
    renderIndex.set(key, value);
    if (renderIndex.size > 2048) renderIndex.delete(renderIndex.keys().next().value);
  }
  async function compressedSvg(file) {
    const key = path.basename(file);
    if (compressed.has(key)) {
      const cached = compressed.get(key);
      compressed.delete(key); compressed.set(key, cached);
      return cached;
    }
    const original = fs.readFileSync(file);
    const bytes = await gzipAsync(original, { level: 6 });
    if (bytes.length < original.length && bytes.length <= compressedLimit) {
      compressed.set(key, bytes); compressedBytes += bytes.length;
      while (compressedBytes > compressedLimit) {
        const oldest = compressed.keys().next().value;
        compressedBytes -= compressed.get(oldest).length;
        compressed.delete(oldest);
      }
    }
    return bytes.length < original.length ? bytes : original;
  }
  function respond(
    res,
    status,
    body,
    type = "application/json; charset=utf-8",
    csp = "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  ) {
    res.writeHead(status, {
      "Content-Type": type,
      "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": type.startsWith("image/svg+xml")
        ? "private, max-age=31536000, immutable"
        : "no-store",
      ...(type.startsWith("image/svg+xml") ? { Vary: "Accept-Encoding" } : {}),
    });
    res.end(
      typeof body === "string" || Buffer.isBuffer(body)
        ? body
        : JSON.stringify(body),
    );
  }
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const cubeEditorPage = /^\/cube-editor\/[a-zA-Z0-9-]{1,100}$/.test(pathname);
      const cardIconKey = pathname.startsWith("/card-icons/") ? pathname.slice("/card-icons/".length) : "";
      const cardIconFile = cardIconFiles.get(cardIconKey);
      if (publicOnly) {
        if (req.method === "GET" && pathname === "/") {
          res.writeHead(302, { Location: "/draft", "Cache-Control": "no-store" });
          return res.end();
        }
        const allowed = cubeEditorPage || cardIconFile || ["/draft", "/room-client.js", "/cube-library.js", "/mock-cube.js", "/draft-renderer.js", "/api/draft-render", "/api/rooms"].includes(pathname)
          || /^\/api\/cubes(?:\/(?:import|[a-zA-Z0-9-]{1,100}(?:\/cards\/[^/]+)?))?$/.test(pathname)
          || /^\/api\/rooms\/[A-F0-9]{8}(?:\/(join|start|pick|deck|settings|cube|close|leave|add-bot|remove-player|end-session))?$/.test(pathname)
          || /^\/mock-art\/\d{1,3}\.svg$/.test(pathname)
          || /^\/renders\/[a-f0-9]{64}\.svg$/.test(pathname);
        if (!allowed) return respond(res, 404, { error: "Not found." });
      }
      if (req.method === "GET" && cardIconFile) {
        const source = registry.assets.get(cardIconKey);
        const [, mime, base64] = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(source ?? "") || [];
        if (mime) return respond(res, 200, Buffer.from(base64, "base64"), mime);
        const bundledIcon = fs.readFileSync(path.join(rendererDirectory, "packs", cardIconFile));
        return respond(res, 200, bundledIcon, "image/png");
      }
      const mockArt = /^\/mock-art\/(\d{1,3})\.svg$/.exec(pathname);
      if (req.method === "GET" && mockArt) {
        const number = Number(mockArt[1]);
        if (number < 1 || number > MockCube.count) return respond(res, 404, { error: "Artwork not found." });
        return respond(res, 200, MockCube.artwork(number), "image/svg+xml; charset=utf-8", SVG_CSP);
      }
      if (await handleRooms(req, res, respond)) return;
      if (await handleCubes(req, res, respond)) return;
      if (req.method === "GET" && (cubeEditorPage || ["/draft", "/draft-renderer.js", "/room-client.js", "/cube-library.js", "/mock-cube.js"].includes(pathname))) {
        const html = !pathname.endsWith(".js");
        let content = fs.readFileSync(path.join(frontendDirectory, html ? "index.html" : pathname.slice(1)), "utf8");
        if (html) {
          const roomVersion = createHash("sha256").update(fs.readFileSync(path.join(frontendDirectory, "room-client.js"))).digest("hex").slice(0, 12);
          content = content
            .replace('src="./mock-cube.js"', 'src="/mock-cube.js"')
            .replace("</body>", `<script src="/room-client.js?v=${roomVersion}"></script><script src="/cube-library.js"></script></body>`)
            .replace("<!-- DRAFT_RENDERER -->", '<script src="/draft-renderer.js"></script>')
            .replace("use the JSON artwork and available metadata.", "use locally rendered card images and available metadata.");
        }
        return respond(res, 200, content,
          html ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
          "default-src 'self'; connect-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      }
      if (req.method === "GET" && req.url === "/tester") {
        return respond(
          res,
          200,
          testerHtml(),
          "text/html; charset=utf-8",
          "default-src 'self'; connect-src 'self' blob:; img-src 'self' blob: data:; font-src data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        );
      }
      if (req.method === "GET" && req.url === "/tester-runtime.js")
        return respond(
          res,
          200,
          testerRuntime(),
          "text/javascript; charset=utf-8",
        );
      if (req.method === "GET" && req.url === "/api/tester-state")
        return respond(
          res,
          200,
          testerState(registry, activeStyle, projectStyle),
        );
      if (req.method === "GET" && req.url === "/api/style")
        return respond(res, 200, { style: activeStyle });
      if (req.method === "PUT" && req.url === "/api/style") {
        if (req.headers.origin !== `http://${req.headers.host}`)
          return respond(res, 403, {
            error: "Save styles from the local tester page.",
          });
        if (
          !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")
        )
          return respond(res, 415, { error: "Expected application/json." });
        let bytes = 0,
          chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes <= 8 * 1024 * 1024) chunks.push(chunk);
          else chunks = [];
        }
        if (bytes > 8 * 1024 * 1024)
          return respond(res, 413, { error: "Style profile limit: 8 MB." });
        let next;
        try {
          next = normalizeStyle(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
          );
        } catch (error) {
          return respond(res, 400, { error: error.message });
        }
        const temporary = styleFile + ".tmp";
        try {
          fs.writeFileSync(temporary, JSON.stringify(next, null, 2));
          fs.renameSync(temporary, styleFile);
        } finally {
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
        activeStyle = next;
        styleVersion++;
        renderIndex.clear();
        return respond(res, 200, { saved: true });
      }
      if (req.method === "GET" && ["/", "/gallery.js"].includes(req.url)) {
        return respond(
          res,
          200,
          fs.readFileSync(
            path.join(
              rendererDirectory,
              req.url === "/" ? "gallery.html" : "gallery.js",
            ),
          ),
          req.url === "/"
            ? "text/html; charset=utf-8"
            : "text/javascript; charset=utf-8",
        );
      }
      if (
        req.method === "GET" &&
        /^\/renders\/[a-f0-9]{64}\.svg$/.test(req.url)
      ) {
        const file = path.join(cacheDir, path.basename(req.url));
        if (!fs.existsSync(file))
          return respond(res, 404, { error: "Render not found." });
        if (/\bgzip\b/i.test(req.headers["accept-encoding"] || "")) {
          const bytes = await compressedSvg(file);
          if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
            res.writeHead(200, {
              "Content-Type": "image/svg+xml; charset=utf-8",
              "Content-Encoding": "gzip",
              "Content-Security-Policy": SVG_CSP,
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "private, max-age=31536000, immutable",
              "Vary": "Accept-Encoding",
            });
            return res.end(bytes);
          }
        }
        return respond(
          res,
          200,
          fs.readFileSync(file),
          "image/svg+xml; charset=utf-8",
          SVG_CSP,
        );
      }
      if (req.method === "POST" && ["/api/render", "/api/draft-render"].includes(req.url)) {
        if (
          req.headers.origin &&
          ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)
        )
          return respond(res, 403, { error: "Use the local renderer page." });
        if (
          !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")
        )
          return respond(res, 415, { error: "Expected application/json." });
        let bytes = 0,
          chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes <= 128 * 1024) chunks.push(chunk);
          else chunks = [];
        }
        if (bytes > 128 * 1024)
          return respond(res, 413, { error: "Card JSON limit: 128 KB." });
        let rendered;
        try {
          const card = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          // Validate before any network request. Gallery rendering remains local only.
          const model = normalizeCard(card);
          if (req.url === "/api/draft-render") await ensureArtwork(card.artwork);
          const key = createHash("sha256").update(JSON.stringify([styleVersion, model,
            registry.artworks.has(model.artwork)])).digest("hex");
          const known = renderIndex.get(key);
          if (known && fs.existsSync(path.join(cacheDir, known.hash + ".svg"))) {
            renderIndex.delete(key); renderIndex.set(key, known);
            return respond(res, 200, { url: "/renders/" + known.hash + ".svg",
              diagnostics: known.diagnostics, cacheHit: true });
          }
          rendered = renderCard(card, registry, activeStyle);
          rendered.indexKey = key;
        } catch {
          return respond(res, 400, {
            error:
              "Invalid card JSON or visual metadata. Check the renderer contract.",
          });
        }
        const file = path.join(cacheDir, rendered.hash + ".svg");
        const cacheHit = fs.existsSync(file);
        if (!cacheHit) {
          const size = Buffer.byteLength(rendered.svg);
          if (size > maxCacheBytes)
            return respond(res, 507, {
              error:
                "Render cache is full. Stop the renderer and clear data/render-cache.",
            });
          if (cacheBytes + size > maxCacheBytes) {
            // Only derived, content-addressed SVGs are eligible for eviction.
            const oldest = fs.readdirSync(cacheDir)
              .filter(name => /^[a-f0-9]{64}\.svg$/.test(name))
              .map(name => ({ name, stat: fs.statSync(path.join(cacheDir, name)) }))
              .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
            for (const entry of oldest) {
              if (cacheBytes + size <= maxCacheBytes * 0.9) break;
              fs.unlinkSync(path.join(cacheDir, entry.name));
              cacheBytes -= entry.stat.size;
            }
          }
          fs.writeFileSync(file, rendered.svg);
          cacheBytes += size;
        }
        rememberRender(rendered.indexKey, { hash: rendered.hash, diagnostics: rendered.diagnostics });
        return respond(res, 200, {
          url: "/renders/" + rendered.hash + ".svg",
          diagnostics: rendered.diagnostics,
          cacheHit,
        });
      }
      return respond(res, 404, { error: "Not found." });
    } catch (error) {
      console.error("Render request failed:", error.message);
      if (!res.headersSent)
        respond(res, 500, {
          error: "Renderer failed. Check the server console.",
        });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  let roomTimer;
  server.on("listening", () => { roomTimer = setInterval(handleRooms.tick, 250); roomTimer.unref(); });
  server.on("close", () => clearInterval(roomTimer));
  server.on("close", () => handleCubes.close());
  return server;
}
function startServer() {
  const port = Number(process.env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("PORT must be 1–65535.");
  const publicOnly = process.argv.includes("--public");
  const server = createRenderServer({
    assetRoot: process.env.ASSET_ROOT || defaultAssetRoot(),
    dataRoot: process.env.DATA_ROOT || defaultDataRoot,
    publicOnly,
  });
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () =>
    console.log(
      `Drafting platform: http://127.0.0.1:${port}/draft${publicOnly ? "\nPublic draft mode: administration routes disabled." : `\nRenderer gallery: http://127.0.0.1:${port}/\nTypography tester: http://127.0.0.1:${port}/tester`}`,
    ),
  );
}
if (require.main === module) startServer();
module.exports = { createRenderServer, defaultAssetRoot, startServer };
