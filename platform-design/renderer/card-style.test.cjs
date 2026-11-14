const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { loadAssets, renderCard } = require("./render.cjs");
const root = path.join(__dirname, "packs/ygocarder");
let browser, registry, artwork;
before(async () => {
  registry = loadAssets(
    root,
    JSON.parse(fs.readFileSync(path.join(root, "manifest.json"))),
  );
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e31b23";
    ctx.fillRect(0, 0, 1, 1);
    return c.toDataURL("image/png");
  });
  artwork = "https://example.test/reference-art.png";
  registry.artworks.set(artwork, data);
  await page.close();
});
after(async () => browser?.close());
const card = {
  name: "Reference Card",
  type: "Warrior / Effect",
  attribute: "DARK",
  level: 4,
  atk: "1800",
  def: "1200",
  effect: "A short card effect.",
};

test("every family uses the requested name colors, neutral gray artwork and common gold text borders", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  let grayReference, goldReference;
  const backgrounds = {};
  for (const frame of [
    "normal",
    "effect",
    "ritual",
    "fusion",
    "synchro",
    "xyz",
    "link",
    "spell",
    "trap",
  ])
    for (const pendulum of frame === "xyz" ? [false, true] : [false]) {
      const value = {
        ...card,
        artwork,
        type: ["spell", "trap"].includes(frame) ? `Normal ${frame}` : card.type,
        pendulumEffect: pendulum ? "Pendulum text." : "",
        visual: {
          frame,
          pendulum,
          rank: 4,
          scaleLeft: 2,
          scaleRight: 8,
          linkArrows: ["top"],
        },
        link: "LINK-1",
      };
      const { svg } = renderCard(value, registry);
      const result = await page.evaluate(
        async ({ svg, pendulum }) => {
          const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
          const image = new Image();
          image.src =
            "data:image/svg+xml;base64," +
            btoa(unescape(encodeURIComponent(svg)));
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 813;
          canvas.height = 1185;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
          return {
            color: doc
              .querySelector('[data-text-block="name"]')
              .getAttribute("fill"),
            gray: pixel(pendulum ? 46 : 90, 500),
            gold: pixel(42, 980),
            art: pixel(400, 400),
            background: pixel(300, 1085),
          };
        },
        { svg, pendulum },
      );
      assert.equal(
        result.color,
        ["spell", "trap", "xyz"].includes(frame) ? "#fff" : "#000",
        frame,
      );
      assert.ok(
        Math.max(...result.gray.slice(0, 3)) -
          Math.min(...result.gray.slice(0, 3)) <=
          1,
        frame + " artwork border must be neutral gray",
      );
      assert.ok(
        result.gold[0] > result.gold[1] && result.gold[1] > result.gold[2],
        frame + " effect border must be gold/bronze",
      );
      assert.deepEqual(
        result.art,
        [227, 27, 35, 255],
        "Border overlays must not hide artwork",
      );
      if (!pendulum) {
        if (!grayReference) grayReference = result.gray;
        if (!goldReference) goldReference = result.gold;
        assert.deepEqual(result.gray, grayReference, frame);
        assert.deepEqual(result.gold, goldReference, frame);
      }
      backgrounds[frame] = result.background;
    }
  assert.notDeepEqual(
    backgrounds.trap,
    backgrounds.spell,
    "Type-tinted text backgrounds remain distinct",
  );
});

test("the Torrential Tribute reference has taller readable text, and dense effects stay inside the box", async (t) => {
  const page = await browser.newPage({
    viewport: { width: 813, height: 1185 },
  });
  t.after(() => page.close());
  for (const effect of [
    "When a monster(s) is Summoned: Destroy all monsters on the field.",
    Array(5)
      .fill("When a monster(s) is Summoned: Destroy all monsters on the field.")
      .join(" "),
  ]) {
    const value = {
      name: "Torrential Tribute",
      type: "Normal Trap",
      effect,
      artwork,
    };
    const rendered = renderCard(value, registry);
    assert.equal(
      rendered.diagnostics.some((d) => d.startsWith("text-overflow")),
      false,
    );
    await page.setContent("<style>body{margin:0}</style>" + rendered.svg);
    await page.evaluate(() => document.fonts.ready);
    const measurements = await page.evaluate(() => {
      const title = document.querySelector('[data-text-block="name"]'),
        lines = [
          ...document.querySelectorAll('[data-text-block="effect"] text'),
        ];
      return {
        titleSize: Number(title.getAttribute("font-size")),
        titleBounds: title.getBBox().toJSON?.() || {
          width: title.getBBox().width,
        },
        lines: lines.map((t) => ({
          value: t.textContent,
          size: Number(t.getAttribute("font-size")),
          width: t.getComputedTextLength(),
          bottom: t.getBBox().y + t.getBBox().height,
        })),
      };
    });
    assert.equal(measurements.titleSize, 80);
    assert.ok(measurements.titleBounds.width <= 600.5);
    assert.ok(
      measurements.lines.every(
        (line) => line.width <= 685.5 && line.bottom <= 1104.5,
      ),
    );
    if (effect.length < 100) {
      assert.ok(measurements.lines.every((line) => line.size === 26));
      const ink = await page.evaluate(async () => {
        const original = document.querySelector("svg");
        const isolated = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        isolated.setAttribute("width", "813");
        isolated.setAttribute("height", "200");
        isolated.append(
          original.querySelector("style").cloneNode(true),
          original.querySelector('[data-text-block="name"]').cloneNode(true),
        );
        const image = new Image();
        image.src =
          "data:image/svg+xml;base64," +
          btoa(
            unescape(
              encodeURIComponent(
                new XMLSerializer().serializeToString(isolated),
              ),
            ),
          );
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 813;
        canvas.height = 200;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, 813, 200).data;
        let left = 813,
          right = 0,
          top = 200,
          bottom = 0;
        for (let y = 0; y < 200; y++)
          for (let x = 0; x < 813; x++)
            if (pixels[(y * 813 + x) * 4 + 3] > 20) {
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
        return { left, right, top, bottom };
      });
      assert.ok(
        ink.left >= 60 &&
          ink.right <= 670 &&
          ink.top >= 47 &&
          ink.bottom <= 138,
        "Actual name glyphs stay within the header",
      );
      assert.deepEqual(
        measurements.lines.map((l) => l.value),
        [
          "When a monster(s) is Summoned: Destroy all monsters",
          "on the field.",
        ],
      );
    }
  }
});
