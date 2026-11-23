"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { loadAssets, renderCard } = require("./render.cjs");
const { defaultAssetRoot } = require("./render.cjs");
const root = path.join(__dirname, "packs");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json")));
const registry = loadAssets(root, manifest);
const projectStyle = require("./style.default.json");
const frames = [
  "normal",
  "effect",
  "ritual",
  "fusion",
  "synchro",
  "xyz",
  "link",
  "spell",
  "trap",
];
const base = {
  name: "Reference Card",
  type: "Dragon / Effect",
  attribute: "DARK",
  level: 4,
  atk: "1800",
  def: "1200",
  link: "LINK-3",
  effect: "Main effect text.",
};
function card(frame, pendulum = false) {
  return {
    ...base,
    type: ["spell", "trap"].includes(frame) ? `Normal ${frame}` : base.type,
    pendulumEffect: pendulum ? "Pendulum effect text." : "",
    visual: {
      frame,
      pendulum,
      rank: 4,
      scaleLeft: 2,
      scaleRight: 8,
      linkArrows: ["top", "bottom-left", "bottom-right"],
    },
  };
}
const variants = frames.flatMap((frame) =>
  ["normal", "effect", "ritual", "fusion", "synchro", "xyz"].includes(frame)
    ? [card(frame), card(frame, true)]
    : [card(frame)],
);
let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
});
after(async () => browser?.close());

