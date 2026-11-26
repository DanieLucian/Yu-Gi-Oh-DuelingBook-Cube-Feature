const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRenderServer } = require("./server.cjs");
const { chromium } = require("playwright");
const config = { players: 2, rounds: 2, size: 2, seconds: 300, mainDeckSize: 30 };
const cube = { id: "test", name: "Shared test Cube", cards: [{ id: "42", duelingbookId: "42", name: "Monster", type: "Warrior / Effect", copies: 8 }] };
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "draft-rooms-"));
  const assets = path.join(root, "assets"); fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, "manifest.json"), JSON.stringify({ version: 1, files: {}, artworks: {} }));
  let server, url;
  async function start() {
    server = createRenderServer({ assetRoot: assets, dataRoot: root, ...options });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await start();
  t.after(async () => { await stop(); fs.rmSync(root, { recursive: true, force: true }); });
  async function call(route, body, token, status = 200) {
    const res = await fetch(url + "/api/rooms" + route, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await res.json(); assert.equal(res.status, status, JSON.stringify(result)); return result;
  }
  return { call, get url() { return url; }, root, restart: async () => { await stop(); await start(); } };
}
test("public draft mode serves multiplayer but excludes renderer administration", async t => {
  const f = await fixture(t, { publicOnly: true });
  for (const route of ["/tester", "/api/tester-state", "/api/style", "/gallery.js", "/simulate", "/api/render"]) {
    assert.equal((await fetch(f.url + route)).status, 404, route);
  }
  assert.equal((await fetch(f.url + "/api/style", { method: "PUT" })).status, 404);
  const page = await fetch(f.url + "/"); assert.equal(page.url, f.url + "/draft");
  const html = await page.text();
  assert.equal(html.includes("simulation-nav"), false);
  const versionedClient = html.match(/src="(\/room-client\.js\?v=[a-f0-9]{12})"/);
  assert.ok(versionedClient, "each page requests the room client by its content version");
  const script = await fetch(f.url + versionedClient[1]);
  assert.equal(script.headers.get("cache-control"), "no-store");
  const expectedVersion = require("node:crypto").createHash("sha256").update(await script.text()).digest("hex").slice(0, 12);
  assert.equal(versionedClient[1], "/room-client.js?v=" + expectedVersion);
  for (const route of ["/draft-renderer.js", "/room-client.js", "/mock-cube.js"]) assert.equal((await fetch(f.url + route)).status, 200);
  const render = await fetch(f.url + "/api/draft-render", { method: "POST", headers: { "Content-Type": "application/json", Origin: f.url.replace("http:", "https:") }, body: JSON.stringify(cube.cards[0]) });
  assert.equal(render.status, 200, "card rendering accepts the same host through HTTPS termination");
  assert.equal((await fetch(f.url + "/api/draft-render", { method: "POST", headers: { Origin: "https://unrelated.example" } })).status, 403);
  const host = await f.call("", { name: "Remote host", cube, config }, null, 201);
  const closed = await f.call(`/${host.code}/close`, {}, host.token);
  assert.equal(closed.phase, "closed", "the public server also accepts the host's close request");
});
test("rooms authorize seats, pass packs, preserve private pools and recover after restart", async t => {
  const f = await fixture(t), call = f.call;
  await call("", { name: "Host", cube, config: { ...config, players: 99 } }, null, 400);
  const host = await call("", { name: "Host", cube, config }, null, 201), route = "/" + host.code;
  await call(route, null, null, 401);
  await call(route + "/start", {}, host.token, 409);
  const guest = await call(route + "/join", { name: "Guest" }, null, 201);
  await call(route + "/join", { name: "Third" }, null, 409);
  await call(route + "/start", {}, guest.token, 403);
  let h = await call(route + "/start", {}, host.token);
  let g = await call(route, null, guest.token);
  assert.equal(h.pack.length, 2); assert.equal(g.pack.length, 2);
  assert.equal(h.stock, undefined); assert.equal(h.players[1].pool, undefined);
  assert.equal(JSON.stringify(h).includes(guest.token), false);
  await call(route + "/pick", { round: h.round, pick: h.pick, instanceId: g.pack[0].instanceId }, host.token, 409);
  const ids = new Set();
  for (let n = 0; n < 4; n++) {
    h = await call(route, null, host.token); g = await call(route, null, guest.token);
    const hp = { round: h.round, pick: h.pick, instanceId: h.pack[0].instanceId };
    ids.add(hp.instanceId); ids.add(g.pack[0].instanceId);
    const waiting = await call(route + "/pick", hp, host.token);
    assert.equal(waiting.pack.length, 0); assert.equal(waiting.pool.length, n + 1);
    await call(route + "/pick", hp, host.token, 409);
    await call(route + "/pick", { round: g.round, pick: g.pick, instanceId: g.pack[0].instanceId }, guest.token);
    await call(route + "/pick", hp, host.token, 409);
    if (n === 0) {
      await f.restart();
      assert.equal((await call(route, null, host.token)).pool[0].instanceId, hp.instanceId);
    }
  }
  h = await call(route, null, host.token); g = await call(route, null, guest.token);
  assert.equal(h.phase, "finished"); assert.equal(g.pool.length, 4); assert.equal(ids.size, 8);
  const cards = h.pool.map((c, i) => ({ instanceId: c.instanceId, deckSection: i ? "main" : "side" }));
  await call(route + "/deck", { cards }, host.token);
  await f.restart();
  assert.equal((await call(route, null, host.token)).pool[0].deckSection, "side");
  assert.equal((await call(route, null, guest.token)).pool.some(c => c.deckSection === "side"), false);
});
test("expired deadlines auto-pick missing seats after server restart", async t => {
  const f = await fixture(t);
  const host = await f.call("", { name: "Host", cube, config }, null, 201), route = "/" + host.code;
  await f.call(route + "/join", { name: "Guest" }, null, 201);
  await f.call(route + "/start", {}, host.token);
  const file = path.join(f.root, "rooms", host.code + ".json");
  const saved = JSON.parse(fs.readFileSync(file)); saved.deadline = Date.now() - 1000;
  fs.writeFileSync(file, JSON.stringify(saved)); await f.restart();
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(JSON.parse(fs.readFileSync(file)).players[1].pool.length, 1, "server timer persists auto-picks without browser requests");
  const recovered = await f.call(route, null, host.token);
  assert.equal(recovered.pool.length, 1); assert.equal(recovered.pick, 2); assert.equal(recovered.players[1].count, 1);
});
test("lobby creation, host settings, member permissions and capacity checks", async t => {
  const f = await fixture(t);
  await f.call("", { name: "  ", config: { players: 2 } }, null, 400);
  const host = await f.call("", { name: "  Host  ", cube: null, config: { players: 2 } }, null, 201), route = "/" + host.code;
  assert.equal(host.players[0].name, "Host"); assert.equal(host.cube, null);
  assert.equal(host.config.mainDeckSize, 40); assert.equal(host.canStart, false);
  const guest = await f.call(route + "/join", { name: "Guest" }, null, 201);
  await f.call(route + "/settings", { config: { seconds: 0 } }, guest.token, 403);
  await f.call(route + "/close", {}, guest.token, 403);
  await f.call(route + "/start", {}, guest.token, 403);
  await f.call(route + "/start", {}, host.token, 409);
  for (const change of [{ mainDeckSize: 19 }, { mainDeckSize: 61 }, { seconds: -1 }, { players: 3 }, { rounds: 0 }, { size: 31 }])
    await f.call(route + "/settings", { config: change }, host.token, 400);
  const small = await f.call(route + "/settings", { config: { mainDeckSize: 20, seconds: 0 }, cube }, host.token);
  assert.equal(small.canStart, false); assert.match(small.startIssue, /enough copies/);
  const ready = await f.call(route + "/settings", { config: { mainDeckSize: 60, rounds: 2, size: 2 } }, host.token);
  assert.equal(ready.canStart, true); assert.equal(ready.config.seconds, 0);
  const shared = await f.call(route + "/cube", null, guest.token); assert.deepEqual(shared.cube, cube);
  await f.call(route + "/cube", null, null, 401);
  const started = await f.call(route + "/start", {}, host.token);
  assert.equal(started.deadline, null);
  await f.call(route + "/settings", { config: { seconds: 1 } }, host.token, 409);
  await f.restart();
  await new Promise(resolve => setTimeout(resolve, 400));
  const resumed = await f.call(route, null, guest.token);
  assert.equal(resumed.deadline, null); assert.equal(resumed.pool.length, 0); assert.equal(resumed.pick, 1);
});

test("one room per browser identity persists until host closes or guest leaves", async t => {
  const f = await fixture(t), playerId = "a".repeat(64), guestId = "b".repeat(64);
  const host = await f.call("", { name: "Host", playerId, config }, null, 201), route = "/" + host.code;
  await f.call("", { name: "Again", playerId, config }, null, 409);
  await f.restart();
  await f.call("", { name: "Again", playerId, config }, null, 409);
  const other = await f.call("", { name: "Other", config }, null, 201);
  await f.call(`/${other.code}/join`, { name: "Host", playerId }, null, 409);
  const guest = await f.call(route + "/join", { name: "Guest", playerId: guestId }, null, 201);
  await f.call("", { name: "Guest", playerId: guestId, config }, null, 409);
  await f.call(route + "/leave", {}, guest.token);
  assert.equal((await f.call(route, null, host.token)).players.length, 1);
  await f.call("", { name: "Guest", playerId: guestId, config }, null, 201);
  await f.call(route + "/leave", {}, host.token, 409);
  await f.call(route + "/close", {}, host.token);
  assert.equal((await f.call(route, null, host.token)).phase, "closed");
  await f.call(route + "/join", { name: "Late" }, null, 409);
  await f.call("", { name: "Host again", playerId, config }, null, 201);
});

test("the permanent mock Cube has 300 complete, varied cards and local artwork", async t => {
  const MockCube = require("./mock-cube.js"), { normalizeCard } = require("./renderer/render.cjs");
  const mock = MockCube.create();
  assert.equal(mock.cards.length, 300); assert.equal(mock.cards.reduce((n,c)=>n+c.copies,0),300);
  assert.equal(new Set(mock.cards.map(c=>c.id)).size,300);
  assert.equal(new Set(mock.cards.map(c=>c.name)).size,300);
  assert.equal(new Set(mock.cards.map((c,i)=>MockCube.artwork(i+1))).size,300);
  assert.deepEqual(MockCube.create(),mock,"all browsers and server restarts use the same built-in Cube");
  for (const card of mock.cards) { const normalized=normalizeCard(card); assert.equal(normalized.warnings.length,0,card.name); assert.ok(card.effect); }
  const f=await fixture(t,{publicOnly:true});
  const host=await f.call("",{name:"Host",config},null,201);
  assert.equal(host.cube.id,mock.id); assert.equal(host.cube.uniqueCards,300);
  const shared=await f.call(`/${host.code}/cube`,null,host.token); assert.deepEqual(shared.cube,mock);
  const art=await fetch(f.url+mock.cards[0].artwork); assert.equal(art.status,200); assert.match(await art.text(),/<svg/);
  assert.equal((await fetch(f.url+"/mock-art/301.svg")).status,404);
  const rendered=await (await fetch(f.url+"/api/draft-render",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(mock.cards[0])})).json();
  assert.ok(!rendered.diagnostics.some(d=>d.startsWith("missing-artwork")));
  assert.match(await (await fetch(f.url+rendered.url)).text(),/data:image\/svg\+xml;base64,/);
  const bot=await f.call(`/${host.code}/add-bot`,{slot:1},host.token);
  await f.call(`/${host.code}/remove-player`,{playerId:bot.players[1].id},host.token);
});

