"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { renderCard, loadAssets } = require("./render.cjs");
const SVG_CSP =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; sandbox";
function defaultAssetRoot(directory = __dirname) {
  const custom = path.join(directory, "assets");
  return fs.existsSync(path.join(custom, "manifest.json"))
    ? custom
    : path.join(directory, "packs/ygocarder");
}
function createRenderServer({
  assetRoot = defaultAssetRoot(),
  dataRoot = path.join(__dirname, "data"),
  maxCacheBytes = 256 * 1024 * 1024,
} = {}) {
  const manifestFile = path.join(assetRoot, "manifest.json");
  const manifest = JSON.parse(
    fs.readFileSync(
      fs.existsSync(manifestFile)
        ? manifestFile
        : path.join(__dirname, "assets/manifest.example.json"),
      "utf8",
    ),
  );
  const registry = loadAssets(assetRoot, manifest),
    cacheDir = path.join(dataRoot, "render-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  let cacheBytes = fs
    .readdirSync(cacheDir)
    .filter((f) => /^[a-f0-9]{64}\.svg$/.test(f))
    .reduce((n, f) => n + fs.statSync(path.join(cacheDir, f)).size, 0);
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
      "Cache-Control": "no-store",
    });
    res.end(
      typeof body === "string" || Buffer.isBuffer(body)
        ? body
        : JSON.stringify(body),
    );
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && ["/", "/gallery.js"].includes(req.url)) {
        return respond(
          res,
          200,
          fs.readFileSync(
            path.join(
              __dirname,
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
        return respond(
          res,
          200,
          fs.readFileSync(file),
          "image/svg+xml; charset=utf-8",
          SVG_CSP,
        );
      }
      if (req.method === "POST" && req.url === "/api/render") {
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}`
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
          rendered = renderCard(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
            registry,
          );
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
          if (cacheBytes + size > maxCacheBytes)
            return respond(res, 507, {
              error:
                "Render cache is full. Stop the renderer and clear data/render-cache.",
            });
          fs.writeFileSync(file, rendered.svg);
          cacheBytes += size;
        }
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
  return server;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("PORT must be 1–65535.");
  const server = createRenderServer();
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Local card renderer: http://127.0.0.1:${port}\nVisual proof of concept; bundled template credits are in packs/ygocarder/NOTICE.md.`,
    ),
  );
}
module.exports = { createRenderServer, defaultAssetRoot };
