"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { loadAssets } = require("./render.cjs");
const { normalizeStyle } = require("./style-profile.cjs");
function testerRuntime() {
  const modules = [
    "./style-profile.cjs",
    "./text-layout-core.cjs",
    "./card-svg.cjs",
  ]
    .map(
      (id) =>
        `${JSON.stringify(id)}:function(module,exports,require){\n${fs.readFileSync(path.join(__dirname, id), "utf8")}\n}`,
    )
    .join(",\n");
  return `(()=>{const factories={${modules}},cache={};function require(id){if(!factories[id])throw Error('Unknown tester module');if(!cache[id]){const module={exports:{}};cache[id]=module;factories[id](module,module.exports,require);}return cache[id].exports;}window.CardRenderer=require('./card-svg.cjs');window.CardStyles=require('./style-profile.cjs');})();\n${fs.readFileSync(path.join(__dirname, "tester.js"), "utf8")}`;
}
function testerState(registry, style) {
  const keys = new Map([...registry.assets].map(([key, data]) => [data, key]));
  return {
    style: normalizeStyle(style),
    credits: ["predefined", "ygocarder"].map((pack) => ({
      name: pack,
      notice: fs.readFileSync(
        path.join(__dirname, "packs", pack, "NOTICE.md"),
        "utf8",
      ),
      provenance: JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "packs", pack, "provenance.json"),
          "utf8",
        ),
      ),
    })),
    registry: {
      profile: registry.profile,
      assets: [...registry.assets],
      artworks: [...registry.artworks],
      fontMetrics: registry.fontMetrics,
      sizes: [...registry.assets]
        .filter(([, data]) => registry.imageSizes?.has(data))
        .map(([key, data]) => [key, registry.imageSizes.get(data)]),
      artworkSizes: [...registry.artworks]
        .filter(([, data]) => registry.imageSizes?.has(data))
        .map(([key, data]) => [key, registry.imageSizes.get(data)]),
      composites: [...registry.composites].map(([key, composite]) => [
        key,
        {
          ...composite,
          layers: composite.layers.map(({ data, ...layer }) => ({
            ...layer,
            key: keys.get(data),
          })),
        },
      ]),
    },
  };
}
function testerHtml(state) {
  const template = fs.readFileSync(path.join(__dirname, "tester.html"), "utf8");
  return state
    ? template
        .replace(
          "<!-- TESTER_DATA -->",
          `<script id="tester-data" type="application/json">${JSON.stringify(state).replace(/</g, "\\u003c")}</script>`,
        )
        .replace(
          "<!-- TESTER_RUNTIME -->",
          `<script>${testerRuntime().replace(/<\/script/gi, "<\\/script")}</script>`,
        )
    : template.replace(
        "<!-- TESTER_RUNTIME -->",
        '<script src="/tester-runtime.js" defer></script>',
      );
}
module.exports = { testerRuntime, testerState, testerHtml };
if (require.main === module) {
  const { defaultAssetRoot } = require("./server.cjs");
  const root = defaultAssetRoot(),
    registry = loadAssets(
      root,
      JSON.parse(fs.readFileSync(path.join(root, "manifest.json"))),
    );
  const profileFile =
    process.argv[3] || path.join(__dirname, "style.default.json");
  const profile = fs.existsSync(profileFile)
    ? JSON.parse(fs.readFileSync(profileFile, "utf8"))
    : undefined;
  const out = path.resolve(
    process.argv[2] || path.join(__dirname, "card-render-tester.html"),
  );
  fs.writeFileSync(out, testerHtml(testerState(registry, profile)));
  console.log(`Card render tester: ${out}`);
}