test("host manages specific slots, guests cannot manage seats and kicked credentials are revoked",async t=>{
  const f=await fixture(t), host=await f.call("",{name:"Host",config:{...config,players:4}},null,201), route=`/${host.code}`;
  await f.call(route+"/add-bot",{slot:0},host.token,400);
  let room=await f.call(route+"/add-bot",{slot:3},host.token);
  assert.equal(room.players[1].slot,3); assert.equal(room.players[1].bot,true);
  const guestId="c".repeat(64),guest=await f.call(route+"/join",{name:"Guest",playerId:guestId},null,201);
  assert.equal(guest.players.find(p=>p.you).slot,1);
  await f.call(route+"/add-bot",{slot:2},guest.token,403);
  await f.call(route+"/remove-player",{playerId:room.players[1].id},guest.token,403);
  await f.call(route+"/remove-player",{playerId:host.players[0].id},host.token,400);
  await f.call(route+"/add-bot",{slot:3},host.token,409);
  room=await f.call(route+"/remove-player",{playerId:guest.players.find(p=>p.you).id},host.token);
  assert.deepEqual(room.players.map(p=>p.slot),[0,3]);
  const kicked=await f.call(route,null,guest.token,403); assert.equal(kicked.code,"ROOM_REMOVED");
  await f.call("",{name:"Guest again",playerId:guestId,config},null,201);
  await f.restart(); assert.equal((await f.call(route,null,guest.token,403)).code,"ROOM_REMOVED");
  await f.call(route+"/remove-player",{playerId:room.players[1].id},host.token);
  assert.equal((await f.call(route,null,host.token)).players.length,1);
});

