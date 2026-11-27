"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { isCubeExport, hasCardName, hasValidCopies } = require("../../shared/cube-format.cjs");
const linkDirections = new Set(["top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left", "top-left"]);
function createCubeDatabase(dataRoot) {
  fs.mkdirSync(dataRoot, { recursive: true });
  const db = new DatabaseSync(path.join(dataRoot, "cubes.sqlite"));
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cubes(id TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cube_cards(cube_id TEXT NOT NULL REFERENCES cubes(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id), copies INTEGER NOT NULL CHECK(copies BETWEEN 1 AND 1000),
      PRIMARY KEY(cube_id, card_id));
    CREATE INDEX IF NOT EXISTS cube_cards_card ON cube_cards(card_id);`);
  const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
  const owner = req => {
    const id = req.headers["x-cube-owner"];
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) fail("This browser needs a Cube identity.", 401);
    return createHash("sha256").update(id).digest("hex");
  };
  function cube(id) {
    const row = db.prepare("SELECT id,name,owner FROM cubes WHERE id=?").get(id);
    if (!row) fail("Cube not found.", 404);
    return row;
  }
  function card(id) {
    const row = db.prepare("SELECT data FROM cards WHERE id=?").get(id);
    if (!row) fail("Card not found in the shared catalog.", 404);
    return JSON.parse(row.data);
  }
  function detail(row, viewer) {
    return { id: row.id, name: row.name, editable: row.owner === viewer,
      cards: db.prepare("SELECT card_id,copies FROM cube_cards WHERE cube_id=? ORDER BY rowid").all(row.id)
        .map(entry => ({ ...card(entry.card_id), copies: entry.copies })) };
  }
  const list = viewer => db.prepare("SELECT id,name,owner FROM cubes ORDER BY rowid DESC").all().map(row => detail(row, viewer));
  function validateName(value) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 100) fail("Cube name must be 1–100 characters.");
    return value.trim();
  }
  function validateCard(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string" || !value.id || value.id.length > 200 || !hasCardName(value)) fail("Every imported card needs an ID and name.");
    if (!hasValidCopies(value, 1000)) fail("Card copies must be a whole number from 1 to 1,000.");
  }
  function fillMissingCardStats(saved, source) {
    if (!source) return null;
    const visual = { ...saved.visual };
    const type = String(saved.type || "");
    const frame = String(visual.frame || saved.frame || "").split(/[?#]/)[0].split("/").pop();
    const fields = [];
    if (/\bxyz\b/i.test(type) || /(?:^|_)xyz(?:_|\.|$)/i.test(frame)) fields.push("rank");
    if (visual.pendulum || /\bpendulum\b/i.test(type) || /pendulum/i.test(frame) || saved.pendulumEffect) {
      fields.push("scaleLeft", "scaleRight");
    }
    let added = false;
    for (const field of fields) {
      const value = source[field];
      if ((visual[field] == null || visual[field] === "") &&
        (typeof value === "number" || typeof value === "string") && /^\d{1,2}$/.test(String(value))) {
        visual[field] = Number(value);
        added = true;
      }
    }
    const isLink = /\blink\b/i.test(type) || /(?:^|_)link(?:_|\.|$)/i.test(frame);
    const arrows = source.linkArrows;
    const previous = visual.linkArrows;
    const missingArrows = previous == null || (Array.isArray(previous) && previous.length === 0);
    const rating = /^(?:link(?: rating)?[\s:-]*)?([1-8])$/i.exec(String(saved.link ?? saved.linkRating ?? "").trim())?.[1];
    if (isLink && missingArrows && Array.isArray(arrows) && arrows.length > 0 &&
      arrows.every(direction => linkDirections.has(direction)) &&
      new Set(arrows).size === arrows.length && (!rating || arrows.length === Number(rating))) {
      visual.linkArrows = arrows;
      added = true;
    }
    if (!added) return null;
    visual.version ??= 1;
    return visual;
  }
  function restoresLineBreaks(before, after) {
    if (typeof before !== "string" || typeof after !== "string" || !/[\r\n]/.test(after) ||
      before.replace(/\s/g, "") !== after.replace(/\s/g, "")) return false;
    function breakPositions(text) {
      let offset = 0;
      return text.split(/\r\n?|\n/).slice(0, -1).map(line => {
        offset += line.replace(/\s/g, "").length;
        return offset;
      });
    }
    const existing = breakPositions(before);
    const incoming = breakPositions(after);
    if (incoming.length <= existing.length) return false;
    let matched = 0;
    for (const position of incoming) {
      if (position === existing[matched]) matched++;
    }
    return matched === existing.length;
  }
  function enrichCard(saved, incoming) {
    const artworkPath = artwork => typeof artwork === "string" ? artwork.split(/[?#]/)[0] : "";
    if (saved.name !== incoming.name || saved.origin !== incoming.origin ||
      artworkPath(saved.artwork) !== artworkPath(incoming.artwork)) return null;
    const changes = {};
    const visual = fillMissingCardStats(saved, incoming.visual);
    if (visual) changes.visual = visual;
    for (const field of ["effect", "pendulumEffect"]) {
      const before = saved[field], after = incoming[field];
      // Accept the source formatting when a fresh import has the same text
      // and restores breaks that the old scanner flattened.
      if (restoresLineBreaks(before, after)) changes[field] = after;
    }
    return Object.keys(changes).length ? { ...saved, ...changes } : null;
  }
  function transact(work) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = work(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  const handle = async (req, res, respond) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (!pathname.startsWith("/api/cubes")) return false;
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) fail("Use the same server for Cube changes.", 403);
      const currentOwner = owner(req);
      let body = {};
      if (["POST", "PATCH", "DELETE"].includes(req.method)) {
        if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) fail("Expected application/json.", 415);
        let size = 0; const chunks = [];
        for await (const part of req) { size += part.length; if (size > 10 * 1024 * 1024) fail("Cube request exceeds 10 MB.", 413); chunks.push(part); }
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { fail("Invalid JSON."); }
        if (!body || typeof body !== "object" || Array.isArray(body)) fail("Invalid Cube request.");
      }
      if (req.method === "GET" && pathname === "/api/cubes") return respond(res, 200, { cubes: list(currentOwner) }), true;
      if (req.method === "POST" && pathname === "/api/cubes") {
        const id = randomUUID(), name = validateName(body.name);
        db.prepare("INSERT INTO cubes VALUES(?,?,?)").run(id, name, currentOwner);
        return respond(res, 201, { cube: detail(cube(id), currentOwner) }), true;
      }
      if (req.method === "POST" && pathname === "/api/cubes/import") {
        const data = body.cube;
        if (!isCubeExport(data) || !data.cards.length || data.cards.length > 10000) fail("Import a non-empty dbcd-cube-v1 Cube.");
        const name = validateName(body.name || data.name), id = typeof body.id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(body.id) ? body.id : randomUUID();
        if (db.prepare("SELECT id FROM cubes WHERE id=?").get(id)) fail("Cube ID already exists.", 409);
        const seen = new Set();
        for (const entry of data.cards) { validateCard(entry); if (seen.has(entry.id)) fail("Duplicate card ID in Cube."); seen.add(entry.id); }
        const result = transact(() => {
          db.prepare("INSERT INTO cubes VALUES(?,?,?)").run(id, name, currentOwner);
          const insertCard = db.prepare("INSERT OR IGNORE INTO cards VALUES(?,?)");
          const updateCard = db.prepare("UPDATE cards SET data=? WHERE id=?");
          const insertMembership = db.prepare("INSERT INTO cube_cards VALUES(?,?,?)");
          for (const entry of data.cards) {
            const { copies, ...metadata } = entry;
            if (insertCard.run(entry.id, JSON.stringify(metadata)).changes === 0) {
              const enriched = enrichCard(card(entry.id), metadata);
              if (enriched) updateCard.run(JSON.stringify(enriched), entry.id);
            }
            insertMembership.run(id, entry.id, copies);
          }
          return detail(cube(id), currentOwner);
        });
        return respond(res, 201, { cube: result }), true;
      }
      const match = /^\/api\/cubes\/([a-zA-Z0-9-]{1,100})(?:\/cards\/([^/]+))?$/.exec(pathname);
      if (!match) fail("Cube route not found.", 404);
      const target = cube(match[1]);
      if (req.method === "GET" && !match[2]) return respond(res, 200, { cube: detail(target, currentOwner) }), true;
      if (target.owner !== currentOwner) fail("Only the Cube creator can edit it.", 403);
      if (req.method === "PATCH" && !match[2]) {
        db.prepare("UPDATE cubes SET name=? WHERE id=?").run(validateName(body.name), target.id);
        return respond(res, 200, { cube: detail(cube(target.id), currentOwner) }), true;
      }
      if (req.method === "DELETE" && !match[2]) {
        db.prepare("DELETE FROM cubes WHERE id=?").run(target.id);
        // Cards remain in the common catalog and in other Cubes.
        return respond(res, 200, { deleted: true }), true;
      }
      if (req.method === "POST" && !match[2]) {
        const source = cube(body.sourceCubeId);
        const sourceEntry = db.prepare("SELECT copies FROM cube_cards WHERE cube_id=? AND card_id=?").get(source.id, body.cardId);
        if (!sourceEntry) fail("Choose a card from the selected source Cube.", 404);
        const copies = body.copies ?? 1;
        if (!Number.isInteger(copies) || copies < 1 || copies > 1000) fail("Copies must be a whole number from 1 to 1,000.");
        const existing = db.prepare("SELECT copies FROM cube_cards WHERE cube_id=? AND card_id=?").get(target.id, body.cardId);
        if (existing && existing.copies + copies > 1000) fail("This Cube cannot hold more than 1,000 copies of one card.");
        db.prepare("INSERT INTO cube_cards VALUES(?,?,?) ON CONFLICT(cube_id,card_id) DO UPDATE SET copies=copies+excluded.copies").run(target.id, body.cardId, copies);
        return respond(res, 200, { cube: detail(target, currentOwner) }), true;
      }
      if (match[2]) {
        let cardId; try { cardId = decodeURIComponent(match[2]); } catch { fail("Invalid card ID."); }
        if (req.method === "PATCH") {
          if (!Number.isInteger(body.copies) || body.copies < 1 || body.copies > 1000) fail("Copies must be a whole number from 1 to 1,000.");
          if (!db.prepare("SELECT 1 FROM cube_cards WHERE cube_id=? AND card_id=?").get(target.id, cardId)) fail("Card is not in this Cube.", 404);
          db.prepare("UPDATE cube_cards SET copies=? WHERE cube_id=? AND card_id=?").run(body.copies, target.id, cardId);
          return respond(res, 200, { cube: detail(target, currentOwner) }), true;
        }
        if (req.method === "DELETE") {
          db.prepare("DELETE FROM cube_cards WHERE cube_id=? AND card_id=?").run(target.id, cardId);
          return respond(res, 200, { cube: detail(target, currentOwner) }), true;
        }
      }
      fail("Method not allowed.", 405);
    } catch (error) { respond(res, error.status || 500, { error: error.status ? error.message : "Cube database failed." }); }
    return true;
  };
  handle.close = () => db.close();
  return handle;
}
module.exports = { createCubeDatabase };
