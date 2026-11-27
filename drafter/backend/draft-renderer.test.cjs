"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { createRenderServer } = require("./server.cjs");
const { supportedArtwork, createArtworkCache } = require("../renderer/artwork-cache.cjs");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=", "base64");

test("room drafts with bots share rendered images and import artwork into cached SVGs", async t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "draft-render-"));
  let downloads = 0;
  const server = createRenderServer({ dataRoot, fetchArtwork: async () => {
    downloads++; return new Response(png);
  } });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let draftRenders = 0;
  page.on("request", request => { if (request.url().endsWith("/api/draft-render")) draftRenders++; });
  await page.goto(url + "/draft");
  await page.waitForLoadState("networkidle");
  assert.equal(await page.evaluate(() => state), null);
  assert.equal(await page.locator("#pack [data-instance]").count(), 0);
  assert.equal(draftRenders, 0);
  await page.fill("#room-name", "Render host"); await page.click("#room-create");
  await page.fill("#room-player-count", "2"); await page.click("#room-confirm");
  await page.waitForSelector("#room-lobby:not([hidden])");
  await page.fill("#lobby-rounds", "1"); await page.fill("#lobby-pack-size", "3"); await page.fill("#lobby-seconds", "300");
  await page.click("#lobby-save"); await page.waitForFunction(() => document.querySelector("#room-status").textContent === "Room settings saved.");
  await page.click('[data-room-add-bot="1"]'); await page.waitForFunction(() => !document.querySelector("#room-start").disabled);
  await page.click("#room-start");
  await page.waitForSelector("#pack .has-render");
  const first = page.locator("[data-instance]").first();
  await first.locator(".rendered-card").waitFor();
  await first.hover();
  await page.waitForSelector("#preview .has-render");
  assert.equal(await first.locator(".rendered-card").getAttribute("src"), await page.locator("#preview .rendered-card").getAttribute("src"));
  await first.click();
  await page.locator("[data-details]").click();
  await page.waitForSelector("#modal-card .has-render");
  assert.equal(await first.locator(".rendered-card").getAttribute("src"), await page.locator("#modal-card .rendered-card").getAttribute("src"));
  await page.locator("#modal-cancel").click();
  await first.click();
  await page.locator("[data-yes]").click();
  await page.waitForFunction(() => document.querySelectorAll(".pool-row").length === 1);
  await page.waitForSelector("#pool .has-render");
  await page.locator(".pool-card").first().hover();
  assert.equal(await page.locator("#pool .rendered-card").getAttribute("src"), await page.locator("#preview .rendered-card").getAttribute("src"));
  const card = { name: "Imported Example", type: "Dragon / Effect", level: 4, effect: "Example text.", artwork: "https://images.duelingbook.com/custom-pics/0/42.jpg" };
  const render = () => fetch(url + "/api/draft-render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card) });
  const result = await (await render()).json();
  const imageResponse = await fetch(url + result.url);
  assert.match(imageResponse.headers.get("cache-control"), /private.*immutable/);
  const svg = await imageResponse.text();
  assert.match(svg, /data-card-artwork="true"/);
  assert.ok(!result.diagnostics.some(d => d.startsWith("missing-artwork")));
  assert.equal((await (await render()).json()).cacheHit, true);
  assert.equal(downloads, 1);
  await page.locator("#library-nav").click();
  await page.locator("#cube-file").setInputFiles({
    name: "Rendered Cube.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schema: "dbcd-cube-v1", cards: [{ ...card, id: "42", copies: 44 }] })),
  });
  await page.waitForFunction(() => document.querySelector("#cube-file").value === "");
  await page.click("#rooms-nav"); await page.click("#room-close"); await page.click("#room-confirm");
  await page.waitForSelector("#room-entry:not([hidden])"); await page.click("#room-create"); await page.click("#room-confirm");
  await page.waitForSelector("#room-lobby:not([hidden])");
  await page.selectOption("#lobby-cube", await page.evaluate(() => library.at(-1).id));
  await page.fill("#lobby-main-size", "20"); await page.fill("#lobby-rounds", "1");
  await page.fill("#lobby-pack-size", "22"); await page.fill("#lobby-seconds", "300");
  await page.click("#lobby-save"); await page.waitForFunction(() => document.querySelector("#room-status").textContent === "Room settings saved.");
  await page.click('[data-room-add-bot="1"]'); await page.waitForFunction(() => !document.querySelector("#room-start").disabled);
  await page.click("#room-start");
  await page.waitForSelector("#pack .has-render");
  assert.equal(await page.locator("#pack .rendered-card").first().getAttribute("src"), result.url);
  assert.equal(downloads, 1);
  await page.evaluate(card => preview(card), card);
  await page.waitForFunction(() => document.querySelector("#preview .rendered-card")?.alt === "Imported Example");
  await page.evaluate(() => { window.originalSpotlightImage = document.querySelector("#preview .rendered-card"); });
  const before = await page.locator("#preview .card").boundingBox();
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  await page.route("**/api/draft-render", async route => {
    if (route.request().postDataJSON().name === "Slow Spotlight") await delayed;
    await route.continue();
  });
  await page.evaluate(card => preview({ ...card, name: "Slow Spotlight" }), card);
  assert.equal(await page.locator("#preview .rendered-card").getAttribute("alt"), "Imported Example");
  assert.equal(await page.evaluate(() => document.querySelector("#preview .rendered-card") === window.originalSpotlightImage), true, "Repeat hovering keeps the decoded spotlight image");
  await page.evaluate(card => preview(card), card);
  release();
  await page.unrouteAll({ behavior: "wait" });
  assert.equal(await page.locator("#preview .rendered-card").getAttribute("alt"), "Imported Example");
  assert.deepEqual(await page.locator("#preview .card").boundingBox(), before);
  await page.evaluate(card => preview({ ...card, name: "Cached Alternate" }), card);
  await page.waitForFunction(() => document.querySelector("#preview .rendered-card")?.alt === "Cached Alternate");
  await page.evaluate(card => preview(card), card);
  assert.equal(await page.evaluate(() => document.querySelector("#preview .rendered-card") === window.originalSpotlightImage), true,
    "Switching back from another card reuses the original decoded spotlight image");
  await page.evaluate(async () => {
    const { code, token } = JSON.parse(localStorage.getItem("cube-draft.room.v1"));
    const url = `/api/rooms/${code}`;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    let room = await (await fetch(url, { headers })).json();
    while (room.phase === "drafting") {
      const { round, pick, pack } = room;
      const response = await fetch(`${url}/pick`, { method: "POST", headers,
        body: JSON.stringify({ round, pick, instanceId: pack[0].instanceId }) });
      if (!response.ok) throw Error(`Draft pick failed (${response.status})`);
      room = await response.json();
    }
  });
  await page.waitForFunction(() => state?.finished && document.querySelectorAll("#pool .has-render .rendered-card").length === 22);
  const requestsBeforeSwap = draftRenders;
  const [mainId, sideId] = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("#pool .pool-row")];
    window.originalDeck = nodes.flatMap(node => [node, node.querySelector(".rendered-card")]);
    return ["main", "side"].map(section => nodes.find(node => node.dataset.category === section).dataset.pool);
  });
  const saved = page.waitForResponse(response => response.url().endsWith("/deck") && response.request().method() === "POST");
  await page.waitForFunction(([main, side]) => swapDeckCards(main, side), [mainId, sideId]);
  const saveResponse = await saved;
  assert.equal(saveResponse.ok(), true);
  const savedRoom = await saveResponse.json();
  assert.equal(savedRoom.pool.find(card => card.instanceId === mainId).deckSection, "side");
  assert.equal(savedRoom.pool.find(card => card.instanceId === sideId).deckSection, "main");
  await page.waitForResponse(response => response.url().endsWith(`/api/rooms/${savedRoom.code}`) && response.request().method() === "GET");
  assert.equal(await page.locator(`[data-deck-zone="side"] [data-pool="${mainId}"]`).count(), 1);
  assert.equal(await page.evaluate(() => window.originalDeck.every(node => node.isConnected)), true,
    "Saving a swap and polling must keep all existing card elements and loaded images");
  assert.equal(draftRenders, requestsBeforeSwap, "Swap does not request new card renders");
  assert.deepEqual(errors, []);
});

