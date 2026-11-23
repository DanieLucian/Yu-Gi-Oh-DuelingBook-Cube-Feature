const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

let browser, server, url;
before(async () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"));
  server = http.createServer((req, res) => {
    if (req.url === "/mock-cube.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(fs.readFileSync(path.join(__dirname, "mock-cube.js"))); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
async function fixture(t, { draft = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], "No browser script errors"));
  await page.clock.setFixedTime(new Date("2026-11-11T00:00:00Z"));
  await page.goto(url);
  if (draft) await page.evaluate(() => start(example.id));
  return page;
}
const input = (cards) => ({
  schema: "dbcd-cube-v1",
  exportedAt: "2026-11-11",
  customMetadata: { keep: true },
  cards,
});
const card = (id, extras = {}) => ({
  id,
  name: `Card ${id}`,
  origin: "custom",
  copies: 4,
  section: "main",
  artwork: "",
  ...extras,
});
async function upload(page, data, filename = "My Cube.json") {
  await page.locator("#library-nav").click();
  await page
    .locator("#cube-file")
    .setInputFiles({
      name: filename,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await page.waitForFunction(
    () => document.querySelector("#cube-file").value === "",
  );
}
async function startSmall(
  page,
  settings = { players: 2, rounds: 2, size: 3, seconds: 30 },
) {
  await page.evaluate((settings) => start(cube().id, settings), settings);
}
async function confirmFirst(page) {
  await page.locator("[data-instance]").first().click();
  await page.locator("[data-yes]").click();
}

test("hover spotlight and on-card Yes/No, outside and Escape confirmation", async (t) => {
  const page = await fixture(t);
  const first = page.locator("[data-instance]").first();
  const name = await first.locator(".card-name").textContent();
  await first.hover();
  assert.equal(await page.locator("#preview .card-name").textContent(), name);
  await first.click();
  assert.equal(await first.locator(".pick-confirm").count(), 1);
  assert.equal(await first.locator("[data-yes]").evaluate(node => document.activeElement === node), true, "Selecting a pack card focuses its confirmation button");
  const prompt = await first.locator(".pick-confirm").boundingBox(),
    surface = await first.boundingBox();
  assert.ok(
    prompt.x >= surface.x &&
      prompt.y >= surface.y &&
      prompt.width <= surface.width,
  );
  await page.locator("[data-no]").click();
  assert.equal(await page.locator(".pick-confirm").count(), 0);
  await first.click();
  await page.locator("[data-instance]").nth(1).click();
  assert.equal(
    await page.locator(".pick-confirm").count(),
    0,
    "Outside click cancels without selecting another card",
  );
  await first.click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#pool-count").textContent(), "0 cards");
  await confirmFirst(page);
  assert.equal(await page.locator("#pool-count").textContent(), "1 cards");
  assert.equal(await page.locator(".pick-confirm").count(), 0);
});

test("draft page stays idle and always offers the built-in mock Cube", async t => {
  const page = await fixture(t, { draft: false });
  assert.equal(await page.evaluate(() => state), null);
  assert.equal(await page.evaluate(() => draftTimer), null);
  assert.equal(await page.locator("[data-instance]").count(), 0);
  await page.clock.setFixedTime(new Date("2026-11-11T00:05:00Z"));
  assert.equal(await page.evaluate(() => state), null);
  assert.equal(await page.evaluate(() => draftTimer), null);
  await page.locator("#library-nav").click();
  assert.equal(await page.locator('[data-cube="mock-300"]').count(), 1, "Mock Cube is always available");
});

test("Main Deck size defaults to forty and validates thirty to sixty", async t => {
  const page = await fixture(t);
  assert.equal(await page.locator("#main-deck-size").inputValue(), "40");
  assert.equal(await page.locator("#main-deck-size").getAttribute("min"), "30");
  assert.equal(await page.locator("#main-deck-size").getAttribute("max"), "60");
  assert.equal(await page.evaluate(() => config.mainDeckSize), 40);
  const result = await page.evaluate(() => [29, 61, 40.5, 30, 60].map(mainDeckSize => {
    try { start("mock-300", { players: 2, rounds: 1, size: 1, seconds: 30, mainDeckSize }); return true; }
    catch { return false; }
  }));
  assert.deepEqual(result, [false, false, false, true, true]);
});

test("pack Zoom opens the larger reader with both actions at the top", async t => {
  const page = await fixture(t);
  await startSmall(page, { players: 2, rounds: 1, size: 3, seconds: 300 });
  const name = await page.locator("[data-instance]").first().locator(".card-name").textContent();
  await page.locator("[data-instance]").first().click();
  assert.equal(await page.locator("[data-details]").textContent(), "Zoom");
  await page.locator("[data-details]").click();
  assert.equal(await page.locator("#card-modal").isVisible(), true);
  assert.equal(await page.locator("#modal-details h3").textContent(), name);
  const image = await page.locator("#modal-card").boundingBox();
  const text = await page.locator("#modal-details").boundingBox();
  assert.ok(image.x + image.width <= text.x, "Reader places the image left of the card text");
  assert.equal(await page.locator("#modal-confirm").isVisible(), true);
  assert.equal(await page.locator(".reader-heading #modal-confirm").count(), 1);
  assert.equal(await page.locator(".reader-heading #modal-cancel").count(), 1);
  const confirm = await page.locator("#modal-confirm").boundingBox();
  const close = await page.locator("#modal-cancel").boundingBox();
  assert.ok(confirm.y < image.y && close.y < image.y);
  const reader = await page.locator(".card-reader").boundingBox();
  assert.equal(reader.width, 1050, "Zoom returns to its previous width");
  assert.equal(reader.height, 800, "Zoom returns to its previous height");
  assert.equal(await page.locator("#modal-details").evaluate(node => {
    const box = node.getBoundingClientRect();
    return Boolean(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("#card-modal"));
  }), true, "Deck card stacking stays behind the Zoom overlay");
  await page.locator("#modal-cancel").click();
  assert.equal(await page.locator("#card-modal").isHidden(), true);
  assert.equal(await page.evaluate(() => state.pools[0].length), 0);
  await page.locator("[data-instance]").first().click();
  await page.locator("[data-details]").click();
  await page.locator("#modal-confirm").click();
  assert.equal(await page.evaluate(() => state.pools[0].length), 1);
  assert.equal(await page.locator("#card-modal").isHidden(), true);
  assert.equal(await page.locator(".pick-confirm").count(), 0);
});

test("no notice bar and drafted cards open read-only Zoom before the draft ends", async t => {
  const page = await fixture(t);
  assert.equal(await page.locator("#mode-notice").count(), 0);
  await startSmall(page, { players: 2, rounds: 1, size: 3, seconds: 300 });
  await confirmFirst(page);
  const name = await page.locator(".pool-card .card-name").textContent();
  await page.locator(".pool-card").click();
  assert.equal(await page.locator("#card-modal").isVisible(), true);
  assert.equal(await page.locator("#modal-details h3").textContent(), name);
  assert.equal(await page.locator("#modal-confirm").isHidden(), true);
  assert.equal(await page.evaluate(() => state.pools[0].length), 1);
  await page.locator("#modal-cancel").click();
  assert.equal(await page.evaluate(() => state.finished), false);
});

test("a timer pick closes a pending Details reader", async t => {
  const page = await fixture(t);
  await startSmall(page, { players: 2, rounds: 1, size: 3, seconds: 5 });
  await page.locator("[data-instance]").first().click();
  await page.locator("[data-details]").click();
  await page.clock.setFixedTime(new Date("2026-11-11T00:00:05Z"));
  await page.waitForFunction(() => state.pools[0].length === 1);
  assert.equal(await page.locator("#card-modal").isHidden(), true);
  assert.equal(await page.locator(".pick-confirm").count(), 0);
});

test("Main and Side are separate zones and dragging swaps exact positions in either direction", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    start("mock-300", { players: 2, rounds: 2, size: 16, seconds: 300, mainDeckSize: 30 });
    state.pools[0] = [
      ...Array.from({ length: 31 }, (_, i) => ({ name: `Monster ${i}`, type: "Warrior / Effect", instanceId: String(i) })),
      { name: "Extra Monster", type: "Dragon / Fusion", instanceId: "extra" },
    ]; state.finished = true; render();
  });
  const ids = zone => page.locator(`[data-deck-zone="${zone}"] [data-pool]`).evaluateAll(nodes => nodes.map(n => n.dataset.pool));
  const mainBefore = await ids("main"), sideBefore = await ids("side");
  const mainBox = await page.locator('[data-deck-zone="main"]').boundingBox();
  const sideBox = await page.locator('[data-deck-zone="side"]').boundingBox();
  assert.ok(sideBox.y >= mainBox.y + mainBox.height);
  const mainId = mainBefore[0], sideId = sideBefore[0];
  await page.locator(`[data-pool="${mainId}"]`).dragTo(page.locator(`[data-pool="${sideId}"]`));
  assert.deepEqual(await ids("main"), [sideId, ...mainBefore.slice(1)]);
  assert.deepEqual(await ids("side"), [mainId]);
  await page.locator(`[data-pool="${mainId}"]`).dragTo(page.locator(`[data-pool="${sideId}"]`));
  assert.deepEqual(await ids("main"), mainBefore);
  assert.deepEqual(await ids("side"), sideBefore);
  assert.equal(await page.evaluate(() => swapDeckCards("extra", "0")), false);
  assert.equal(await page.locator('[data-pool="extra"]').getAttribute("draggable"), "false");
  await page.evaluate(() => { suppressDeckClickUntil = 0; });
  await page.locator('[data-pool="0"] .pool-card').click();
  assert.equal(await page.locator("#modal-section").count(), 0);
  const close = await page.locator("#modal-cancel").boundingBox();
  const body = await page.locator(".reader-body").boundingBox();
  assert.ok(close.y < body.y, "Close is at the top of the reader");
  await page.locator("#modal-cancel").click();
});

test("confirmation rows and pack card dimensions stay consistent through picks", async t => {
  const page = await fixture(t);
  await startSmall(page, { players: 2, rounds: 2, size: 15, seconds: 300 });
  const before = await page.locator("[data-instance]").first().boundingBox();
  await page.locator("[data-instance]").first().click();
  const yes = await page.locator("[data-yes]").boundingBox(), no = await page.locator("[data-no]").boundingBox(), details = await page.locator("[data-details]").boundingBox();
  assert.equal(yes.y, no.y);
  assert.ok(details.y >= yes.y + yes.height);
  await page.locator("[data-yes]").click();
  await page.evaluate(() => { for (let i = 0; i < 10; i++) pick(state.packs[0][0].instanceId); });
  const after = await page.locator("[data-instance]").first().boundingBox();
  assert.ok(Math.abs(before.width - after.width) < 1);
  assert.ok(Math.abs(before.height - after.height) < 1);
});

test("large card reader fits a narrow mobile screen", async t => {
  const page = await fixture(t);
  await startSmall(page, { players: 2, rounds: 1, size: 1, seconds: 300 });
  await page.evaluate(() => pick(state.packs[0][0].instanceId));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".pool-card").first().click();
  const reader = await page.locator("#card-modal .card-reader").boundingBox();
  assert.ok(reader.x >= 0 && reader.x + reader.width <= 390, "Reader fits the viewport width");
  assert.ok(reader.y >= 0 && reader.y + reader.height <= 844, "Reader fits the viewport height");
  const close = await page.locator("#modal-cancel").boundingBox();
  assert.ok(close.y >= 0 && close.y + close.height <= 844, "Close control stays on screen");
  await page.locator("#modal-cancel").click();
  assert.equal(await page.locator(".pool-card").first().evaluate(node => node.matches(":focus-within")), false, "Closing Zoom clears the originating card focus");
  assert.equal(await page.locator("#pool-title").evaluate(node => document.activeElement === node), true);
});