test("all ten uploaded frames retain their exact bytes, dimensions and recorded source", () => {
  const source = JSON.parse(
    fs.readFileSync(path.join(root, "predefined/provenance.json")),
  );
  assert.equal(source.source, "User-supplied ygo-renderer-card-frames.zip");
  assert.match(source.archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(source.filesUnmodified, true);
  const expected = [
    ...frames.map((frame) => `frame-${frame}.png`),
    "frame-pendulum-large.png",
  ].sort();
  assert.deepEqual(source.files.map((file) => file.file).sort(), expected);
  for (const file of source.files) {
    const bytes = fs.readFileSync(path.join(root, "predefined", file.file));
    assert.equal(bytes.length, file.bytes);
    assert.equal(
      crypto.createHash("sha256").update(bytes).digest("hex"),
      file.sha256,
    );
    assert.deepEqual(
      [bytes.readUInt32BE(16), bytes.readUInt32BE(20)],
      [549, 800],
    );
    assert.deepEqual(file.dimensions, [549, 800]);
  }
});

test("default frames use the uploaded images without reconstructed borders or duplicate stat labels", () => {
  assert.equal(defaultAssetRoot(), root);
  assert.equal(registry.profile, "predefined-813-v1");
  for (const value of variants) {
    const result = renderCard(value, registry);
    assert.deepEqual(result.diagnostics, [
      "missing-artwork: local source URL mapping required",
    ]);
    assert.ok(
      result.svg.includes(
        registry.assets.get(`background.${value.visual.frame}`),
      ),
    );
    assert.doesNotMatch(
      result.svg,
      /data-card-border|gray-art-border|common-card-frame|RENDER PREVIEW|Artwork unavailable locally/,
    );
    assert.doesNotMatch(result.svg, /ATK \/|DEF \/|LINK-/);
    assert.match(
      result.svg,
      /data-text-block="name"[^>]+filter="url\(#card-name-weight\)"/,
    );
    if (["spell", "trap"].includes(value.visual.frame))
      assert.doesNotMatch(result.svg, /data-text-block="(?:atk|def|link)"/);
    else {
      assert.match(result.svg, /data-text-block="atk"[^>]*>1800<\/text>/);
      assert.match(
        result.svg,
        value.visual.frame === "link"
          ? /data-text-block="link"[^>]*>3<\/text>/
          : /data-text-block="def"[^>]*>1200<\/text>/,
      );
    }
    if (value.visual.pendulum)
      assert.ok(result.svg.includes(registry.assets.get("overlay.pendulum")));
  }
  for (const link of ["3", "LINK-3", "Link / 3"])
    assert.match(
      renderCard({ ...card("link"), link }, registry).svg,
      /data-text-block="link"[^>]*>3<\/text>/,
    );
  const changed = loadAssets(root, manifest);
  changed.assets.set(
    "background.effect",
    registry.assets.get("background.normal"),
  );
  assert.notEqual(
    renderCard(card("effect"), registry).hash,
    renderCard(card("effect"), changed).hash,
  );
});

test("Chromium preserves supplied frame pixels, printed stat labels and transparent Pendulum headers", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  // These points cover the original outer/art/text borders, backgrounds and
  // baked stat labels, away from dynamic name, effect and numeric text slots.
  const points = [
    [0, 0],
    [25, 100],
    [31, 80],
    [58, 300],
    [32, 675],
    [150, 710],
    [300, 738],
    [420, 738],
    [275, 300],
  ];
  for (const value of variants) {
    const rendered = renderCard(value, registry);
    const result = await page.evaluate(
      async ({ svg, background, overlay, points }) => {
        async function image(src) {
          const img = new Image();
          img.src = src;
          await img.decode();
          return img;
        }
        function canvas() {
          const c = document.createElement("canvas");
          c.width = 549;
          c.height = 800;
          return c.getContext("2d");
        }
        const actual = canvas(),
          expected = canvas();
        actual.drawImage(
          await image(
            "data:image/svg+xml;base64," +
              btoa(unescape(encodeURIComponent(svg))),
          ),
          0,
          0,
          549,
          800,
        );
        expected.drawImage(await image(background), 0, 0);
        const basePixels = expected.getImageData(0, 0, 549, 800).data;
        const renderedPixels = actual.getImageData(0, 0, 549, 800).data;
        let borderDifferences = 0;
        for (let y = 0; y < 800; y++)
          for (let x = 0; x < 549; x++) {
            if (x >= 19 && x < 530 && y >= 19 && y < 781) continue;
            const offset = (y * 549 + x) * 4;
            for (let channel = 0; channel < 4; channel++)
              if (Math.abs(basePixels[offset + channel] - renderedPixels[offset + channel]) > 1)
                borderDifferences++;
          }
        if (overlay) expected.drawImage(await image(overlay), 0, 0);
        const pixel = (ctx, [x, y]) => [...ctx.getImageData(x, y, 1, 1).data];
        return {
          borderDifferences,
          samples: points.map((point) => ({
            point,
            actual: pixel(actual, point),
            expected: pixel(expected, point),
          })),
        };
      },
      {
        svg: rendered.svg,
        background: registry.assets.get(`background.${value.visual.frame}`),
        overlay: value.visual.pendulum
          ? registry.assets.get("overlay.pendulum")
          : null,
        points,
      },
    );
    assert.equal(result.borderDifferences, 0, `${value.visual.frame} outer border`);
    for (const sample of result.samples)
      assert.ok(
        sample.actual.every(
          (channel, i) => Math.abs(channel - sample.expected[i]) <= 1,
        ),
        `${value.visual.frame} pendulum=${value.visual.pendulum}: ${JSON.stringify(sample)}`,
      );
    await page.setContent(rendered.svg);
    await page.evaluate(() => document.fonts.ready);
    const overlays = await page.evaluate(() => {
      const nameColor = document.querySelector("#card-name-weight feFlood");
      const blocks = [
        ...document.querySelectorAll(
          '[data-text-block="effect"], [data-text-block="pendulum"]',
        ),
      ];
      return {
        color: getComputedStyle(nameColor).floodColor,
        effects: blocks.map((g) => ({
          color: getComputedStyle(g).fill,
          lines: [...g.querySelectorAll("text")].map((t) => ({
            top: t.getBBox().y,
            bottom: t.getBBox().y + t.getBBox().height,
            right: t.getBBox().x + t.getBBox().width,
          })),
          kind: g.dataset.textBlock,
        })),
      };
    });
    assert.equal(
      overlays.color,
      ["spell", "trap", "xyz", "link"].includes(value.visual.frame)
        ? "rgb(255, 255, 255)"
        : "rgb(0, 0, 0)",
    );
    for (const block of overlays.effects) {
      assert.equal(block.color, "rgb(0, 0, 0)");
      for (const line of block.lines) {
        assert.ok(line.right <= 750.5);
        assert.ok(
          line.bottom <=
            (block.kind === "pendulum"
              ? 905
              : ["spell", "trap"].includes(value.visual.frame)
                ? 1104
                : 1070),
        );
        if (value.visual.pendulum && block.kind === "effect")
          assert.ok(line.top >= 963);
      }
    }
  }
});

