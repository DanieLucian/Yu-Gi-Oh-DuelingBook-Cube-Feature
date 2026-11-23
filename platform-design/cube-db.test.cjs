const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { chromium } = require("playwright");
const { createRenderServer } = require("./server.cjs");
const a = "a".repeat(64), b = "b".repeat(64);
async function browserFixture(t) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());
  return browser;
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cube-catalog-"));
  const assets = path.join(root, "assets"); fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, "manifest.json"), JSON.stringify({ version: 1, files: {}, artworks: {} }));
  const server = createRenderServer({ assetRoot: assets, dataRoot: root, publicOnly: true });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  async function call(route, method = "GET", body, owner = a, status = 200) {
    const res = await fetch(url + "/api/cubes" + route, { method, headers: { "X-Cube-Owner": owner, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json(); assert.equal(res.status, status, JSON.stringify(data)); return data;
  }
  return { root, url, call };
}
test("cards are stored once while Cube memberships, copies and edits remain independent", async t => {
  const f = await fixture(t), card = { id: "official:1234", name: "Shared card", type: "Warrior / Effect", copies: 2 };
  const imported = await f.call("/import", "POST", { name: "Source", cube: { schema: "dbcd-cube-v1", cards: [card] } }, a, 201);
  const other = await f.call("/import", "POST", { name: "Other", cube: { schema: "dbcd-cube-v1", cards: [{ ...card, copies: 5 }] } }, b, 201);
  const db = new DatabaseSync(path.join(f.root, "cubes.sqlite"));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cards").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cube_cards").get().n, 2);
  const created = await f.call("", "POST", { name: "New Cube" }, a, 201);
  const id = created.cube.id;
  await f.call(`/${id}`, "POST", { sourceCubeId: other.cube.id, cardId: card.id }, a);
  assert.equal((await f.call(`/${id}`)).cube.cards[0].copies, 1);
  await f.call(`/${id}/cards/${encodeURIComponent(card.id)}`, "PATCH", { copies: 1000 });
  await f.call(`/${id}`, "POST", { sourceCubeId: other.cube.id, cardId: card.id }, a, 400);
  await f.call(`/${id}/cards/${encodeURIComponent(card.id)}`, "PATCH", { copies: 7 });
  assert.equal((await f.call(`/${other.cube.id}`, "GET", null, b)).cube.cards[0].copies, 5);
  await f.call(`/${id}`, "PATCH", { name: "Renamed" });
  await f.call(`/${id}/cards/${encodeURIComponent(card.id)}`, "PATCH", { copies: 0 }, a, 400);
  await f.call(`/${id}`, "PATCH", { name: "Intrusion" }, b, 403);
  await f.call(`/${id}/cards/${encodeURIComponent(card.id)}`, "DELETE", {});
  assert.equal((await f.call(`/${id}`)).cube.cards.length, 0);
  await f.call(`/${id}`, "DELETE", {});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cards").get().n, 1, "deleting a Cube retains shared cards");
  assert.equal((await f.call(`/${imported.cube.id}`)).cube.cards[0].copies, 2);
  db.close();
});
test("reimport restores missing card stats and text breaks without changing existing wording or copies", async t => {
  const f = await fixture(t);
  const card = { id: "123", name: "Reef Regent", origin: "custom", type: "Aqua / Xyz / Pendulum / Effect",
    artwork: "https://images.duelingbook.com/custom-pics/0/123.jpg?old", copies: 2, level: null,
    visual: { version: 1, pendulum: true, scaleRight: 8 },
    effect: "2 Level 7 monsters\nWhen Summoned: Draw a card.Then discard a card.",
    pendulumEffect: "First line.Second line." };
  const importCards = (name, cards) => f.call("/import", "POST", { name, cube: { schema: "dbcd-cube-v1", cards } }, a, 201);
  const { cube } = await importCards("Older scan", [card]);
  await importCards("New scan", [{ ...card, artwork: card.artwork.replace("old", "new"), copies: 5,
    visual: { rank: 7, scaleLeft: 0, scaleRight: 9 },
    effect: "2 Level 7 monsters\nWhen Summoned: Draw a card.\n\nThen discard a card.",
    pendulumEffect: "First line.\nSecond line." }]);
  await importCards("Different wording", [{ ...card, effect: "2 Level 7 monsters\n\nDraw 2 cards." }]);
  const updated = (await f.call(`/${cube.id}`)).cube.cards[0];
  assert.deepEqual(updated.visual, { version: 1, pendulum: true, scaleRight: 8, rank: 7, scaleLeft: 0 });
  assert.equal(updated.effect, "2 Level 7 monsters\nWhen Summoned: Draw a card.\n\nThen discard a card.");
  assert.equal(updated.pendulumEffect, "First line.\nSecond line.");
  assert.equal(updated.copies, 2);
});