test("closing Zoom clears its card highlight until the next hover", async t => {
  const page = await fixture(t);
  await startSmall(page, { players: 2, rounds: 1, size: 1, seconds: 300 });
  await page.evaluate(() => pick(state.packs[0][0].instanceId));
  const card = page.locator(".pool-card").first();
  await card.click();
  await page.keyboard.press("Escape");
  assert.equal(await card.evaluate(node => node.matches(":focus")), false);
  assert.equal(await card.locator("..").evaluate(node => getComputedStyle(node).outlineStyle), "none");
  await page.mouse.move(0, 0);
  await card.hover();
  assert.equal(await card.locator("..").evaluate(node => getComputedStyle(node).outlineWidth), "4px");
});

test("dealing conserves copy counts, passes in alternating directions, and completes", async (t) => {
  const page = await fixture(t);
  await startSmall(page, { players: 3, rounds: 2, size: 3, seconds: 30 });
  const result = await page.evaluate(() => {
    const original = [...state.stock, ...state.packs.flat()].map(
      (c) => c.instanceId,
    );
    const seat1 = state.packs[1].map((c) => c.instanceId),
      seat2 = state.packs[2].map((c) => c.instanceId);
    pick(state.packs[0][0].instanceId);
    const firstDirection = state.packs[0].every((c) =>
      seat2.includes(c.instanceId),
    );
    while (state.round === 1) pick(state.packs[0][0].instanceId);
    const r2seat1 = state.packs[1].map((c) => c.instanceId);
    pick(state.packs[0][0].instanceId);
    const secondDirection = state.packs[0].every((c) =>
      r2seat1.includes(c.instanceId),
    );
    while (!state.finished) pick(state.packs[0][0].instanceId);
    const all = [...state.stock, ...state.packs.flat(), ...state.pools.flat()];
    const counts = Object.fromEntries(
      cube().cards.map((c) => [c.id, all.filter((x) => x.id === c.id).length]),
    );
    return {
      firstDirection,
      secondDirection,
      original: original.sort(),
      final: all.map((c) => c.instanceId).sort(),
      poolSizes: state.pools.map((p) => p.length),
      counts,
      expected: Object.fromEntries(cube().cards.map((c) => [c.id, c.copies])),
    };
  });
  assert.equal(result.firstDirection, true);
  assert.equal(result.secondDirection, true);
  assert.deepEqual(result.poolSizes, [6, 6, 6]);
  assert.deepEqual(result.final, result.original);
  assert.equal(new Set(result.final).size, result.final.length);
  assert.deepEqual(result.counts, result.expected);
  assert.match(await page.locator("#pack").textContent(), /draft is complete/i);
});