test("mixed human and bot drafts finish with unique picks and resume without duplicate bot picks",async t=>{
  const f=await fixture(t), options={...config,players:3,rounds:2,size:3,seconds:0};
  const host=await f.call("",{name:"Host",config:options},null,201),route=`/${host.code}`;
  await f.call(route+"/add-bot",{slot:2},host.token);
  const guest=await f.call(route+"/join",{name:"Guest"},null,201);
  let h=await f.call(route+"/start",{},host.token);
  assert.equal(h.players.find(p=>p.bot).count,1); assert.equal(h.deadline,null);
  await f.call(route+"/remove-player",{playerId:h.players[2].id},host.token,409);
  for(let n=0;n<6;n++){
    h=await f.call(route,null,host.token);const g=await f.call(route,null,guest.token);
    await f.call(route+"/pick",{round:h.round,pick:h.pick,instanceId:h.pack[0].instanceId},host.token);
    if(n===0){await f.restart();assert.equal((await f.call(route,null,host.token)).players.find(p=>p.bot).count,1);}
    h=await f.call(route+"/pick",{round:g.round,pick:g.pick,instanceId:g.pack[0].instanceId},guest.token);
    assert.equal(h.players.find(p=>p.bot).count,Math.min(n+2,6));
  }
  assert.equal(h.phase,"finished");assert.ok(h.players.every(p=>p.count===6));
  const saved=JSON.parse(fs.readFileSync(path.join(f.root,"rooms",host.code+".json")));
  assert.equal(new Set(saved.players.flatMap(p=>p.pool.map(c=>c.instanceId))).size,18);
  assert.equal(new Set(saved.players.flatMap(p=>p.pool.map(c=>c.id))).size,18,"single-copy mock cards are never duplicated");
});

test("host ends active and completed sessions, preserving the room and archived drafts", async t => {
  const f = await fixture(t, { publicOnly: true });
  const options = { ...config, players: 3, rounds: 1, size: 2, seconds: 0, mainDeckSize: 20 };
  const host = await f.call("", { name: "Host", config: options }, null, 201), route = `/${host.code}`;
  const guest = await f.call(route + "/join", { name: "Guest" }, null, 201);
  await f.call(route + "/add-bot", { slot: 2 }, host.token);
  await f.call(route + "/end-session", {}, host.token, 409);
  let draft = await f.call(route + "/start", {}, host.token);
  const firstSession = draft.sessionId, firstInstance = draft.pack[0].instanceId;
  const members = draft.players.map(p => p.id);
  await f.call(route + "/pick", { round: draft.round, pick: draft.pick, instanceId: firstInstance }, host.token);
  await f.call(route + "/end-session", { sessionId: firstSession }, guest.token, 403);
  await f.call(route + "/end-session", { sessionId: "stale" }, host.token, 409);
  const lobby = await f.call(route + "/end-session", { sessionId: firstSession }, host.token);
  assert.equal(lobby.phase, "lobby"); assert.equal(lobby.code, host.code); assert.equal(lobby.sessionId, null);
  assert.deepEqual(lobby.config, options); assert.equal(lobby.cube.id, "mock-300");
  assert.deepEqual(lobby.players.map(p => p.id), members);
  assert.ok(lobby.players.every(p => p.count === 0 && !p.picked));
  assert.equal(lobby.pool.length, 0); assert.equal(lobby.pack.length, 0); assert.equal(lobby.deadline, null);
  assert.equal(lobby.canStart, true); assert.equal(lobby.round, 0); assert.equal(lobby.pick, 0);
  const history = path.join(f.root, "rooms", "sessions", host.code);
  const firstArchive = JSON.parse(fs.readFileSync(path.join(history, firstSession + ".json")));
  assert.equal(firstArchive.phase, "drafting"); assert.equal(firstArchive.players[0].pool[0].instanceId, firstInstance);
  assert.ok(firstArchive.endedAt);
  await f.restart();
  assert.equal((await f.call(route, null, guest.token)).phase, "lobby");
  draft = await f.call(route + "/start", {}, host.token);
  const secondSession = draft.sessionId; assert.notEqual(secondSession, firstSession);
  await f.call(route + "/end-session", { sessionId: firstSession }, host.token, 409);
  await f.call(route + "/pick", { round: draft.round, pick: draft.pick, instanceId: firstInstance }, host.token, 409);
  for (let n = 0; n < 2; n++) {
    const h = await f.call(route, null, host.token), g = await f.call(route, null, guest.token);
    await f.call(route + "/pick", { round: h.round, pick: h.pick, instanceId: h.pack[0].instanceId }, host.token);
    draft = await f.call(route + "/pick", { round: g.round, pick: g.pick, instanceId: g.pack[0].instanceId }, guest.token);
  }
  assert.equal(draft.phase, "finished");
  await f.call(route + "/leave", {}, guest.token);
  const ended = await f.call(route + "/end-session", { sessionId: secondSession }, host.token);
  assert.equal(ended.phase, "lobby"); assert.equal(ended.players.length, 2);
  assert.deepEqual(ended.players.map(p => p.slot), [0, 2], "a guest who already left must not be put back into the room");
  assert.equal(ended.canStart, false); assert.equal(fs.readdirSync(history).length, 2);
  const secondArchive = JSON.parse(fs.readFileSync(path.join(history, secondSession + ".json")));
  assert.equal(secondArchive.phase, "finished"); assert.ok(secondArchive.players.every(p => p.pool.length === 2));
});

