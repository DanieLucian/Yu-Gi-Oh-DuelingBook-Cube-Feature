"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomInt, randomUUID, createHash } = require("node:crypto");
const MockCube = require("./mock-cube.js");
const hash = value => createHash("sha256").update(value).digest("hex");
function createRooms(dataRoot) {
  const directory = path.join(dataRoot, "rooms");
  fs.mkdirSync(directory, { recursive: true });
  const rooms = new Map();
  for (const file of fs.readdirSync(directory).filter(f => /^[A-F0-9]{8}\.json$/.test(f))) {
    const room = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
    room.players.forEach((p, i) => { p.slot ??= i; });
    rooms.set(room.code, room);
  }
  function fail(message, status = 400, code) { throw Object.assign(Error(message), { status, code }); }
  const memberId = p => p.id || hash(p.credential).slice(0, 24);
  const freeSlot = room => Array.from({ length: room.config.players }, (_, i) => i).find(i => !room.players.some(p => p.slot === i));
  const resolveCube = input => input?.id === MockCube.id ? MockCube.create() : input;
  function save(room) {
    const file = path.join(directory, room.code + ".json");
    fs.writeFileSync(file + ".tmp", JSON.stringify(room), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
    rooms.set(room.code, room);
  }
  function player(name) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 40) fail("Enter a player name (1–40 characters).");
    const token = randomBytes(32).toString("hex");
    return { token, record: { id: randomUUID(), name: name.trim(), credential: hash(token), pool: [], picked: false } };
  }
  function endSession(room, expectedSessionId) {
    if (!["drafting", "finished"].includes(room.phase)) fail("There is no drafting session to end.", 409);
    if ((expectedSessionId ?? null) !== (room.sessionId ?? null)) fail("The drafting session has changed. Refresh the room before ending it.", 409);
    const id = room.sessionId || randomUUID();
    const history = path.join(directory, "sessions", room.code);
    fs.mkdirSync(history, { recursive: true });
    const archive = path.join(history, id + ".json");
    fs.writeFileSync(archive + ".tmp", JSON.stringify({ ...room, sessionId: id, endedAt: new Date().toISOString() }), { mode: 0o600 });
    fs.renameSync(archive + ".tmp", archive);
    // Guests who already left a completed draft must not reoccupy their seats.
    room.players = room.players.filter(p => !p.left);
    for (const p of room.players) { p.pool = []; p.picked = false; delete p.deckOrder; }
    room.phase = "lobby"; room.sessionId = null;
    room.stock = []; room.packs = []; room.round = 0; room.pick = 0; room.deadline = null;
  }
  const defaults = { players: 4, rounds: 3, size: 15, seconds: 30, mainDeckSize: 40 };
  function settings(input) {
    const c = { ...defaults, ...input };
    for (const [key, min, max] of [["players",2,6],["rounds",1,12],["size",1,30],["seconds",0,300],["mainDeckSize",20,60]])
      if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) fail("Invalid draft settings.");
    return Object.fromEntries(Object.keys(defaults).map(key => [key, c[key]]));
  }
  function validateCube(cube) {
    if (!cube || cube.sample || !Array.isArray(cube.cards) || !cube.cards.length || cube.cards.length > 10000 || typeof cube.name !== "string") fail("Import a valid Cube first.");
    let count = 0;
    for (const card of cube.cards) {
      if (!card || typeof card.name !== "string" || !card.name.trim() || !Number.isInteger(card.copies) || card.copies < 1 || card.copies > 1000) fail("Invalid Cube card or copy count.");
      count += card.copies;
    }
    if (count > 100000) fail("Cube exceeds 100,000 copies.");
    return count;
  }
  function identity(value) {
    if (value == null) return null; // Retain compatibility with saved/legacy seats.
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("Invalid player identity.");
    return hash(value);
  }
  function assertAvailable(owner, token, exceptCode) {
    for (const room of rooms.values()) {
      if (room.phase === "closed" || room.code === exceptCode) continue;
      if (room.players.some(p => !p.left && ((owner && p.owner === owner) || (token && p.credential === hash(token)))))
        fail("You are already in a room. Close your hosted room or leave your current room first.", 409);
    }
  }
  const deadline = room => room.config.seconds === 0 ? null : Date.now() + room.config.seconds * 1000;
  function startIssue(room) {
    if (room.players.length !== room.config.players) return "Wait for every player before starting.";
    if (!room.cube) return "Select and save a Cube before starting.";
    if (validateCube(room.cube) < room.config.players * room.config.rounds * room.config.size) return "The selected Cube does not have enough copies for this room.";
    return null;
  }
  function deal(room) {
    room.round++; room.pick = 1;
    room.packs = room.players.map(() => room.stock.splice(0, room.config.size));
    room.deadline = deadline(room);
  }
  function choose(room, seat, id) {
    const p = room.players[seat];
    if (p.picked) fail("You have already picked from this pack.", 409);
    const index = room.packs[seat].findIndex(c => c.instanceId === id);
    if (index < 0) fail("This card is no longer in your pack.", 409);
    p.pool.push(room.packs[seat].splice(index, 1)[0]); p.picked = true;
  }
  function pickBots(room) {
    if (room.phase !== "drafting") return;
    room.players.forEach((p, seat) => {
      if (p.bot && !p.picked) {
        const pack = room.packs[seat];
        choose(room, seat, pack[randomInt(pack.length)].instanceId);
      }
    });
  }
  function advance(room) {
    if (!room.players.every(p => p.picked)) return;
    room.players.forEach(p => { p.picked = false; });
    if (!room.packs[0].length) {
      if (room.round === room.config.rounds) { room.phase = "finished"; room.deadline = null; }
      else deal(room);
    } else {
      const direction = room.round % 2 ? 1 : -1;
      const passed = []; room.packs.forEach((pack, seat) => { passed[(seat + direction + room.config.players) % room.config.players] = pack; });
      room.packs = passed; room.pick++; room.deadline = deadline(room);
    }
    pickBots(room);
  }
  function expire(room) {
    if (room.phase !== "drafting" || room.deadline == null || Date.now() < room.deadline) return;
    room.players.forEach((p, seat) => {
      if (!p.picked) choose(room, seat, room.packs[seat][randomInt(room.packs[seat].length)].instanceId);
    });
    advance(room);
  }
  function snapshot(room, seat) {
    return { code: room.code, phase: room.phase, sessionId: room.sessionId || null, host: seat === 0, config: room.config,
      cube: room.cube ? { id: room.cube.id, name: room.cube.name, sample: false, mock: Boolean(room.cube.mock), uniqueCards: room.cube.cards.length, copies: room.cube.cards.reduce((n,c) => n + c.copies, 0) } : null,
      canStart: room.phase === "lobby" && !startIssue(room),
      startIssue: room.phase === "lobby" ? startIssue(room) : null,
      players: room.players.map((p, i) => ({ id: memberId(p), slot: p.slot, name: p.name, bot: Boolean(p.bot), host: i === 0, you: i === seat, count: p.pool.length, picked: p.picked, left: Boolean(p.left) })),
      round: room.round, pick: room.pick, deadline: room.deadline,
      pack: room.players[seat].picked ? [] : room.packs[seat] || [], pool: room.players[seat].pool,
      deckOrder: room.players[seat].deckOrder || null };
  }
  const handle = async function(req, res, respond) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/rooms")) return false;
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) fail("Use the same server to access rooms.", 403);
      let body = {};
      if (req.method === "POST") {
        if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) fail("Expected application/json.", 415);
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) fail("Room request exceeds 8 MB.", 413); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { fail("Invalid JSON."); }
        if (!body || typeof body !== "object") fail("Invalid request.");
      }
      if (url.pathname === "/api/rooms" && req.method === "POST") {
        if (rooms.size >= 500) fail("Room storage is full. Contact the server operator.", 503);
        const c = settings(body.config), cube = resolveCube(Object.hasOwn(body, "cube") ? body.cube : MockCube.create());
        if (cube) validateCube(cube);
        const p = player(body.name);
        p.record.slot = 0;
        p.record.owner = identity(body.playerId);
        assertAvailable(p.record.owner, (req.headers.authorization || "").replace(/^Bearer /, ""));
        let code; do { code = randomBytes(4).toString("hex").toUpperCase(); } while (rooms.has(code));
        const room = { code, cube, config: Object.fromEntries(["players","rounds","size","seconds","mainDeckSize"].map(k => [k,c[k]])), phase: "lobby", players: [p.record], stock: [], packs: [], round: 0, pick: 0 };
        save(room); respond(res, 201, { ...snapshot(room, 0), token: p.token }); return true;
      }
      const match = /^\/api\/rooms\/([A-F0-9]{8})(?:\/(join|start|pick|deck|settings|cube|close|leave|add-bot|remove-player|end-session))?$/.exec(url.pathname);
      if (!match || !rooms.has(match[1])) fail("Room not found.", 404);
      const original = rooms.get(match[1]);
      const room = structuredClone(original);
      const action = match[2];
      if (req.method === "POST" && action === "join") {
        if (room.phase !== "lobby" || room.players.length >= room.config.players) fail("This room has started or is full.", 409);
        const p = player(body.name); p.record.owner = identity(body.playerId);
        p.record.slot = freeSlot(room);
        assertAvailable(p.record.owner, (req.headers.authorization || "").replace(/^Bearer /, ""));
        room.players.push(p.record); room.players.sort((a, b) => a.slot - b.slot); save(room);
        respond(res, 201, { ...snapshot(room, room.players.indexOf(p.record)), token: p.token }); return true;
      }
      const token = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (room.removedCredentials?.includes(hash(token))) fail("You were removed from the room by its host.", 403, "ROOM_REMOVED");
      const seat = room.players.findIndex(p => p.credential === hash(token));
      if (seat < 0) fail("This browser does not have a resume credential for that seat.", 401);
      if (req.method !== "GET" && req.method !== "POST") fail("Method not allowed.", 405);
      if (req.method === "GET" && action && action !== "cube" || req.method === "POST" && !["start","pick","deck","settings","close","leave","add-bot","remove-player","end-session"].includes(action)) fail("Unknown room action.", 404);
      if (req.method === "GET" && action === "cube") {
        if (!room.cube) fail("No Cube selected.", 404);
        respond(res, 200, { cube: room.cube }); return true;
      }
      if (req.method === "POST" && ["settings", "close", "add-bot", "remove-player", "end-session"].includes(action) && seat !== 0) fail("Only the host can manage the room.", 403);
      if (req.method === "POST" && action === "end-session") endSession(room, body.sessionId);
      if (req.method === "POST" && ["add-bot", "remove-player"].includes(action)) {
        if (room.phase !== "lobby") fail("Players and bots can only be changed before drafting starts.", 409);
        if (action === "add-bot") {
          if (!Number.isInteger(body.slot) || body.slot < 1 || body.slot >= room.config.players) fail("Choose an empty player slot.");
          if (room.players.some(p => p.slot === body.slot)) fail("This player slot is already occupied.", 409);
          room.botNumber = (room.botNumber || 0) + 1;
          room.players.push({ id: randomUUID(), slot: body.slot, name: `Bot ${room.botNumber}`, bot: true, credential: null, pool: [], picked: false });
          room.players.sort((a, b) => a.slot - b.slot);
        } else {
          const target = room.players.findIndex(p => memberId(p) === body.playerId);
          if (target === 0) fail("The host cannot be removed.", 400);
          if (target < 0) fail("This player is no longer in the room.", 409);
          const [removed] = room.players.splice(target, 1);
          if (!removed.bot) (room.removedCredentials ??= []).push(removed.credential);
        }
      }
      if (req.method === "POST" && action === "close") {
        room.phase = "closed"; room.deadline = null;
      }
      if (req.method === "POST" && action === "leave") {
        if (seat === 0) fail("The host must close the room.", 409);
        if (!["lobby", "finished"].includes(room.phase)) fail("Wait until drafting is complete, or ask the host to close the room.", 409);
        // Keep completed seat indexes, credentials and decks intact for all players.
        if (room.phase === "finished") room.players[seat].left = true;
        else room.players.splice(seat, 1);
        save(room); respond(res, 200, { left: true }); return true;
      }
      if (req.method === "POST" && action === "settings") {
        if (room.phase !== "lobby") fail("Settings can only change before the draft starts.", 409);
        if (body.config?.players != null && body.config.players !== room.config.players) fail("Room capacity is fixed when the room is created.");
        room.config = settings({ ...room.config, ...body.config });
        if (Object.hasOwn(body, "cube")) { const selected = resolveCube(body.cube); if (selected) validateCube(selected); room.cube = selected || null; }
      }
      expire(room);
      if (req.method === "POST" && action === "start") {
        if (seat !== 0) fail("Only the host can start the draft.", 403);
        if (room.phase !== "lobby") fail("The draft has already started or the room is closed.", 409);
        const issue = startIssue(room); if (issue) fail(issue, 409);
        for (const card of room.cube.cards) for (let i = 0; i < card.copies; i++) room.stock.push({ ...card, deckSection: undefined, instanceId: randomUUID() });
        for (let i = room.stock.length - 1; i > 0; i--) { const j = randomInt(i + 1); [room.stock[i], room.stock[j]] = [room.stock[j], room.stock[i]]; }
        room.phase = "drafting"; room.sessionId = randomUUID(); deal(room); pickBots(room);
      }
      if (req.method === "POST" && action === "pick") {
        if (room.phase !== "drafting" || body.round !== room.round || body.pick !== room.pick) fail("The pack has changed. Choose from the current pack.", 409);
        choose(room, seat, body.instanceId); advance(room);
      }
      if (req.method === "POST" && action === "deck") {
        if (room.phase !== "finished" || !Array.isArray(body.cards)) fail("Finish drafting before saving your deck.", 409);
        const pool = room.players[seat].pool;
        if (body.cards.length !== pool.length || new Set(body.cards.map(c => c.instanceId)).size !== pool.length) fail("Invalid deck cards.");
        room.players[seat].pool = body.cards.map(c => {
          const card = pool.find(p => p.instanceId === c.instanceId);
          if (!card || !["main","side","extra"].includes(c.deckSection)) fail("Invalid deck card.");
          return { ...card, deckSection: c.deckSection };
        });
        room.players[seat].deckOrder = body.cards.map(c => c.instanceId);
      }
      if (JSON.stringify(original) !== JSON.stringify(room)) save(room);
      respond(res, 200, snapshot(room, seat));
    } catch (error) { respond(res, error.status || 500, { error: error.status ? error.message : "Unable to save room. Try again.", ...(error.code === "ROOM_REMOVED" ? { code: error.code } : {}) }); }
    return true;
  };
  handle.tick = () => {
    for (const saved of rooms.values()) {
      if (saved.phase !== "drafting" || !(saved.players.some(p => p.bot && !p.picked) || saved.deadline != null && Date.now() >= saved.deadline)) continue;
      try { const room = structuredClone(saved); pickBots(room); expire(room); advance(room); save(room); }
      catch (error) { console.error("Unable to persist draft timer:", error.message); }
    }
  };
  return handle;
}
module.exports = { createRooms };