test("timeout commits one random available card and closes an obsolete prompt", async (t) => {
  const page = await fixture(t);
  await startSmall(page, { players: 2, rounds: 1, size: 3, seconds: 5 });
  const available = await page.evaluate(() =>
    state.packs[0].map((c) => c.instanceId),
  );
  await page.locator("[data-instance]").first().click();
  await page.clock.setFixedTime(new Date("2026-11-11T00:00:05Z"));
  await page.waitForFunction(() => state.pools[0].length === 1);
  assert.ok(
    available.includes(await page.evaluate(() => state.pools[0][0].instanceId)),
  );
  assert.equal(await page.locator(".pick-confirm").count(), 0);
  assert.match(await page.locator("#status").textContent(), /Time expired/);
  await page.evaluate(() => pick(state.pools[0][0].instanceId));
  assert.equal(
    await page.evaluate(() => state.pools[0].length),
    1,
    "Retrying a removed instance cannot pick twice",
  );
});

test("compatible JSON import persists metadata, escapes text, and rejects malformed records", async (t) => {
  const page = await fixture(t);
  const source = input([
    card("42", {
      name: "<img src=x onerror=alert(1)> & custom",
      notes: { tag: "keep" },
    }),
    card("official:abcd", { origin: "official", duelingbookId: "123" }),
  ]);
  await upload(page, source);
  assert.equal(await page.locator(".cube-tile").count(), 2);
  const imported = await page.evaluate(() => library[1]);
  assert.deepEqual(imported.cards, source.cards);
  assert.deepEqual(imported.customMetadata, source.customMetadata);
  await page.reload();
  await page.locator("#library-nav").click();
  assert.equal(
    await page.locator(".cube-tile").count(),
    2,
    "Saved library survives reload",
  );
  await page.evaluate(() =>
    start(library[1].id, { players: 2, rounds: 1, size: 2, seconds: 30 }),
  );
  assert.equal(
    await page.locator("#pack img").count(),
    0,
    "Names are rendered as text",
  );
  for (const invalid of [
    input([null]),
    input([card("1"), card("1")]),
    input([card("1", { copies: 0 })]),
    input([card("1", { type: { bad: true } })]),
    { schema: "unknown", cards: [] },
  ]) {
    await upload(page, invalid);
    assert.ok(await page.locator("#library-error").textContent());
    assert.equal(await page.locator(".cube-tile").count(), 2);
  }
});

test("settings enforce capacity and 2–6 players; cancel leaves active Cube unchanged", async (t) => {
  const page = await fixture(t);
  await upload(page, input([card("42", { copies: 2 })]), "Small.json");
  await page.locator("[data-cube]").nth(1).click();
  assert.match(
    await page.locator("#capacity").textContent(),
    /Small: 2 available copies/,
  );
  await page.locator("#start").click();
  assert.match(
    await page.locator("#settings-error").textContent(),
    /needs 180 copies/,
  );
  await page.locator("#settings-cancel").click();
  assert.equal(await page.evaluate(() => state.cubeId), "mock-300");
  const validations = await page.evaluate(() =>
    [1, 7, 2.5].map((players) => {
      try {
        start("mock-300", { players, rounds: 1, size: 1, seconds: 5 });
        return false;
      } catch {
        return true;
      }
    }),
  );
  assert.deepEqual(validations, [true, true, true]);
  for (const players of [2, 6]) {
    await startSmall(page, { players, rounds: 1, size: 1, seconds: 5 });
    assert.equal(await page.locator(".seat").count(), players);
  }
});