test("legacy sessions can end, and an archive failure leaves the active session intact", async t => {
  const f = await fixture(t);
  const host = await f.call("", { name: "Host", config }, null, 201), route = `/${host.code}`;
  await f.call(route + "/add-bot", { slot: 1 }, host.token);
  await f.call(route + "/start", {}, host.token);
  const file = path.join(f.root, "rooms", host.code + ".json");
  const legacy = JSON.parse(fs.readFileSync(file)); delete legacy.sessionId;
  fs.writeFileSync(file, JSON.stringify(legacy)); await f.restart();
  fs.writeFileSync(path.join(f.root, "rooms", "sessions"), "blocked archive directory");
  const before = fs.readFileSync(file, "utf8");
  await f.call(route + "/end-session", { sessionId: null }, host.token, 500);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal((await f.call(route, null, host.token)).phase, "drafting");
  fs.unlinkSync(path.join(f.root, "rooms", "sessions"));
  assert.equal((await f.call(route + "/end-session", { sessionId: null }, host.token)).phase, "lobby");
});

async function browserFixture(t) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", args: ["--no-sandbox"] });
  t.after(() => browser.close()); return browser;
}
async function createInBrowser(page, name = "Host", players = 2) {
  await page.fill("#room-name", name); await page.click("#room-create");
  await page.fill("#room-player-count", String(players)); await page.click("#room-confirm");
  await page.waitForSelector("#room-entry-modal", { state: "hidden" });
  await page.waitForSelector("#room-lobby:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#active-room-code").textContent.length === 8);
  return page.textContent("#active-room-code");
}
async function joinInBrowser(page, code, name = "Guest") {
  await page.fill("#room-name", name); await page.click("#room-join");
  await page.fill("#room-code", code); await page.click("#room-confirm");
  await page.waitForFunction(code => document.querySelector("#active-room-code").textContent === code.toUpperCase(), code);
}
async function configureInBrowser(page, selectedCube = cube, seconds = 300) {
  await page.evaluate(c => { library.push(c); view("rooms"); }, selectedCube);
  await page.selectOption("#lobby-cube", selectedCube.id);
  for (const [id, value] of [["lobby-main-size",30],["lobby-rounds",2],["lobby-pack-size",2],["lobby-seconds",seconds]]) await page.fill("#" + id, String(value));
  await page.click("#lobby-save");
  await page.waitForFunction(() => document.querySelector("#room-status").textContent === "Room settings saved.");
}

test("two browser seats use the lobby, copy the code, view the Cube, pick and resume", async t => {
  const f = await fixture(t), browser = await browserFixture(t);
  const hc = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] }), gc = await browser.newContext();
  const h = await hc.newPage(), g = await gc.newPage();
  const errors = []; for (const p of [h,g]) p.on("pageerror", e => errors.push(e.message));
  await h.goto(f.url + "/draft"); await g.goto(f.url + "/draft");
  assert.equal(await h.locator("#room-create").isDisabled(), true);
  assert.equal(await h.locator("#room-join").isDisabled(), true);
  await h.fill("#room-name", "   "); assert.equal(await h.locator("#room-create").isDisabled(), true);
  const code = await createInBrowser(h);
  assert.equal(await h.locator("#room-entry").isHidden(), true);
  assert.equal(await h.locator("#room-members li").count(), 2);
  assert.equal(await h.textContent("#room-member-count"), "1/2");
  assert.equal(await h.locator("#room-start").isDisabled(), true);
  assert.equal(await h.inputValue("#lobby-main-size"), "40");
  await h.click("#room-copy");
  await h.waitForFunction(() => document.querySelector("#room-status").textContent === "Room code copied to clipboard.");
  assert.equal(await h.textContent("#room-copy"), "Copy code");
  assert.equal(await h.evaluate(() => navigator.clipboard.readText()), code);
  await configureInBrowser(h, cube, 0);
  await joinInBrowser(g, code.toLowerCase());
  assert.equal(await g.locator("#lobby-main-size").isDisabled(), true);
  assert.equal(await g.locator("#room-start").isHidden(), true);
  assert.equal(await g.locator("#lobby-save").isHidden(), true);
  assert.equal(await g.textContent("#room-member-count"), "2/2");
  assert.equal(await g.inputValue("#lobby-seconds"), "0");
  await g.click("#room-view-cube");
  await g.waitForSelector("#room-cube-modal:not([hidden])");
  assert.equal(await g.locator("#room-cube-grid article").count(), 1);
  assert.match(await g.textContent("#room-cube-summary"), /8 copies/);
  await g.click("#room-cube-close");
  await h.waitForFunction(() => !document.querySelector("#room-start").disabled);
  assert.equal(await h.evaluate(() => document.querySelector("#room-start").getBoundingClientRect().bottom <= innerHeight), true, "all desktop lobby controls fit the screen");
  await h.click("#room-start");
  await h.waitForSelector("[data-instance]"); await g.waitForSelector("[data-instance]");
  assert.equal(await h.textContent("#seconds"), "∞");
  assert.equal(await h.evaluate(() => document.querySelector("#timer-fill").style.width), "0%");
  assert.equal(await h.evaluate(() => document.querySelector("main").getBoundingClientRect().bottom <= innerHeight + 1), true);
  await h.locator("[data-instance]").first().click(); await h.locator("[data-yes]").click();
  await h.waitForFunction(() => document.querySelector("#pool-count").textContent === "1 cards");
  await h.reload();
  await h.waitForFunction(() => document.querySelector("#pool-count").textContent === "1 cards");
  assert.equal(await h.locator("[data-instance]").count(), 0);
  await g.locator("[data-instance]").first().click(); await g.locator("[data-yes]").click();
  await h.waitForSelector("[data-instance]");
  await h.click("#library-nav"); assert.equal(await h.locator("#library-error").textContent(), "");
  await h.click("#table-nav"); await g.click("#rooms-nav"); await g.click("#room-return");
  await h.click("#rooms-nav"); await h.click("#room-close"); await h.click("#room-confirm");
  await g.waitForSelector("#room-entry:not([hidden])");
  assert.equal(await g.evaluate(() => localStorage.getItem("cube-draft.room.v1")), null);
  assert.match(await g.textContent("#room-status"), /closed by its host/);
  assert.deepEqual(errors, []);
});