test("Spell/Trap subtype icons stay inside artwork-aligned closing brackets", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const changed = structuredClone(projectStyle);
  Object.assign(changed.regions.kind, {
    size: 32, letterSpacing: 0.3, offsetX: 5, offsetY: 6,
  });
  for (const style of [projectStyle, changed]) {
    for (const [frame, icons] of [
      ["spell", ["normal", "continuous", "quick-play", "equip", "field", "ritual", null]],
      ["trap", ["normal", "continuous", "counter", null]],
    ]) {
      for (const icon of icons) {
        const value = {
          ...card(frame),
          type: `[ ${frame.toUpperCase()} CARD ]`,
          visual: { frame, ...(icon ? { spellTrapIcon: icon } : {}) },
        };
        await page.setContent(
          '<style>body{margin:0}</style>' + renderCard(value, registry, style).svg,
        );
        await page.evaluate(() => document.fonts.ready);
        const header = await page.evaluate(() => {
          const group = document.querySelector('[data-text-block="kind"]');
          const rect = (selector) => {
            const node = group.querySelector(selector);
            if (!node) return null;
            const box = node.getBoundingClientRect();
            return { left: box.left, right: box.right };
          };
          const close = group.querySelector('[data-kind-part="close"]');
          return {
            label: rect('[data-kind-part="label"]'),
            icon: rect('[data-kind-icon]'),
            close: rect('[data-kind-part="close"]'),
            bracket: close.textContent,
            anchor: Number(close.getAttribute("x")),
            baseline: Number(close.getAttribute("y")),
          };
        });
        const right = 491 * 813 / 549 + style.regions.kind.offsetX;
        assert.equal(header.bracket, "]");
        assert.ok(Math.abs(header.anchor - right) < 0.01);
        // Bold glyph overhangs may extend up to two canvas pixels past the anchor.
        assert.ok(Math.abs(header.close.right - right) < 2);
        assert.equal(header.baseline, 185 + style.regions.kind.offsetY);
        if (icon === "normal") {
          assert.equal(header.icon, null);
          assert.ok(header.close.left - header.label.right < style.regions.kind.size);
        } else {
          assert.ok(header.icon, `${frame}, ${icon}`);
          assert.ok(header.label.right < header.icon.left, `${frame}, ${icon}: label before icon`);
          assert.ok(header.icon.right < header.close.left, `${frame}, ${icon}: icon before bracket`);
        }
      }
    }
  }
});

test("Pendulum and regular Level/Rank rows share their respective artwork edge", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  for (const [frame, pendulum] of [
    ["normal", false], ["normal", true], ["xyz", false], ["xyz", true],
  ]) {
    for (const [level, size, gap] of [
      [1, 50, 4],
      [12, 50, 4],
      [7, 32, 10],
    ]) {
      const value = { ...card(frame, pendulum), level };
      value.visual.rank = level;
      const style = { ...projectStyle, stars: { size, gap } };
      await page.setContent(renderCard(value, registry, style).svg);
      const edges = await page.evaluate(() => {
        const stars = document.querySelectorAll("[data-star-index]");
        const box = stars[stars.length - 1].getBBox();
        return { left: stars[0].getBBox().x, right: box.x + box.width };
      });
      // Rank rows share the regular Xyz left edge, including Xyz Pendulum.
      const actual = frame === "xyz" ? edges.left : edges.right;
      const expected = frame === "xyz" ? 58 : 491;
      assert.ok(Math.abs((actual * 549) / 813 - expected) < 0.01);
    }
  }
});