test("XML exports the selected Main, automatic Extra and remaining Side cards", async (t) => {
  const page = await fixture(t);
  await upload(
    page,
    input([
      card("42", { name: "A & B <Dragon>", duelingbookId: "4242", copies: 72 }),
      card("official:abcd", {
        origin: "official",
        duelingbookId: "777",
        name: "Official Fusion",
        type: "Dragon / Fusion / Effect",
      }),
      card("official:missing", {
        origin: "official",
        duelingbookId: "888",
        name: "Matched",
      }),
    ]),
  );
  await page.evaluate(() => {
    start(library[1].id, { players: 2, rounds: 2, size: 16, seconds: 30, mainDeckSize: 30 });
    state.pools[0] = [
      ...Array.from({ length: 30 }, () => ({ ...library[1].cards[0], instanceId: uuid(), deckSection: "main" })),
      { ...library[1].cards[1], instanceId: uuid(), deckSection: "extra" },
      { ...library[1].cards[2], instanceId: uuid(), deckSection: "side" },
    ];
    state.finished = true;
    render();
  });
  assert.equal(await page.locator("#export").isEnabled(), true);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export").click(),
  ]);
  const xml = fs.readFileSync(await download.path(), "utf8");
  assert.match(xml, /A &amp; B &lt;Dragon&gt;/);
  assert.doesNotMatch(xml, /official:/);
  const parsed = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return {
      errors: doc.querySelectorAll("parsererror").length,
      sections: [...doc.documentElement.children].map((s) => ({
        name: s.tagName,
        ids: [...s.children].map((c) => c.getAttribute("id")),
      })),
    };
  }, xml);
  assert.equal(parsed.errors, 0);
  assert.deepEqual(parsed.sections, [
    { name: "main", ids: Array(30).fill("4242") },
    { name: "extra", ids: ["777"] },
    { name: "side", ids: ["888"] },
  ]);
  await page.evaluate(() => { state.pools[0].at(-1).duelingbookId = ""; render(); });
  assert.equal(await page.locator("#export").isDisabled(), true);
  assert.match(
    await page.locator("#export-help").textContent(),
    /1 cards need/,
  );
  await page.evaluate(() => { state.pools[0].at(-1).duelingbookId = "888"; render(); });
  assert.equal(await page.locator("#export").isEnabled(), true);
});

test("card details show monster ratings, subtypes and both Pendulum texts safely", async (t) => {
  const page = await fixture(t);
  for (const [extras, expected] of [
    [{ type: "Dragon / Effect", level: 4 }, /Level 4/],
    [{ type: "Dragon / Xyz", level: 4, visual: { rank: 7 } }, /Rank 7/],
    [{ type: "Cyberse / Link", link: "3" }, /Link 3/],
    [{ type: "Spell", visual: { spellTrapIcon: "quick-play" } }, /Quick-Play Spell/],
    [{ type: "Continuous Trap" }, /Continuous Trap/],
  ]) {
    await page.evaluate(extras => preview({ name: "<Test>", effect: "Line one\nLine two <script>", pendulumEffect: "Pendulum text", ...extras }), extras);
    assert.match(await page.locator("#card-details .detail-meta").textContent(), expected);
    assert.match(await page.locator("#card-details").textContent(), /Pendulum text/);
    assert.match(await page.locator("#card-details").textContent(), /Line two <script>/);
    assert.equal(await page.locator("#card-details script").count(), 0);
  }
});

test("XML stays locked until all picks are complete, including direct export calls", async (t) => {
  const page = await fixture(t);
  await upload(page, input([card("42")]));
  await page.evaluate(() => start(library[1].id, { players: 2, rounds: 1, size: 2, seconds: 30 }));
  await confirmFirst(page);
  assert.equal(await page.locator("#export").isDisabled(), true);
  await page.evaluate(() => exportXml());
  assert.match(await page.locator("#toast").textContent(), /Complete the draft/);
  await page.locator(".pool-card").first().focus();
  assert.equal(await page.locator("#card-details h3").textContent(), "Card 42");
  await confirmFirst(page);
  assert.equal(await page.locator("#export").isDisabled(), true, "A completed draft still needs the configured Main Deck size");
  await page.evaluate(() => { state.pools[0].pop(); render(); });
  assert.equal(await page.locator("#export").isDisabled(), true);
});

test("desktop and narrow layouts fit the viewport", async (t) => {
  const page = await fixture(t);
  for (const width of [2560, 1440, 1160, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `No horizontal overflow at ${width}px`,
    );
  }
});