test("artwork cache survives restart and download failures preserve the fallback", async t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "draft-artwork-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const source = "https://www.duelingbook.com/pics/42.jpg";
  const registry = { artworks: new Map() };
  let requests = 0;
  const ensure = createArtworkCache(registry, dataRoot, async () => {
    requests++; return new Response(png);
  });
  await Promise.all([ensure(source), ensure(source)]);
  assert.equal(requests, 1);
  const restarted = { artworks: new Map() };
  await createArtworkCache(restarted, dataRoot, () => { throw Error("Unexpected network request"); })(source);
  assert.equal(restarted.artworks.get(source), registry.artworks.get(source));
  const failed = { artworks: new Map() };
  const ensureBad = createArtworkCache(failed, dataRoot, async () => new Response("<svg/>"));
  await ensureBad("https://www.duelingbook.com/pics/99.png");
  assert.equal(failed.artworks.size, 0);
  assert.equal(fs.readdirSync(path.join(dataRoot, "artwork-cache")).length, 1);
});

test("artwork downloads allow only DuelingBook image paths", () => {
  assert.ok(supportedArtwork("https://www.duelingbook.com/custom-pics/1/42.jpg"));
  assert.ok(supportedArtwork("https://www.duelingbook.com/pics/42.webp"));
  assert.ok(supportedArtwork("https://images.duelingbook.com/custom-pics/5900000/5956317.jpg"));
  for (const directory of ["low-res", "card-pics", "small"])
    assert.ok(supportedArtwork(`https://images.duelingbook.com/${directory}/1.jpg?version=2`));
  for (const url of ["http://www.duelingbook.com/pics/42.jpg", "https://127.0.0.1/pics/42.jpg", "https://www.duelingbook.com.evil.test/pics/42.jpg", "https://images.duelingbook.com.evil.test/pics/42.jpg", "https://www.duelingbook.com:444/pics/42.jpg", "https://www.duelingbook.com/pics/42.svg"])
    assert.equal(supportedArtwork(url), false);
});

