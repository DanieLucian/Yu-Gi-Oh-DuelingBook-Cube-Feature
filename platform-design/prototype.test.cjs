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
async function fixture(t) {
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
  assert.equal(await page.evaluate(() => state.cubeId), "demo");
  const validations = await page.evaluate(() =>
    [1, 7, 2.5].map((players) => {
      try {
        start("demo", { players, rounds: 1, size: 1, seconds: 5 });
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

test("XML uses confirmed IDs, escapes names, exports sections and omits Reserve", async (t) => {
  const page = await fixture(t);
  await upload(
    page,
    input([
      card("42", { name: "A & B <Dragon>", duelingbookId: "4242" }),
      card("official:abcd", {
        origin: "official",
        duelingbookId: "777",
        name: "Official Spell",
      }),
      card("official:missing", {
        origin: "official",
        duelingbookId: "",
        name: "Unmatched",
      }),
    ]),
  );
  await page.evaluate(() => {
    start(library[1].id, { players: 2, rounds: 1, size: 1, seconds: 30 });
    state.pools[0] = [
      { ...library[1].cards[0], instanceId: uuid(), deckSection: "main" },
      { ...library[1].cards[1], instanceId: uuid(), deckSection: "extra" },
      { ...library[1].cards[0], instanceId: uuid(), deckSection: "side" },
      { ...library[1].cards[2], instanceId: uuid(), deckSection: "reserve" },
    ];
    render();
  });
  assert.equal(await page.locator("#export").isEnabled(), true);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export").click(),
  ]);
  const xml = fs.readFileSync(await download.path(), "utf8");
  assert.match(xml, /A &amp; B &lt;Dragon&gt;/);
  assert.doesNotMatch(xml, /official:|Unmatched/);
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
    { name: "main", ids: ["4242"] },
    { name: "extra", ids: ["777"] },
    { name: "side", ids: ["4242"] },
  ]);
  await page.locator("[data-section]").last().selectOption("main");
  assert.equal(await page.locator("#export").isDisabled(), true);
  assert.match(
    await page.locator("#export-help").textContent(),
    /1 cards need/,
  );
  await page.locator("[data-section]").last().selectOption("reserve");
  assert.equal(await page.locator("#export").isEnabled(), true);
});

test("desktop and narrow layouts fit the viewport", async (t) => {
  const page = await fixture(t);
  for (const width of [1440, 900, 390]) {
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