test("name colors preserve pixel coverage and bundled weights increase progressively", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const styles = [
    projectStyle,
    ...[
      { edgeOpacity: 0.45 },
      { font: "body" },
      ...[100, 200, 300, 500, 600, 700, 800, 900].map(weight => ({ weight })),
    ].map((name) => ({
      ...projectStyle,
      regions: {
        ...projectStyle.regions,
        name: { ...projectStyle.regions.name, ...name },
      },
    })),
  ];
  const weightSamples = new Map();
  for (const style of styles) {
    for (const name of ["Reference Card", "A Much Longer Reference Card Name"]) {
      const svgs = frames.map(
        (frame) => renderCard({ ...card(frame), name }, registry, style).svg,
      );
      const results = await page.evaluate(async (svgs) => {
        const comparisons = [];
        for (const width of [813, 300]) {
          let reference;
          for (const svg of svgs) {
            const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
            const isolated = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "svg",
            );
            isolated.setAttribute("viewBox", "0 0 813 200");
            isolated.setAttribute("width", width);
            isolated.setAttribute("height", (200 * width) / 813);
            isolated.append(
              doc.querySelector("style").cloneNode(true),
              doc.querySelector("#card-name-weight").cloneNode(true),
              doc.querySelector('[data-text-block="name"]').cloneNode(true),
            );
            const img = new Image();
            img.src =
              "data:image/svg+xml;base64," +
              btoa(unescape(encodeURIComponent(
                new XMLSerializer().serializeToString(isolated),
              )));
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = Math.ceil((200 * width) / 813);
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            reference ??= pixels;
            let differences = 0,
              ink = 0,
              color;
            for (let i = 3; i < pixels.length; i += 4) {
              if (pixels[i] !== reference[i]) differences++;
              ink += pixels[i];
              if (pixels[i] > 0) color = [...pixels.slice(i - 3, i)];
            }
            comparisons.push({ width, differences, ink, color });
          }
        }
        return comparisons;
      }, svgs);
      for (const [i, result] of results.entries()) {
        const frame = frames[i % frames.length];
        assert.equal(
          result.differences,
          0,
          `${frame}, ${name}, width=${result.width}`,
        );
        assert.ok(result.ink > 0, "Names remain visible");
        const channel = ["spell", "trap", "xyz", "link"].includes(frame) ? 255 : 0;
        assert.deepEqual(result.color, [channel, channel, channel], frame);
        if (frame === "normal" && style.regions.name.font === "name" &&
            style.regions.name.edgeOpacity === projectStyle.regions.name.edgeOpacity) {
          const key = `${name}, width=${result.width}`;
          if (!weightSamples.has(key)) weightSamples.set(key, new Map());
          weightSamples.get(key).set(style.regions.name.weight, result.ink);
        }
      }
    }
  }
  for (const [description, samples] of weightSamples) {
    assert.equal(samples.size, 9);
    let previous = 0;
    for (const [weight, ink] of [...samples].sort((a, b) => a[0] - b[0])) {
      assert.ok(ink > previous * 1.015, `${description}, weight=${weight}`);
      previous = ink;
    }
  }
});

test("bundled Stone Serif weights visibly change each card text area", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const cases = [
    ["type", card("effect")],
    ["effect", card("effect")],
    ["pendulum", card("effect", true)],
    ["kind", card("spell")],
    ["stats", card("effect")],
  ];
  for (const [region, value] of cases) {
    const weights = [];
    for (const weight of [100, 400, 700, 900]) {
      const style = structuredClone(projectStyle);
      style.regions[region].weight = weight;
      const svg = renderCard(value, registry, style).svg;
      const ink = await page.evaluate(async ({ svg, region }) => {
        const source = new DOMParser().parseFromString(svg, "image/svg+xml");
        const isolated = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        isolated.setAttribute("width", "813");
        isolated.setAttribute("height", "1185");
        isolated.append(source.querySelector("style").cloneNode(true));
        const filter = source.querySelector(`#card-${region}-weight`);
        if (filter) isolated.append(filter.cloneNode(true));
        const selector = region === "stats" ? '[data-text-block="atk"]' :
          `[data-text-block="${region}"]`;
        isolated.append(source.querySelector(selector).cloneNode(true));
        const img = new Image();
        img.src = "data:image/svg+xml;base64," +
          btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(isolated))));
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 813;
        canvas.height = 1185;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, 813, 1185).data;
        let total = 0;
        for (let i = 3; i < pixels.length; i += 4) total += pixels[i];
        return total;
      }, { svg, region });
      weights.push(ink);
    }
    for (let i = 1; i < weights.length; i++)
      assert.ok(weights[i] > weights[i - 1] * 1.02,
        `${region}: ${weights.join(", ")}`);
  }
});