test("fixed pack rows, scrollable drafted cards and fixed sticky text", async t => {
  const page = await fixture(t);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => {
    state.pools[0] = Array.from({ length: 40 }, (_, i) => ({ ...example.cards[i % example.cards.length], instanceId: uuid() }));
    render();
    preview({ name: "Spellcaster", type: "Spellcaster / Effect", attribute: "DARK", level: 6, atk: 2200, def: 1200, effect: "Short text" });
  });
  assert.equal(await page.locator("#pool select").count(), 0);
  assert.equal(await page.locator(".pool-card").count(), 40);
  const before = await page.locator("#card-details").boundingBox();
  assert.ok(before.y >= 0 && before.y + before.height <= 1080, "Card text fits before scrolling");
  const spotlight = await page.locator("#preview .card").boundingBox();
  const previewPanel = await page.locator(".preview-panel").boundingBox();
  assert.ok(spotlight.width < previewPanel.width * .85, "Spotlight uses the adjustable 80 percent scale");
  assert.ok(before.y < 1080 / 2, "Reader text starts above the screen's vertical center");
  const layout = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#pack > [data-instance]")];
    const pack = document.querySelector("#pack");
    const firstRow = cards.filter(c => c.getBoundingClientRect().top === cards[0].getBoundingClientRect().top);
    const packStyle = getComputedStyle(pack);
    const pool = document.querySelector("#pool");
    return { row: firstRow.length,
      unusedRight: pack.getBoundingClientRect().right - firstRow.at(-1).getBoundingClientRect().right - parseFloat(packStyle.paddingRight),
      highlightGutter: Math.min(parseFloat(packStyle.paddingTop), parseFloat(packStyle.paddingRight), parseFloat(packStyle.paddingBottom), parseFloat(packStyle.paddingLeft)),
      poolBottom: pool.getBoundingClientRect().bottom, height: innerHeight,
      poolScroll: pool.scrollHeight > pool.clientHeight,
      rows: [...document.querySelector("#card-details .detail-meta").children].map(n => n.textContent) };
  });
  assert.ok(layout.row >= 1, "Pack uses as many fixed-width columns as fit");
  assert.ok(layout.unusedRight >= -1, "Fixed-width pack cards stay inside the available row width");
  assert.ok(layout.highlightGutter >= 2, "Pack leaves room for the outline's two-pixel outer half");
  assert.ok(layout.poolBottom < layout.height, "The deck viewport stays on screen");
  assert.equal(layout.poolScroll, true, "Forty cards scroll instead of shrinking");
  assert.deepEqual(layout.rows, ["DARK \u00b7 Spellcaster / Effect", "Level 6 \u00b7 ATK / 2200 \u00b7 DEF / 1200"]);
  await page.evaluate(() => {
    preview({ name: "Long text", type: "Dragon / Effect", level: 4, effect: "Long effect text. ".repeat(200) });
    document.querySelector("#pack").style.minHeight = "2200px";
  });
  const after = await page.locator("#card-details").boundingBox();
  assert.equal(before.width, after.width);
  assert.equal(before.height, after.height);
  assert.ok(await page.locator("#card-details .detail-text").evaluate(n => n.scrollHeight > n.clientHeight));
  await page.evaluate(() => scrollTo(0, 1000));
  const scrolled = await page.locator("#card-details").boundingBox();
  assert.ok(scrolled.y >= 0 && scrolled.y + scrolled.height <= 1080, "Card text remains on screen while scrolling");
  assert.deepEqual(await page.evaluate(() => [
    { type: "Spellcaster / Effect", section: "extra" },
    { type: "Dragon / Fusion" }, { type: "Dragon / Synchro" },
    { type: "Dragon / Xyz" }, { type: "Cyberse / Link" },
    { type: "Dragon / Ritual" }, { type: "Spell" },
    { visual: { frame: "xyz" } }, { frame: "https://example.test/fusion_front.png" },
  ].map(deckCategory)), ["main", "extra", "extra", "extra", "extra", "main", "main", "extra", "extra"]);
});

test("deck amount rows count each section and update when Main and Side swap", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    config.mainDeckSize = 40;
    state.pools[0] = [
      {instanceId:"main-monster",name:"Main monster",type:"Warrior / Normal",deckSection:"main"},
      {instanceId:"main-spell",name:"Main spell",type:"Normal Spell",deckSection:"main"},
      {instanceId:"main-trap",name:"Main trap",type:"Normal Trap",deckSection:"main"},
      {instanceId:"side-monster",name:"Side monster",type:"Dragon / Ritual",deckSection:"side"},
      {instanceId:"side-spell",name:"Side spell",type:"Quick-Play Spell",deckSection:"side"},
      {instanceId:"side-trap",name:"Side trap",type:"Counter Trap",deckSection:"side"},
      ...["Fusion","Xyz","Synchro","Link"].map(type=>({instanceId:"extra-"+type,name:type,type:"Dragon / "+type})),
    ];
    render();
  });
  for (const finished of [false,true]) {
    await page.evaluate(finished=>{state.finished=finished;render();},finished);
    assert.deepEqual(await page.locator("[data-summary-row]").evaluateAll(nodes=>nodes.map(n=>n.dataset.summaryRow)),["total","main","side","extra"]);
    assert.equal(await page.textContent("#total-count"),"10");
    assert.equal(await page.textContent("#main-count"),"3");
    assert.equal(await page.textContent("#side-count"),"3");
    assert.equal(await page.textContent("#extra-count"),"4");
    for(const section of ["main","side"]){
      assert.deepEqual(await page.locator(`[data-summary-row="${section}"] [data-kind]`).evaluateAll(nodes=>nodes.map(n=>n.dataset.kind)),["monster","spell","trap"]);
      for(const kind of ["monster","spell","trap"])assert.equal(await page.textContent(`#${section}-${kind}-count`),"1");
      assert.equal(await page.locator(`[data-summary-row="${section}"] svg[data-frame="effect"]`).count(),1,"all Main/Side monster counts use the effect frame");
    }
    assert.deepEqual(await page.locator('[data-summary-row="extra"] [data-kind]:visible').evaluateAll(nodes=>nodes.map(n=>n.dataset.kind)),["fusion","xyz","synchro","link"]);
    assert.equal(await page.locator("#deck-stats svg text").count(),0,"miniature frames have no card text or stats");
  }
  assert.equal(await page.evaluate(()=>swapDeckCards("main-monster","side-trap")),true);
  assert.equal(await page.textContent("#main-monster-count"),"0");assert.equal(await page.textContent("#main-trap-count"),"2");
  assert.equal(await page.textContent("#side-monster-count"),"2");assert.equal(await page.textContent("#side-trap-count"),"0");
  assert.equal(await page.textContent("#main-count"),"3");assert.equal(await page.textContent("#side-count"),"3");
  await page.evaluate(()=>{state.pools[0]=state.pools[0].filter(c=>c.instanceId!=="extra-Xyz"&&c.instanceId!=="extra-Link");render();});
  assert.deepEqual(await page.locator('[data-summary-row="extra"] [data-kind]:visible').evaluateAll(nodes=>nodes.map(n=>n.dataset.kind)),["fusion","synchro"]);
});