test("official artwork at every DuelingBook quality setting is embedded in draft renders", async t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "official-artwork-"));
  const requests = [];
  const server = createRenderServer({ dataRoot, fetchArtwork: async source => {
    requests.push(source); return new Response(png);
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const directory of ["low-res", "card-pics", "small"]) {
    const artwork = `https://images.duelingbook.com/${directory}/1.jpg?version=2`;
    const card = { name: "Official Card", origin: "official", artwork, type: "Normal Trap", visual: { frame: "trap", spellTrapIcon: "normal" } };
    const response = await fetch(url + "/api/draft-render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card) });
    assert.equal(response.status, 200);
    const result = await response.json();
    const svg = await (await fetch(url + result.url)).text();
    assert.match(svg, /data-card-artwork="true"/);
    assert.match(svg, /data:image\/png;base64,/);
    assert.ok(!result.diagnostics.some(item => item.startsWith("missing-artwork")));
    assert.ok(requests.includes(artwork));
  }
  assert.equal(requests.length, 3);
  for (const source of [
    "https://images.duelingbook.com/low-res/not-a-number.jpg",
    "https://images.duelingbook.com/profile-pics/1.jpg",
    "https://images.duelingbook.com/low-res/1.svg",
    "https://images.duelingbook.com.evil.test/low-res/1.jpg",
  ]) assert.equal(supportedArtwork(source), false);
});