test("fitting Pendulum artwork is not stretched behind the effect boxes", async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const colored = loadAssets(root, manifest);
  const artwork = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 472; canvas.height = 352;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e31b23"; ctx.fillRect(0, 0, 472, 352);
    return canvas.toDataURL();
  });
  colored.artworks.set("fitting-art", artwork);
  const value = card("effect", true);
  const empty = renderCard(value, registry).svg;
  const full = renderCard({ ...value, artwork: "fitting-art" }, colored).svg;
  const pixels = await page.evaluate(async ({ empty, full }) => {
    const results = [];
    for (const svg of [empty, full]) {
      const image = new Image();
      image.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 549; canvas.height = 800;
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0, 549, 800);
      results.push([590, 700].map(y => [...ctx.getImageData(400, y, 1, 1).data]));
    }
    return results;
  }, { empty, full });
  for (let box = 0; box < 2; box++)
    for (let channel = 0; channel < 4; channel++)
      assert.ok(Math.abs(pixels[1][box][channel] - pixels[0][box][channel]) <= 1,
        "Fitting art does not continue under either effect box");
});

test("local artwork fills the aperture while preserving Link sockets and Pendulum corner hardware", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const colored = loadAssets(root, manifest);
  const artwork = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 5;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e31b23";
    ctx.fillRect(0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  });
  colored.artworks.set("local-test-art", artwork);
  for (const value of [card("effect"), card("link"), card("effect", true)]) {
    const empty = renderCard(value, registry),
      full = renderCard({ ...value, artwork: "local-test-art" }, colored);
    assert.deepEqual(full.diagnostics, []);
    const comparison = await page.evaluate(
      async ({ empty, full, pendulum }) => {
        async function draw(svg) {
          const img = new Image();
          img.src =
            "data:image/svg+xml;base64," +
            btoa(unescape(encodeURIComponent(svg)));
          await img.decode();
          const c = document.createElement("canvas");
          c.width = 549;
          c.height = 800;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, 549, 800);
          return ctx;
        }
        const a = await draw(empty),
          b = await draw(full),
          pixel = (ctx, x, y) => [...ctx.getImageData(x, y, 1, 1).data];
        const protectedPoints = pendulum
          ? [
              [37, 490],
              [40, 497],
              [509, 497],
              [56, 543],
              [493, 543],
            ]
          : [
              [59, 140],
              [490, 140],
              [59, 570],
              [490, 570],
              [58, 300],
              [274, 133],
            ];
        return {
          art: pixel(b, 275, 300),
          translucent: pendulum ? [[400, 590], [400, 700]].map(point => ({
            before: pixel(a, ...point), after: pixel(b, ...point),
          })) : [],
          protected: protectedPoints.map(([x, y]) => ({
            point: [x, y],
            before: pixel(a, x, y),
            after: pixel(b, x, y),
          })),
        };
      },
      { empty: empty.svg, full: full.svg, pendulum: value.visual.pendulum },
    );
    assert.deepEqual(comparison.art, [227, 27, 35, 255]);
    for (const sample of comparison.translucent)
      for (let channel = 0; channel < 3; channel++)
        assert.ok(Math.abs(sample.after[channel] - (0.9 * sample.before[channel] + 0.1 * [227, 27, 35][channel])) <= 2,
          `Pendulum effect backgrounds reveal exactly 10% artwork: ${JSON.stringify(sample)}`);
    for (const sample of comparison.protected)
      assert.deepEqual(
        sample.after,
        sample.before,
        `${value.visual.frame}: ${sample.point}`,
      );
    if (value.visual.frame === "link") {
      assert.match(full.svg, /data-link-arrow="top"/);
      assert.doesNotMatch(full.svg, /data-link-arrow="right"/);
    }
  }
});