test("join errors remain in the dialog and a guest must leave before opening another room", async t => {
  const f = await fixture(t), browser = await browserFixture(t);
  const target = await f.call("", { name: "Target host", cube, config }, null, 201);
  const page = await browser.newPage(); await page.goto(f.url + "/draft");
  await page.fill("#room-name", "Guest"); await page.click("#room-join");
  const missing = target.code === "00000000" ? "00000001" : "00000000";
  await page.fill("#room-code", missing); await page.click("#room-confirm");
  await page.waitForFunction(() => document.querySelector("#room-dialog-error").textContent.includes("Room not found."));
  assert.equal(await page.inputValue("#room-code"), missing);
  await page.fill("#room-code", target.code.toLowerCase()); await page.click("#room-confirm");
  await page.waitForFunction(code => document.querySelector("#active-room-code").textContent === code, target.code);
  assert.equal(await page.locator("#room-create").isHidden(), true);
  assert.equal(await page.locator("#room-close").isHidden(), true);
  await page.click("#room-leave"); await page.waitForSelector("#room-entry:not([hidden])");
  assert.equal(await page.locator("#room-create").isEnabled(), true);
  const next = await createInBrowser(page, "Former guest"); assert.notEqual(next, target.code);
  assert.equal(await page.locator("#room-close").isVisible(), true);
  await page.click("#room-close"); await page.click("#room-confirm");
  await page.waitForSelector("#room-entry:not([hidden])");
  assert.notEqual(await createInBrowser(page, "Host again"), next);
});

test("settings let a guest leave and the host close a completed room despite unresolved export IDs", async t => {
  const f = await fixture(t, { publicOnly: true }), browser = await browserFixture(t);
  const playerId = "c".repeat(64);
  const unresolvedCube = { ...cube, cards: cube.cards.map(card => ({ ...card, origin: "official", duelingbookId: "" })) };
  const host = await f.call("", { name: "Host", cube: unresolvedCube, config: { ...config, rounds: 1, size: 1 } }, null, 201);
  const guest = await f.call(`/${host.code}/join`, { name: "Guest", playerId }, null, 201);
  const started = await f.call(`/${host.code}/start`, {}, host.token);
  await f.call(`/${host.code}/pick`, { round: 1, pick: 1, instanceId: started.pack[0].instanceId }, host.token);
  const guestDraft = await f.call(`/${host.code}`, null, guest.token);
  await f.call(`/${host.code}/pick`, { round: 1, pick: 1, instanceId: guestDraft.pack[0].instanceId }, guest.token);
  const g = await browser.newPage();
  await g.addInitScript(saved => {
    localStorage.setItem("cube-draft.room.v1", JSON.stringify({ code: saved.code, token: saved.token }));
    localStorage.setItem("cube-draft.player.v1", saved.playerId);
  }, { code: host.code, token: guest.token, playerId });
  await g.goto(f.url + "/draft");
  await g.waitForFunction(() => document.querySelector("#pool-count").textContent === "1 cards");
  assert.equal(await g.locator("#export").isDisabled(), true);
  assert.equal(await g.evaluate(() => state.pools[0].some(card => !xmlId(card))), true);
  await g.click("#settings-open");
  assert.equal(await g.locator("#room-lifecycle #room-close").isHidden(), true);
  assert.equal(await g.locator("#room-lifecycle #room-leave").isVisible(), true);
  assert.equal(await g.locator("#room-leave").isEnabled(), true);
  assert.match(await g.textContent("#room-lifecycle-help"), /Only the host \(Host\)/);
  await g.click("#room-leave");
  await g.waitForSelector("#room-entry:not([hidden])");
  const saved = await f.call(`/${host.code}`, null, host.token);
  assert.equal(saved.phase, "finished"); assert.equal(saved.players.length, 2);
  assert.equal(saved.players[1].left, true); assert.equal(saved.pool.length, 1);
  assert.equal((await f.call(`/${host.code}`, null, guest.token)).pool.length, 1, "leaving preserves the completed deck and seat index");
  await createInBrowser(g, "Guest again");
  const h = await browser.newPage();
  await h.addInitScript(saved => localStorage.setItem("cube-draft.room.v1", JSON.stringify(saved)), { code: host.code, token: host.token });
  await h.goto(f.url + "/draft");
  await h.waitForFunction(() => document.querySelector("#pool-count").textContent === "1 cards");
  await h.click("#settings-open");
  assert.equal(await h.locator("#room-lifecycle #room-close").isVisible(), true);
  assert.equal(await h.locator("#room-close").isEnabled(), true);
  await h.click("#room-close"); await h.click("#room-confirm");
  await h.waitForSelector("#room-entry:not([hidden])");
  assert.equal((await f.call(`/${host.code}`, null, host.token)).phase, "closed");
  assert.equal(await h.evaluate(() => localStorage.getItem("cube-draft.room.v1")), null);
});

