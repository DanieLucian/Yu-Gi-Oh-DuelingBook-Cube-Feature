const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeCard, loadAssets, renderCard } = require("./render.cjs");
const blank = () => ({ assets: new Map(), artworks: new Map() });
const monster = {
  id: "42",
  name: "Test Monster",
  origin: "custom",
  type: "Warrior / Effect",
  attribute: "DARK",
  level: 4,
  atk: "0",
  def: "?",
  effect: "An effect.",
  artwork: "https://www.duelingbook.com/custom-pics/0/42.jpg",
  copies: 2,
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=",
  "base64",
);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cube-assets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("legacy JSON remains unchanged; frame URLs distinguish Normal from Effect and Extra Deck types", () => {
  const card = {
    ...monster,
    type: "Warrior",
    frame: "https://www.duelingbook.com/images/card/normal_front2.webp?x=1",
    notes: { keep: true },
  };
  const original = structuredClone(card);
  assert.equal(normalizeCard(card).frame, "normal");
  assert.equal(
    normalizeCard({
      ...card,
      frame: "https://www.duelingbook.com/images/card/fusion_front.webp",
    }).frame,
    "fusion",
  );
  assert.deepEqual(card, original);
  assert.equal(
    normalizeCard({ ...monster, type: "Spellcaster / Effect" }).frame,
    "effect",
    "Spellcaster is a monster type",
  );
  assert.equal(
    normalizeCard({
      ...monster,
      type: "[ SPELL CARD ]",
      frame: "",
      level: null,
    }).frame,
    "spell",
  );
  assert.equal(
    normalizeCard({ ...monster, type: "Normal Spell" }).frame,
    "spell",
    "Normal Spell must not become a Normal Monster",
  );
});

test("Normal, Effect, Ritual, Fusion, Synchro use level stars; Xyz uses rank and Link omits DEF and stars", () => {
  for (const frame of ["normal", "effect", "ritual", "fusion", "synchro"]) {
    const result = renderCard({ ...monster, visual: { frame } }, blank());
    assert.equal((result.svg.match(/data-star="level"/g) || []).length, 4);
    assert.match(result.svg, /ATK \/ 0/);
    assert.match(result.svg, /DEF \/ \?/);
    assert.equal(result.model.frame, frame);
  }
  const xyz = renderCard(
    { ...monster, type: "Warrior / Xyz / Effect", visual: { rank: 7 } },
    blank(),
  );
  assert.equal((xyz.svg.match(/data-star="rank"/g) || []).length, 7);
  assert.equal(
    xyz.diagnostics.some((x) => x.startsWith("rank-from-legacy")),
    false,
  );
  const legacy = renderCard(
    { ...monster, type: "Dragon / Xyz / Effect" },
    blank(),
  );
  assert.ok(legacy.diagnostics.some((x) => x.startsWith("rank-from-legacy")));
  const link = renderCard(
    {
      ...monster,
      type: "Cyberse / Link / Effect",
      link: "LINK-3",
      visual: { linkArrows: ["top", "bottom-left", "bottom-right"] },
    },
    blank(),
  );
  assert.match(link.svg, /LINK-3/);
  assert.doesNotMatch(link.svg, /data-star=|DEF \/|LEVEL/);
  assert.equal((link.svg.match(/<path /g) || []).length, 3);
});

test("Spell/Trap subtype icons, Pendulum variants/scales and missing metadata are handled explicitly", () => {
  for (const [type, icon] of [
    ["Normal Spell", "normal"],
    ["Quick-Play Spell", "quick-play"],
    ["Continuous Spell", "continuous"],
    ["Equip Spell", "equip"],
    ["Field Spell", "field"],
    ["Ritual Spell", "ritual"],
    ["Normal Trap", "normal"],
    ["Counter Trap", "counter"],
  ]) {
    const result = renderCard(
      { ...monster, type, frame: "", visual: {} },
      blank(),
    );
    assert.equal(result.model.icon, icon);
    assert.doesNotMatch(result.svg, /data-star=|ATK \/|DEF \/|attribute\.DARK/);
    assert.equal(
      result.diagnostics.includes("spell-trap-icon-unresolved"),
      false,
    );
  }
  const pendulum = renderCard(
    {
      ...monster,
      type: "Dragon / Fusion / Pendulum / Effect",
      pendulumEffect: "Separate pendulum & text",
      visual: { scaleLeft: 0, scaleRight: 8 },
    },
    blank(),
  );
  assert.equal(pendulum.model.frame, "fusion");
  assert.equal(pendulum.model.scaleLeft, 0);
  assert.ok(
    pendulum.diagnostics.includes("missing-asset:background.fusion-pendulum"),
  );
  assert.match(pendulum.svg, /Separate pendulum &amp; text/);
  const missing = renderCard(
    {
      ...monster,
      type: "Unknown custom",
      attribute: "",
      level: null,
      pendulumEffect: "Pendulum text",
    },
    blank(),
  );
  for (const warning of [
    "frame-unresolved",
    "attribute-unresolved",
    "level-rank-unresolved",
    "pendulum-scales-unresolved",
  ])
    assert.ok(missing.diagnostics.includes(warning));
  assert.ok(
    renderCard(
      { ...monster, type: "[ TRAP CARD ]" },
      blank(),
    ).diagnostics.includes("spell-trap-icon-unresolved"),
  );
  assert.ok(
    renderCard({ ...monster, type: "Link" }, blank()).diagnostics.includes(
      "link-arrows-unresolved",
    ),
  );
});