test("portrait, square and wide Pendulum art cover every aperture edge without letterboxing", async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  for (const [width, height] of [[272, 347], [400, 400], [472, 352], [800, 300]]) {
    const artwork = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#e31b23"; ctx.fillRect(0, 0, width, height);
      return canvas.toDataURL();
    }, { width, height });
    const colored = loadAssets(root, manifest); colored.artworks.set("edge-test", artwork);
    const svg = renderCard({ ...card("ritual", true), artwork: "edge-test" }, colored).svg;
    const samples = await page.evaluate(async svg => {
      const img = new Image(); img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))); await img.decode();
      const canvas = document.createElement("canvas"); canvas.width = 549; canvas.height = 800;
      const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, 549, 800);
      return [[39, 146], [509, 146], [39, 480], [509, 480], [275, 300]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    }, svg);
    for (const sample of samples) assert.deepEqual(sample, [227, 27, 35, 255], `${width}x${height} artwork fills all edges`);
    assert.match(svg, /preserveAspectRatio="xMidYMin slice" data-card-artwork="true"/);
    assert.match(svg, /font-size="62" data-pendulum-scale="left"/);
    assert.match(svg, /font-size="62" data-pendulum-scale="right"/);
  }
});

test("active Link fills cover all eight socket interiors and preserve the gray outlines", async t => {
  const page = await browser.newPage(); t.after(() => page.close());
  const value = card("link"), directions = ["top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left", "top-left"];
  const off = renderCard({ ...value, visual: { ...value.visual, linkArrows: [] } }, registry).svg;
  const on = renderCard({ ...value, visual: { ...value.visual, linkArrows: directions } }, registry).svg;
  const results = await page.evaluate(async ({ off, on }) => {
    const draw = async svg => {
      const img = new Image(); img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))); await img.decode();
      const canvas = document.createElement("canvas"); canvas.width = 549; canvas.height = 800;
      const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, 549, 800); return ctx.getImageData(0, 0, 549, 800).data;
    };
    const before = await draw(off), after = await draw(on);
    const rgb = (pixels, x, y) => [...pixels.slice((y * 549 + x) * 4, (y * 549 + x) * 4 + 3)];
    return [[274,137],[485,142],[495,355],[486,566],[274,578],[62,566],[53,355],[62,142]].map(([sx, sy]) => {
      const queue = [[sx, sy]], seen = new Set(); let painted = 0;
      while (queue.length) {
        const [x, y] = queue.pop(), key = y * 549 + x;
        if (seen.has(key) || x < 0 || y < 0 || x >= 549 || y >= 800 || Math.max(...rgb(before, x, y)) >= 65) continue;
        seen.add(key);
        const [r,g,b] = rgb(after, x, y); if (r > 120 && r > g * 1.8 && r > b * 1.8) painted++;
        queue.push([x-1,y],[x+1,y],[x,y-1],[x,y+1]);
      }
      let gray = 0, unchanged = 0;
      for (let y = sy-35; y <= sy+35; y++) for (let x = sx-35; x <= sx+35; x++) {
        const a = rgb(before,x,y), b = rgb(after,x,y);
        if (Math.max(...a) - Math.min(...a) < 35 && Math.min(...a) > 105 && Math.max(...a) < 220) {
          gray++; if (a.every((v,i) => Math.abs(v-b[i]) <= 6)) unchanged++;
        }
      }
      return { pixels: seen.size, coverage: painted / seen.size, grayPixels: gray, grayPreserved: unchanged / gray };
    });
  }, { off, on });
  for (const [i, result] of results.entries()) {
    assert.ok(result.pixels > 400);
    assert.ok(result.coverage >= .97, `${directions[i]}: red covers socket uniformly ${JSON.stringify(result)}`);
    assert.ok(result.grayPreserved >= .97, `${directions[i]}: outline preserved ${JSON.stringify(result)}`);
  }
});