test("lobby polling preserves selected code, focused settings and unsaved changes", async t => {
  const f = await fixture(t), browser = await browserFixture(t);
  const host = await f.call("", { name: "Host", cube, config }, null, 201);
  const page = await browser.newPage();
  await page.addInitScript(saved => localStorage.setItem("cube-draft.room.v1", JSON.stringify(saved)), { code: host.code, token: host.token });
  await page.goto(f.url + "/draft");
  await page.waitForFunction(() => document.querySelector("#active-room-code").textContent.length === 8);
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector("#active-room-code"));
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  for (let i = 0; i < 2; i++) await page.waitForResponse(r => r.url() === f.url + "/api/rooms/" + host.code);
  assert.equal(await page.evaluate(() => getSelection().toString()), host.code);
  await page.fill("#lobby-seconds", "17"); await page.focus("#lobby-seconds");
  await f.call(`/${host.code}/join`, { name: "Guest" }, null, 201);
  await page.waitForFunction(() => document.querySelector("#room-member-count").textContent === "2/2");
  assert.equal(await page.evaluate(() => document.activeElement.id), "lobby-seconds");
  assert.equal(await page.inputValue("#lobby-seconds"), "17");
  assert.equal(await page.locator("#room-start").isEnabled(), true, "Start Draft can save valid changes automatically");
  await page.click("#lobby-save"); await page.waitForFunction(() => !document.querySelector("#room-start").disabled);
  assert.equal((await f.call(`/${host.code}`, null, host.token)).config.seconds, 17);
});