test("a fresh import restores missing Link arrows while preserving saved arrows", async t => {
  const f = await fixture(t);
  const card = { id: "123", name: "Rail Cannon", type: "Machine / Link / Effect", link: "LINK-3", copies: 1 };
  const importWithArrows = (name, arrows) => f.call("/import", "POST", {
    name, cube: { schema: "dbcd-cube-v1", cards: [{ ...card, visual: { linkArrows: arrows } }] },
  }, a, 201);
  const { cube } = await importWithArrows("Older scan", []);
  const savedArrows = async () => (await f.call(`/${cube.id}`)).cube.cards[0].visual.linkArrows;
  await importWithArrows("Partial scan", ["top", "right"]);
  await importWithArrows("Invalid scan", ["top", "top", "diagonal"]);
  assert.deepEqual(await savedArrows(), []);
  const arrows = ["top", "bottom-right", "bottom-left"];
  await importWithArrows("Fresh scan", arrows);
  await importWithArrows("Different arrows", ["top", "left", "right"]);
  assert.deepEqual(await savedArrows(), arrows);
});

test("browser can create and edit a Cube using a card from another Cube", async t => {
  const f = await fixture(t);
  const source = await f.call("/import", "POST", { name: "Source", cube: { schema: "dbcd-cube-v1", cards: [{ id: "42", name: "Source card", copies: 3 }] } }, a, 201);
  const browser = await browserFixture(t);
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(value => localStorage.setItem("cube-draft.player.v1", value), a);
  await page.goto(f.url + "/draft");
  await page.click("#library-nav");
  await page.waitForSelector(`[data-edit-cube="${source.cube.id}"]`);
  await page.fill("#new-cube-name", "My Cube"); await page.click("#new-cube-create");
  await page.waitForFunction(() => document.querySelector("#editor-title").textContent === "My Cube");
  assert.match(page.url(), /\/cube-editor\/[a-f0-9-]+$/);
  assert.equal(await page.locator("#library-view").isHidden(), true);
  await page.locator("#editor-source-panel summary").click();
  await page.selectOption("#editor-source", source.cube.id);
  await page.click('[data-add-card="42"]');
  await page.waitForSelector('[data-save-copy="42"]');
  await page.locator('[data-copy="42"]').fill("6"); await page.click('[data-save-copy="42"]');
  await page.waitForFunction(() => document.querySelector('[data-copy="42"]').value === "6");
  await page.fill("#editor-name", "Renamed Cube"); await page.click("#editor-rename");
  await page.waitForFunction(() => document.querySelector("#editor-title").textContent === "Renamed Cube");
  const edited = (await f.call("", "GET")).cubes.find(c => c.name === "Renamed Cube");
  assert.equal(edited.cards[0].copies, 6);
  await page.click('[data-remove-card="42"]');
  await page.waitForFunction(() => document.querySelector("#editor-cards").textContent.includes("No cards"));
  await page.click("#editor-close");
  const deleteButton = page.locator(`[data-edit-cube="${edited.id}"] + [data-delete-cube="${edited.id}"]`);
  page.once("dialog", dialog => dialog.dismiss());
  await deleteButton.click();
  assert.equal((await f.call(`/${edited.id}`)).cube.name, "Renamed Cube");
  page.once("dialog", dialog => dialog.accept());
  await deleteButton.click();
  await deleteButton.waitFor({ state: "detached" });
  await f.call(`/${edited.id}`, "GET", null, a, 404);
  await page.locator("#cube-file").setInputFiles({ name: "Imported.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ schema: "dbcd-cube-v1", cards: [{ id: "42", name: "Source card", copies: 2 }, { id: "43", name: "New card", copies: 1 }] })) });
  await page.waitForSelector(".cube-tile:has-text('Imported')");
  const db = new DatabaseSync(path.join(f.root, "cubes.sqlite"));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cards").get().n, 2, "browser import reuses an existing card row");
  db.close();
  assert.deepEqual(errors, []);
});

test("dedicated Cube editor renders cards and filters their imported metadata", async t => {
  const f = await fixture(t), browser = await browserFixture(t);
  const cards = [
    { name: "Reef Guard", type: "[ Aqua / Effect ]", level: 4, attribute: "WATER", atk: "0", def: "1800", effect: "Draw a card." },
    { name: "River Sprite", type: "Aqua / Normal", level: 2, atk: 800, def: 1000 },
    { name: "Steel Hound", type: "Beast / Synchro / Effect", level: 6, atk: 2200, def: 1500 },
    { name: "Deepwater Regent", type: "Aqua / Xyz / Pendulum / Effect", level: 0,
      visual: { rank: 4, frame: "xyz", scaleLeft: 0, scaleRight: 8 }, atk: 2100, def: 1800,
      effect: "2 Level 4 monsters\n(Always treated as a Reef card.)\nWhen Summoned: Draw a card." },
    { name: "Rail Cannon", type: "Machine / Link / Effect", link: "LINK-3", atk: 2800,
      visual: { linkArrows: ["top", "bottom-left", "bottom-right"] } },
    { name: "Rising Tide", type: "Spell Card", visual: { spellTrapIcon: "continuous" } },
    { name: "Swift Current", type: "Quick Play Spell" },
    { name: "Warning Bell", type: "Counter Trap" },
  ].map((card, index) => ({ id: String(index + 1), artwork: `/mock-art/${index + 1}.svg`, copies: 1, ...card }));
  const { cube } = await f.call("/import", "POST", { name: "Tidal Cube", cube: { schema: "dbcd-cube-v1", cards } }, a, 201);
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem("cube-draft.player.v1", value), a);
  await page.goto(f.url + "/draft");
  await page.click("#library-nav");
  await page.click(`[data-edit-cube="${cube.id}"]`);
  await page.waitForURL(`**/cube-editor/${cube.id}`);
  await page.reload();
  const rows = page.locator(".editor-card-row");
  await rows.first().locator(".has-render .rendered-card").waitFor();
  assert.match(await rows.first().locator(".editor-card-meta").textContent(), /WATER.*Level 4.*\[ Aqua \/ Effect \].*ATK 0.*DEF 1800/s);
  assert.equal(await rows.first().locator("p").textContent(), "Draw a card.");
  const names = () => rows.locator("h3").allTextContents();
  assert.equal((await names()).length, 8);
  await page.waitForFunction(() => [...document.querySelectorAll(".editor-card-meta img")]
    .every(icon => icon.complete && icon.naturalWidth > 0));
  const statsFor = name => rows.filter({ has: page.getByRole("heading", { name, exact: true }) }).locator(".editor-card-meta");
  const iconsFor = name => statsFor(name).locator(":scope > span > img:first-child").evaluateAll(
    icons => icons.map(icon => icon.getAttribute("src"))
  );
  assert.deepEqual(await iconsFor("Reef Guard"), ["/card-icons/attribute.WATER", "/card-icons/icon.level"]);
  assert.deepEqual(await iconsFor("Deepwater Regent"), ["/card-icons/icon.rank"]);
  assert.deepEqual(await iconsFor("Swift Current"), ["/card-icons/attribute.SPELL", "/card-icons/icon.quick-play"]);
  assert.deepEqual(await iconsFor("Warning Bell"), ["/card-icons/attribute.TRAP", "/card-icons/icon.counter"]);
  const activeArrows = statsFor("Rail Cannon").locator(".editor-link-arrow.is-active");
  assert.match(await statsFor("Rail Cannon").textContent(), /Link 3/);
  assert.match(await statsFor("Deepwater Regent").textContent(), /Rank 4/);
  assert.doesNotMatch(await statsFor("Deepwater Regent").textContent(), /P Scale/);
  const regent = rows.filter({ has: page.getByRole("heading", { name: "Deepwater Regent" }) });
  assert.equal(await regent.locator(".editor-card-copy p").last().innerText(), cards[3].effect);
  const pendulumHeading = regent.locator(".editor-pendulum-heading");
  assert.match(await pendulumHeading.textContent(), /Pendulum effect\s+P Scale L 0 \/ R 8/);
  const scaleIcon = pendulumHeading.locator('h4 + span > img[src^="data:image/png;base64,"]');
  await scaleIcon.waitFor();
  await scaleIcon.evaluate(icon => icon.decode());
  assert.deepEqual(await activeArrows.evaluateAll(arrows => arrows.map(arrow => arrow.dataset.direction)),
    ["top", "bottom-right", "bottom-left"]);

  await page.selectOption("#editor-category", "monster");
  await page.selectOption("#editor-race", "aqua");
  await page.selectOption("#editor-trait", "effect");
  assert.deepEqual(await names(), ["Reef Guard", "Deepwater Regent"]);
  await page.selectOption("#editor-type-match", "or");
  assert.deepEqual(await names(), ["Reef Guard", "River Sprite", "Steel Hound", "Deepwater Regent", "Rail Cannon"]);
  await page.selectOption("#editor-rating-kind", "level");
  await page.fill("#editor-rating", "4");
  assert.deepEqual(await names(), ["Reef Guard"]);
  await page.selectOption("#editor-rating-kind", "rank");
  assert.deepEqual(await names(), ["Deepwater Regent"]);
  await page.fill("#editor-atk-min", "2000");
  await page.fill("#editor-def-max", "1700");
  assert.deepEqual(await names(), []);
  await page.fill("#editor-def-max", "");
  await page.selectOption("#editor-rating-kind", "link");
  await page.fill("#editor-rating", "3");
  assert.deepEqual(await names(), ["Rail Cannon"]);
  await page.fill("#editor-def-min", "0");
  assert.deepEqual(await names(), [], "Link Monsters have no DEF to match a range");

  await page.selectOption("#editor-category", "spell");
  await page.selectOption("#editor-subtype", "continuous");
  assert.deepEqual(await names(), ["Rising Tide"]);
  await page.selectOption("#editor-subtype", "quick-play");
  assert.deepEqual(await names(), ["Swift Current"]);
  await page.selectOption("#editor-category", "trap");
  await page.selectOption("#editor-subtype", "counter");
  assert.deepEqual(await names(), ["Warning Bell"]);
  await page.click("#editor-clear-filters");
  assert.equal((await names()).length, 8);
  await page.goBack();
  assert.equal(await page.locator("#library-view").isVisible(), true);
  await page.goForward();
  assert.equal(await page.locator("#editor-title").textContent(), "Tidal Cube");
  assert.deepEqual(errors, []);

  const guest = await browser.newPage();
  await guest.addInitScript(value => localStorage.setItem("cube-draft.player.v1", value), b);
  await guest.goto(`${f.url}/cube-editor/${cube.id}`);
  await guest.locator(".editor-card-row").first().waitFor();
  assert.equal(await guest.locator('.editor-card-meta img[src="/card-icons/attribute.SPELL"]').count(), 2);
  assert.equal(await guest.locator("#editor-edit-actions").isHidden(), true);
  assert.equal(await guest.locator("[data-save-copy]").count(), 0);
});