test("drafted cards retain their dimensions as counts grow and overflowing sections scroll", async t => {
  const page=await fixture(t);await page.setViewportSize({width:1280,height:720});
  const widths=[],heights=[];
  for(const finished of [false,true]){
    const phaseStart=widths.length;
    for(const count of [1,20,75]){
      await page.evaluate(({finished,count})=>{
        config.mainDeckSize=60;
        state.finished=finished;
        state.pools[0]=Array.from({length:count},(_,i)=>({name:`Card ${i}`,type:i>=65?"Dragon / Fusion":"Warrior / Effect",instanceId:String(i),deckSection:i<60?"main":"side"}));
        render();
      },{finished,count});
      const box=await page.locator("#pool .pool-row").first().boundingBox();widths.push(box.width);heights.push(box.height);
    }
    assert.equal(await page.locator("#pool").evaluate(n=>getComputedStyle(n).overflowY),"auto");
    assert.ok(await page.locator("#pool").evaluate(n=>n.scrollHeight>n.clientHeight),"overflow is scrollable");
    await page.locator("#pool .pool-row").last().scrollIntoViewIfNeeded();
    const last=await page.locator("#pool .pool-row").last().boundingBox(),viewport=await page.locator("#pool").boundingBox();
    assert.ok(last.y>=viewport.y-1&&last.y+last.height<=viewport.y+viewport.height+1);
    assert.ok(Math.max(...widths.slice(phaseStart))-Math.min(...widths.slice(phaseStart))<1,JSON.stringify(widths));
    assert.ok(Math.max(...heights.slice(phaseStart))-Math.min(...heights.slice(phaseStart))<1,JSON.stringify(heights));
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),true);
});

test("completed deck replaces packs and fits forty cards with sorting controls", async t => {
  const page = await fixture(t);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const oldPack = await page.locator("#pack-panel").boundingBox();
  await page.evaluate(() => {
    state.pools[0] = Array.from({ length: 40 }, (_, i) => ({ ...example.cards[i % 30], instanceId: uuid() }));
    state.finished = true;
    render();
  });
  assert.equal(await page.locator("#pack-panel").isHidden(), true);
  assert.equal(await page.locator("#deck-sort").isVisible(), true);
  assert.equal(await page.getByText("Card spotlight", { exact: true }).count(), 0);
  const deck = await page.locator("#final-deck-panel").boundingBox();
  assert.ok(deck.x >= 0 && deck.width > oldPack.width * .5);
  assert.equal(await page.locator(".pool-panel #export").count(), 1);
  assert.equal(await page.locator(".pool-panel #deck-sort").count(), 1);
  assert.equal(await page.locator("#final-deck-panel #pool").count(), 1);
  assert.equal(await page.locator("#final-deck-panel button:not(.pool-card)").count(), 0);
  assert.equal(await page.locator("#total-count").textContent(), "40");
  assert.equal(await page.locator("#deck-stats").isVisible(), true);
  assert.equal(await page.locator("#pool .deck-zone-cards").count(), 3);
  for (const [width, height] of [[1920, 1080], [1440, 900], [2560, 1080]]) {
    await page.setViewportSize({ width, height });
    const bottom = await page.locator("#pool").evaluate(n => n.getBoundingClientRect().bottom);
    assert.ok(bottom <= height, `Forty final cards fit at ${width}x${height}`);
  }
  await page.evaluate(() => start(cube().id));
  assert.equal(await page.locator("#pack-panel").isVisible(), true);
  assert.equal(await page.locator("#deck-sort").isHidden(), true);
  assert.equal(await page.locator("#draft-pool-slot #pool").count(), 1);
});