test("a saved room without a Cube starts with bots and saves pending settings in order", async t => {
  const f = await fixture(t), browser = await browserFixture(t);
  const options = { ...config, players: 3, rounds: 3, size: 15, mainDeckSize: 40 };
  const host = await f.call("", { name: "Legacy host", cube: null, config: options }, null, 201);
  const route = `/${host.code}`;
  await f.call(route + "/add-bot", { slot: 1 }, host.token);
  const page = await browser.newPage(), posts = [];
  page.on("request", r => { if (r.method() === "POST" && r.url().includes("/api/rooms/")) posts.push(new URL(r.url()).pathname); });
  await page.addInitScript(saved => localStorage.setItem("cube-draft.room.v1", JSON.stringify(saved)), { code: host.code, token: host.token });
  await page.goto(f.url + "/draft");
  await page.waitForFunction(() => document.querySelector("#lobby-cube").value === "mock-300");
  assert.equal(await page.locator("#room-start").isDisabled(), true, "a missing seat still blocks the start");
  assert.match(await page.textContent("#room-capacity"), /Mock Cube.*300 copies/);
  assert.equal((await f.call(route, null, host.token)).cube, null, "offering the default does not change the server until the host acts");
  await page.click('[data-room-add-bot="2"]');
  await page.waitForFunction(() => !document.querySelector("#room-start").disabled);
  await page.fill("#lobby-rounds", "12");
  assert.equal(await page.locator("#room-start").isDisabled(), true);
  assert.match(await page.textContent("#room-start-help"), /540 copies.*300/);
  await page.fill("#lobby-rounds", "2"); await page.fill("#lobby-pack-size", "3");
  await page.fill("#lobby-seconds", ""); assert.equal(await page.locator("#room-start").isDisabled(), true);
  await page.fill("#lobby-seconds", "0");
  assert.equal(await page.locator("#room-start").isEnabled(), true);
  assert.match(await page.textContent("#room-start-help"), /save these settings/);
  // A failed save must not send the start request or discard the entered settings.
  await page.route("**/api/rooms/*/settings", r => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary settings failure." }) }));
  posts.length = 0; await page.click("#room-start");
  await page.waitForFunction(() => document.querySelector("#room-error").textContent.includes("Temporary settings failure."));
  assert.deepEqual(posts, [`/api/rooms${route}/settings`]);
  assert.equal((await f.call(route, null, host.token)).phase, "lobby");
  assert.equal(await page.inputValue("#lobby-seconds"), "0");
  await page.unroute("**/api/rooms/*/settings");
  posts.length = 0; await page.click("#room-start");
  await page.waitForSelector("[data-instance]");
  assert.deepEqual(posts, [`/api/rooms${route}/settings`, `/api/rooms${route}/start`]);
  const draft = await f.call(route, null, host.token);
  assert.equal(draft.phase, "drafting"); assert.equal(draft.cube.id, "mock-300");
  assert.equal(draft.config.rounds, 2); assert.equal(draft.config.size, 3); assert.equal(draft.config.seconds, 0);
  assert.ok(draft.players.filter(p => p.bot).every(p => p.picked && p.count === 1));
  assert.equal(await page.textContent("#seconds"), "∞");
});

test("Cube gallery includes every card with search and pagination", async t => {
  const f = await fixture(t), browser = await browserFixture(t);
  const big = { ...cube, cards: Array.from({ length: 51 }, (_, i) => ({ ...cube.cards[0], id: String(i), name: `Card ${String(i).padStart(2,"0")}`, copies: 1 })) };
  const host = await f.call("", { name: "Host", cube: big, config }, null, 201);
  const page = await browser.newPage();
  await page.addInitScript(saved => localStorage.setItem("cube-draft.room.v1", JSON.stringify(saved)), { code: host.code, token: host.token });
  await page.goto(f.url + "/draft"); await page.waitForSelector("#room-lobby:not([hidden])");
  await page.click("#room-view-cube"); await page.waitForSelector("#room-cube-grid article");
  assert.equal(await page.locator("#room-cube-grid article").count(), 48);
  await page.click("#room-cube-next"); assert.equal(await page.locator("#room-cube-grid article").count(), 3);
  await page.fill("#room-cube-search", "card 50"); assert.equal(await page.locator("#room-cube-grid article").count(), 1);
  await page.keyboard.press("Escape"); assert.equal(await page.locator("#room-cube-modal").isHidden(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "mobile lobby has no horizontal overflow");
});

test("lobby bots replace the simulator, removed guests return to entry, and deck type counts update throughout",async t=>{
  const f=await fixture(t),browser=await browserFixture(t),h=await browser.newPage(),g=await browser.newPage();
  const errors=[];for(const p of [h,g])p.on("pageerror",e=>errors.push(e.message));
  await h.goto(f.url+"/draft?simulate=1");await g.goto(f.url+"/draft");
  assert.equal(await h.evaluate(()=>state),null,"the old query cannot auto-start a simulation");
  assert.equal((await fetch(f.url+"/simulate")).status,404);
  assert.equal(await h.locator("#simulation-nav").count(),0);
  await h.click("#library-nav");assert.equal(await h.locator('[data-cube="mock-300"]').count(),1);
  await h.click("#rooms-nav");const code=await createInBrowser(h);
  assert.equal(await h.inputValue("#lobby-cube"),"mock-300");
  await joinInBrowser(g,code);
  assert.equal(await g.locator("[data-room-remove],[data-room-add-bot]").count(),0);
  await h.waitForSelector("[data-room-remove]");
  await h.click("[data-room-remove]");await g.waitForSelector("#room-entry:not([hidden])");
  assert.match(await g.textContent("#room-status"),/removed.*host/);
  assert.equal(await g.evaluate(()=>localStorage.getItem("cube-draft.room.v1")),null);
  await h.click('[data-room-add-bot="1"]');await h.waitForFunction(()=>document.querySelector("#room-member-count").textContent==="2/2");
  assert.match(await h.textContent("#room-members"),/Bot 1/);
  await h.click("[data-room-remove]");await h.waitForSelector('[data-room-add-bot="1"]');
  await h.click('[data-room-add-bot="1"]');await h.waitForFunction(()=>document.querySelector("#room-member-count").textContent==="2/2");
  for(const [id,value] of [["lobby-main-size","20"],["lobby-rounds","2"],["lobby-pack-size","3"],["lobby-seconds","0"]])await h.fill("#"+id,value);
  await h.click("#lobby-save");await h.waitForFunction(()=>!document.querySelector("#room-start").disabled);
  await h.click("#room-start");await h.waitForSelector("[data-instance]");
  const counts={monster:0,spell:0,trap:0,fusion:0,xyz:0,synchro:0,link:0};
  assert.equal(await h.locator("#deck-stats").isVisible(),true);
  for(let i=0;i<6;i++){
    const frame=await h.evaluate(()=>state.packs[0][0].visual.frame);
    counts[["spell","trap","fusion","xyz","synchro","link"].includes(frame)?frame:"monster"]++;
    await h.locator("[data-instance]").first().click();await h.locator("[data-yes]").click();
    await h.waitForFunction(n=>document.querySelector("#pool-count").textContent===n+" cards",i+1);
    for(const kind of ["monster","spell","trap"])assert.equal(await h.textContent("#main-"+kind+"-count"),String(counts[kind]));
    for(const kind of ["fusion","xyz","synchro","link"])assert.equal(await h.textContent("#extra-"+kind+"-count"),String(counts[kind]));
  }
  assert.equal(await h.locator("#final-deck-panel").isVisible(),true);
  assert.equal(await h.locator("#deck-stats").isVisible(),true);
  assert.equal(await h.textContent("#total-count"),"6");
  assert.equal(await h.locator("#export").isDisabled(),true,"fictional cards have no invented export IDs");
  await h.reload();await h.waitForFunction(()=>document.querySelector("#pool-count").textContent==="6 cards");
  assert.deepEqual(errors,[]);
});

test("host end-session buttons work mid-draft and post-draft while guests return to the same lobby", async t => {
  const f = await fixture(t), browser = await browserFixture(t);
  const options = { ...config, players: 3, rounds: 1, size: 2, seconds: 0, mainDeckSize: 20 };
  const host = await f.call("", { name: "Host", config: options }, null, 201), route = `/${host.code}`;
  const guest = await f.call(route + "/join", { name: "Guest" }, null, 201);
  await f.call(route + "/add-bot", { slot: 2 }, host.token);
  const h = await browser.newPage(), g = await browser.newPage(), errors = [];
  for (const [page, token] of [[h, host.token], [g, guest.token]]) {
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(saved => localStorage.setItem("cube-draft.room.v1", JSON.stringify(saved)), { code: host.code, token });
    await page.goto(f.url + "/draft"); await page.waitForSelector("#room-lobby:not([hidden])");
    assert.equal(await page.locator("#room-end-session").isHidden(), true);
    assert.equal(await page.locator("#draft-end-session").isHidden(), true);
  }
  await h.click("#room-start"); await g.waitForSelector("[data-instance]");
  assert.equal(await h.locator("#draft-end-session").isVisible(), true);
  assert.equal(await g.locator("#draft-end-session").isHidden(), true);
  await g.click("#settings-open"); assert.equal(await g.locator("#room-end-session").isHidden(), true);
  await g.click("#room-return");
  await g.locator("[data-instance]").first().click(); await g.locator("[data-details]").click();
  await g.waitForSelector("#card-modal:not([hidden])");
  await h.click("#draft-end-session"); await h.click("#room-dialog-cancel");
  assert.equal((await f.call(route, null, host.token)).phase, "drafting", "canceling does not end the draft");
  await h.click("#draft-end-session"); await h.click("#room-confirm");
  for (const page of [h, g]) {
    await page.waitForSelector("#room-lobby:not([hidden])");
    assert.equal(await page.locator("#card-modal").isHidden(), true);
    assert.equal(await page.textContent("#active-room-code"), host.code);
    assert.equal(await page.textContent("#room-member-count"), "3/3");
    assert.equal(await page.evaluate(() => state), null);
    assert.equal(await page.locator("#room-end-session").isHidden(), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cube-draft.room.v1")).code), host.code);
  }
  assert.equal(await h.locator("#room-start").isEnabled(), true);
  assert.equal(await h.locator("#lobby-main-size").isEnabled(), true);
  await h.click("#room-start"); await g.waitForSelector("[data-instance]");
  for (let n = 1; n <= 2; n++) {
    for (const page of [h, g]) {
      await page.locator("[data-instance]").first().click(); await page.locator("[data-yes]").click();
      await page.waitForFunction(count => document.querySelector("#pool-count").textContent === count + " cards", n);
    }
  }
  await h.waitForSelector("#final-deck-panel:not([hidden])");
  assert.equal(await h.locator("#draft-end-session").isVisible(), true);
  assert.equal(await g.locator("#draft-end-session").isHidden(), true);
  await h.click("#settings-open"); assert.equal(await h.locator("#room-end-session").isVisible(), true);
  await h.click("#room-end-session"); await h.click("#room-confirm");
  await g.waitForSelector("#room-lobby:not([hidden])");
  await h.reload(); await h.waitForSelector("#room-lobby:not([hidden])");
  assert.equal(await h.textContent("#active-room-code"), host.code);
  assert.equal(await h.locator("#room-start").isEnabled(), true);
  assert.equal(fs.readdirSync(path.join(f.root, "rooms", "sessions", host.code)).length, 2);
  assert.deepEqual(errors, []);
});

test("draft refreshes preserve focused card text and an open card reader after a saved pick", async t => {
  const f = await fixture(t);
  const host = await f.call("", { name: "Host", cube, config }, null, 201);
  await f.call(`/${host.code}/join`, { name: "Guest" }, null, 201);
  const draft = await f.call(`/${host.code}/start`, {}, host.token);
  await f.call(`/${host.code}/pick`, { round: draft.round, pick: draft.pick, instanceId: draft.pack[0].instanceId }, host.token);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(saved => localStorage.setItem("cube-draft.room.v1", JSON.stringify(saved)), { code: host.code, token: host.token });
  await page.goto(f.url + "/draft");
  await page.waitForFunction(() => document.querySelector("#pool-count").textContent === "1 cards");
  await page.focus("#card-details .detail-text");
  for (let i = 0; i < 2; i++) await page.waitForResponse(response => response.url() === f.url + "/api/rooms/" + host.code);
  assert.equal(await page.locator("#card-details .detail-text").evaluate(node => document.activeElement === node), true, "the renderer must not rebuild card details every second");
  await page.locator("[data-pool]").first().click();
  await page.waitForSelector("#card-modal:not([hidden])");
  await page.focus("#modal-details .detail-text");
  for (let i = 0; i < 2; i++) await page.waitForResponse(response => response.url() === f.url + "/api/rooms/" + host.code);
  assert.equal(await page.locator("#card-modal").isVisible(), true);
  assert.equal(await page.locator("#modal-details .detail-text").evaluate(node => document.activeElement === node), true);
});

test("another player's pick preserves a focused reader and the pending pick confirmation", async t => {
  const f = await fixture(t);
  const options = { ...config, players: 3 };
  const largeCube = { ...cube, cards: cube.cards.map(card => ({ ...card, copies: 12 })) };
  const host = await f.call("", { name: "Host", cube: largeCube, config: options }, null, 201);
  const guest = await f.call(`/${host.code}/join`, { name: "Guest" }, null, 201);
  await f.call(`/${host.code}/join`, { name: "Third" }, null, 201);
  await f.call(`/${host.code}/start`, {}, host.token);
  const guestDraft = await f.call(`/${host.code}`, null, guest.token);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(saved => localStorage.setItem("cube-draft.room.v1", JSON.stringify(saved)), { code: host.code, token: host.token });
  await page.goto(f.url + "/draft");
  await page.locator("[data-instance]").first().click();
  const selectedId = await page.locator("[data-details]").getAttribute("data-details");
  await page.locator("[data-details]").click();
  await page.focus("#modal-details .detail-text");
  await f.call(`/${host.code}/pick`, { round: guestDraft.round, pick: guestDraft.pick, instanceId: guestDraft.pack[0].instanceId }, guest.token);
  await page.waitForFunction(() => document.querySelector("#seats").textContent.includes("Guest: 1 picks · ready"));
  assert.equal(await page.locator("#card-modal").isVisible(), true);
  assert.equal(await page.locator("#modal-details .detail-text").evaluate(node => document.activeElement === node), true);
  assert.equal(await page.locator("[data-details]").getAttribute("data-details"), selectedId);
  await page.click("#modal-confirm");
  await page.waitForFunction(() => document.querySelector("#pool-count").textContent === "1 cards");
  assert.equal(await page.locator("#card-modal").isHidden(), true, "the reader still closes when its pick is actually submitted");
});