test("SVG escapes hostile text, rejects invalid XML text, retains overflowing effects and supports custom high counts", () => {
  const result = renderCard(
    {
      ...monster,
      name: '<script>alert("x")</script> & name',
      effect: "😀 ".repeat(1000),
      level: 99,
    },
    blank(),
  );
  assert.doesNotMatch(result.svg, /<script>/);
  assert.match(result.svg, /&lt;script&gt;/);
  assert.match(result.svg, /LEVEL 99/);
  assert.ok(result.diagnostics.some((d) => d.startsWith("text-overflow")));
  assert.match(result.svg, /<desc>.*😀/s);
  for (const extra of [
    { name: "bad\u0000text" },
    { name: "bad\ud800text" },
    { visual: { frame: "evil" } },
    { visual: { pendulum: "yes" } },
    { visual: { linkArrows: ["top", "top"] } },
    { level: 100 },
    { effect: { bad: 1 } },
  ])
    assert.throws(() => renderCard({ ...monster, ...extra }, blank()));
});

test("server assets embed locally, repeated stars share data and cache identity reflects visual content", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "pixel.png"), png);
  const manifest = {
    version: 1,
    files: {
      border: "pixel.png",
      "background.effect": "pixel.png",
      "attribute.DARK": "pixel.png",
      "icon.level": "pixel.png",
    },
    artworks: { [monster.artwork]: "pixel.png" },
  };
  const registry = loadAssets(root, manifest),
    first = renderCard(monster, registry);
  assert.match(first.svg, /data:image\/png;base64,/);
  assert.doesNotMatch(first.svg, /<image[^>]+href="https?:/);
  assert.equal((first.svg.match(/<use href="#star"/g) || []).length, 4);
  assert.equal(
    first.diagnostics.some((d) => d.startsWith("missing-artwork")),
    false,
  );
  assert.equal(
    renderCard({ ...monster, copies: 99, section: "side" }, registry).hash,
    first.hash,
    "Nonvisual card annotations reuse render",
  );
  assert.notEqual(
    renderCard({ ...monster, name: "Changed name" }, registry).hash,
    first.hash,
  );
  registry.assets.set(
    "background.effect",
    registry.assets.get("background.effect") + "changed",
  );
  assert.notEqual(
    renderCard(monster, registry).hash,
    first.hash,
    "Asset content changes invalidate cached image",
  );
});

test("asset manifest rejects remote paths, directory escapes, symlink escapes and active SVG files", (t) => {
  const root = fixture(t),
    outside = fixture(t);
  fs.writeFileSync(path.join(outside, "pixel.png"), png);
  fs.symlinkSync(
    path.join(outside, "pixel.png"),
    path.join(root, "outside.png"),
  );
  fs.writeFileSync(path.join(root, "active.svg"), '<svg onload="alert(1)"/>');
  for (const file of [
    "https://example.test/a.png",
    "../" + path.basename(outside) + "/pixel.png",
    "outside.png",
    "active.svg",
  ])
    assert.throws(() =>
      loadAssets(root, { version: 1, files: { border: file }, artworks: {} }),
    );
  const result = renderCard(
    { ...monster, artwork: "http://127.0.0.1/private" },
    blank(),
  );
  assert.ok(result.diagnostics.some((d) => d.startsWith("missing-artwork")));
  assert.doesNotMatch(result.svg, /127\.0\.0\.1/);
});