test("final deck uses four Main rows and overlaps surplus cards within fixed sections", async t => {
  const page = await fixture(t);
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const mainSize of [40, 60]) {
    await page.evaluate(mainSize => {
      start("mock-300", { players: 2, rounds: 4, size: 30, seconds: 300, mainDeckSize: mainSize });
      state.pools[0] = [
        ...Array.from({ length: mainSize }, (_, i) => ({ name: `Main ${i}`, type: "Warrior / Effect", instanceId: `main-${i}`, deckSection: "main" })),
        ...Array.from({ length: 20 }, (_, i) => ({ name: `Side ${i}`, type: "Spell", instanceId: `side-${i}`, deckSection: "side" })),
        ...Array.from({ length: 15 }, (_, i) => ({ name: `Extra ${i}`, type: "Dragon / Fusion", instanceId: `extra-${i}`, deckSection: "extra" })),
      ];
      state.finished = true;
      render();
    }, mainSize);
    const layout = await page.evaluate(() => {
      const box = node => {
        const b = node.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
      };
      return ["main", "side", "extra"].map(section => {
        const zone = document.querySelector(`[data-deck-zone="${section}"] .deck-zone-cards`);
        const cards = [...zone.querySelectorAll(".pool-row")].map(box);
        const rows = [];
        for (const card of cards) {
          let row = rows.find(row => Math.abs(row[0].top - card.top) < 1);
          if (!row) { row = []; rows.push(row); }
          row.push(card);
        }
        return { section, zone: box(zone), cards, rows };
      });
    });
    const [main, side, extra] = layout;
    assert.equal(main.rows.length, 4, `${mainSize} Main cards use exactly four rows`);
    for (let row = 1; row < main.rows.length; row++)
      assert.ok(main.rows[row][0].top >= main.rows[row - 1][0].bottom - .5, "Overlap is horizontal only; Main rows stay separate");
    assert.deepEqual(main.rows.map(row => row.length), Array(4).fill(mainSize / 4));
    assert.equal(side.rows.length, 1, "Side retains one allocated row");
    assert.equal(extra.rows.length, 1, "Extra retains one allocated row");
    for (const zone of layout) {
      for (const card of zone.cards) {
        assert.ok(card.left >= zone.zone.left - 1 && card.right <= zone.zone.right + 1, `${zone.section}: card stays inside width`);
        assert.ok(card.top >= zone.zone.top - 1 && card.bottom <= zone.zone.bottom + 1, `${zone.section}: card stays inside height`);
        assert.ok(Math.abs(card.width - main.cards[0].width) < 1, "All deck sections retain the same card width");
      }
      const first = zone.rows[0][0], last = zone.rows[0].at(-1);
      assert.ok(first.left - zone.zone.left <= 6, `${zone.section}: first card starts at the left edge`);
      for (const row of zone.rows) {
        if (row.length >= 10)
          assert.ok(Math.abs((row.at(-1).right - row[0].left) - (zone.zone.width - 8)) <= 1,
            `${zone.section}: ten or more cards always fill the same allocated width`);
      }
      assert.ok(zone.zone.right - last.right <= 5, `${zone.section}: no unused space after a full row`);
    }
    if (mainSize > 40) assert.ok(main.rows[0][1].left < main.rows[0][0].right - 1, "Main surplus overlaps horizontally");
    else assert.ok(main.rows[0][1].left >= main.rows[0][0].right - 1, "Forty cards retain a normal 4 by 10 layout");
    assert.ok(side.rows[0][1].left < side.rows[0][0].right - 1, "Side surplus overlaps horizontally");
    assert.ok(extra.rows[0][1].left < extra.rows[0][0].right - 1, "Extra surplus overlaps horizontally");
    assert.ok(side.zone.top >= main.zone.bottom, "Side appears below Main");
    assert.ok(extra.zone.top >= side.zone.bottom, "Extra appears below Side");
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
  }
});

test("final deck sorts both directions, with persistent type grouping and missing stats last", async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    Object.assign(deckSort, { groupTypes: false, key: "pick", direction: "asc" });
    state.pools[0] = [
      { name: "Spell Z", type: "Spell" },
      { name: "Monster Z", type: "Spellcaster / Effect", atk: "100", def: "200", level: 2 },
      { name: "Trap A", type: "Trap" },
      { name: "Monster A", type: "Dragon / Effect", atk: "300", def: "100", level: 6 },
      { name: "Monster B", type: "Dragon / Effect", atk: "100", def: "300", visual: { rank: 4 } },
      { name: "Unknown", type: "Warrior", atk: "?", def: "", level: "" },
    ].map((c, i) => ({ ...c, instanceId: String(i) }));
    state.finished = true;
    render();
  });
  const order = () => page.locator("#pool .pool-row").evaluateAll(nodes => nodes.map(n => Number(n.dataset.pool)));
  for (const [key, asc, desc] of [
    ["atk", [4, 1, 3, 0, 2, 5], [3, 4, 1, 0, 2, 5]],
    ["def", [3, 1, 4, 0, 2, 5], [4, 1, 3, 0, 2, 5]],
    ["level", [1, 4, 3, 0, 2, 5], [3, 4, 1, 0, 2, 5]],
    ["name", [3, 4, 1, 0, 2, 5], [5, 2, 0, 1, 4, 3]],
  ]) {
    await page.locator("#deck-sort-key").selectOption(key);
    await page.locator("#deck-sort-direction").selectOption("asc");
    assert.deepEqual(await order(), asc);
    await page.locator("#deck-sort-direction").selectOption("desc");
    assert.deepEqual(await order(), desc);
  }
  await page.locator("#group-types").click();
  assert.equal(await page.locator("#group-types").getAttribute("aria-pressed"), "true");
  assert.deepEqual(await order(), [5, 1, 4, 3, 0, 2]);
  await page.locator("#deck-sort-key").selectOption("atk");
  assert.deepEqual(await order(), [3, 4, 1, 5, 0, 2]);
  await page.locator("#deck-sort-direction").selectOption("asc");
  assert.deepEqual(await order(), [4, 1, 3, 5, 0, 2]);
  assert.deepEqual(await page.evaluate(() => state.pools[0].map(c => c.instanceId)), ["0", "1", "2", "3", "4", "5"]);
  await page.locator("#group-types").click();
  assert.deepEqual(await order(), [4, 1, 3, 0, 2, 5]);
});

test("default deck order groups types and sorts Level descending", async t => {
  const page = await fixture(t);
  assert.deepEqual(await page.evaluate(() => deckSort), { groupTypes: true, key: "level", direction: "desc" });
  assert.equal(await page.locator("#group-types").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#deck-sort-key").inputValue(), "level");
  assert.equal(await page.locator("#deck-sort-direction").inputValue(), "desc");
});

test("equal stats use alphabetical names and monster grouping orders Normal, Effect, Ritual", async t => {
  const page = await fixture(t);
  const result = await page.evaluate(() => {
    const cards = ["Zebra", "Alpha", "Beta"].map(name => ({ name, type: "Warrior / Effect", atk: 100, def: 200, level: 4 }));
    const ties = [];
    for (const key of ["atk", "def", "level"])
      for (const direction of ["asc", "desc"]) {
        Object.assign(deckSort, { key, direction });
        ties.push(sortedDeck(cards).map(c => c.name));
      }
    Object.assign(deckSort, { groupTypes: true, key: "name", direction: "desc" });
    const mixed = [
      { name: "Trap", type: "Trap" }, { name: "Ritual", type: "Dragon / Ritual / Effect" },
      { name: "Effect", type: "Spellcaster / Effect" }, { name: "Spell", type: "Spell" },
      { name: "Normal", visual: { frame: "normal" } },
    ];
    state.pools[0] = mixed.map(c => ({ ...c, instanceId: uuid() }));
    state.finished = true;
    render();
    return { ties, grouped: sortedDeck(mixed).map(c => c.name) };
  });
  assert.deepEqual(result.ties, Array.from({ length: 6 }, () => ["Alpha", "Beta", "Zebra"]));
  assert.deepEqual(result.grouped, ["Normal", "Effect", "Ritual", "Spell", "Trap"]);
  for (const [kind, count] of [["total", "5"], ["main-monster", "3"], ["main-spell", "1"], ["main-trap", "1"]])
    assert.equal(await page.locator(`#${kind}-count`).textContent(), count);
});

test("draft and final deck fit the screen while card overflow scrolls internally", async t => {
  const page = await fixture(t);
  for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720], [900, 700], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const finished of [false, true]) {
      await page.evaluate(finished => {
        start(cube().id, { players: 2, rounds: 2, size: 30, seconds: 300 });
        state.pools[0] = Array.from({ length: 40 }, (_, i) => ({ ...example.cards[i % 30], instanceId: uuid() }));
        state.finished = finished;
        render();
      }, finished);
      const layout = await page.evaluate(() => {
        const inside = (node, bounds) => {
          const r = node.getBoundingClientRect();
          return r.left >= bounds.left - 1 && r.right <= bounds.right + 1 && r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1;
        };
        const screen = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
        return {
          pageFits: document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth,
          cardsFit: ["pack", "pool"].every(id => {
            const grid = document.getElementById(id);
            if (!grid.clientWidth) return true;
            const style = getComputedStyle(grid);
            return style.overflowY === "auto" && inside(grid, screen);
          }),
          exportVisible: inside(document.querySelector("#export"), screen),
          textVisible: inside(document.querySelector("#card-details"), screen),
        };
      });
      assert.deepEqual(layout, { pageFits: true, cardsFit: true, exportVisible: true, textVisible: true }, `${width}x${height}, finished=${finished}`);
    }
    await page.locator("#library-nav").click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
    await page.locator("#table-nav").click();
  }
});


test("pack count does not change card dimensions, and focus rings straddle the border", async t => {
  const page = await fixture(t);
  const widths = [];
  for (const size of [5, 15, 30]) {
    await page.evaluate(size => start("mock-300", { players: 2, rounds: 1, size, seconds: 300 }), size);
    widths.push((await page.locator("[data-instance]").first().boundingBox()).width);
  }
  assert.ok(Math.max(...widths) - Math.min(...widths) < 1, `Fixed pack card widths: ${widths}`);
  const card = page.locator("[data-instance]").first();
  await card.hover();
  assert.deepEqual(await card.evaluate(n => ({ width: getComputedStyle(n).outlineWidth, offset: getComputedStyle(n).outlineOffset })), { width: "4px", offset: "-2px" });
  assert.ok(await page.evaluate(() => {
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--spotlight-scale"));
    return scale > 0 && scale <= 1;
  }), "Spotlight scale remains configurable");
});

test("pack width setting changes the actual width and excess cards remain scrollable", async t => {
  const page = await fixture(t);
  await page.evaluate(() => start("mock-300", { players: 2, rounds: 1, size: 30, seconds: 300 }));
  const measured = [];
  for (const width of [144, 184]) {
    await page.evaluate(width => { document.documentElement.style.setProperty("--pack-card-width", `${width}px`); fitCards(); }, width);
    measured.push((await page.locator("[data-instance]").first().boundingBox()).width);
  }
  assert.ok(measured[1] > measured[0], "A larger preferred width produces larger cards and fewer columns");
  const pack = await page.locator("#pack").evaluate(node => ({ overflow: getComputedStyle(node).overflowY, content: node.scrollHeight, height: node.clientHeight }));
  assert.equal(pack.overflow, "auto");
  assert.ok(pack.content > pack.height);
  await page.locator("[data-instance]").last().scrollIntoViewIfNeeded();
  const last = await page.locator("[data-instance]").last().boundingBox();
  const panel = await page.locator("#pack").boundingBox();
  assert.ok(last.y >= panel.y - 1 && last.y + last.height <= panel.y + panel.height + 1, "Last card can be scrolled fully into view");
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
});

test("wide final deck packs cards tightly and gives spare width to both side panels", async t => {
  const page = await fixture(t);
  await page.setViewportSize({ width: 2560, height: 1080 });
  const before = {
    spotlight: await page.locator(".preview-panel").boundingBox(),
    menu: await page.locator(".pool-panel").boundingBox(),
  };
  await page.evaluate(() => {
    state.pools[0] = Array.from({ length: 55 }, (_, i) => ({ name: `Card ${i}`, type: i >= 45 ? "Dragon / Fusion" : "Warrior / Effect",
      instanceId: String(i), deckSection: i < 40 ? "main" : i < 45 ? "side" : "extra" }));
    state.finished = true; render();
  });
  await page.waitForFunction(() => {
    const cards = document.querySelector('[data-deck-zone="main"] .deck-zone-cards').children;
    return Math.abs(cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().right - 2) < .5;
  });
  assert.equal(await page.locator("#final-deck-panel > .panel-title").count(), 0);
  assert.equal(await page.locator("#table-view > .help").count(), 0);
  assert.equal(await page.locator(".pool-panel #draft-rules").count(), 0);
  const layout = await page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-deck-zone="main"] .pool-row');
    const box = i => nodes[i].getBoundingClientRect();
    return { horizontalGap: box(1).left - box(0).right, verticalGap: box(10).top - box(0).bottom };
  });
  assert.ok(Math.abs(layout.horizontalGap - 2) < .5);
  assert.ok(Math.abs(layout.verticalGap - 2) < .5);
  assert.ok((await page.locator(".preview-panel").boundingBox()).width > before.spotlight.width);
  assert.ok((await page.locator(".pool-panel").boundingBox()).width > before.menu.width);
});
