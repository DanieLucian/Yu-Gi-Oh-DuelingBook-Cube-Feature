"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadAssets, loadLocalTypeFont, renderCard } = require("./render.cjs");
const { testerState, testerHtml } = require("./tester-build.cjs");
const style = require("./style.default.json");
const pack = path.join(__dirname, "packs");
const manifest = require("./packs/manifest.json");
const installed = path.join(__dirname, "data/fonts/StoneSerif-BoldSmallCaps.ttf");

test("original Bold Small Caps is used for monster and Spell/Trap type lines", (t) => {
  if (!fs.existsSync(installed)) return t.skip("user-supplied local font is absent");
  const registry = loadLocalTypeFont(loadAssets(pack, manifest));
  const monster = {
    name: "Test Monster", type: "winged dragon / effect monster", level: 4,
    atk: "1800", def: "1200", effect: "A short effect.", visual: { frame: "effect" },
  };
  const original = renderCard(monster, registry, style);
  assert.match(original.svg, /data-text-block="type"[^>]*font-family="CardTypeLine"/);
  assert.match(original.svg, />Winged Dragon \/ Effect Monster<\/text>/);
  assert.equal(original.model.type, "winged dragon / effect monster");
  assert.match(original.svg, /font-family:CardTypeLine;src:url\('data:font\/ttf;base64,/);
  assert.doesNotMatch(original.svg, /id="card-type-weight"/);
  assert.match(original.svg, /Adobe Systems Incorporated/);
  assert.match(original.svg, /International Typeface Corporation/);
  const thinStyle = structuredClone(style);
  thinStyle.regions.type.weight = 100;
  const thin = renderCard(monster, registry, thinStyle);
  assert.match(thin.svg, /id="card-type-weight"[^<]*><feMorphology[^>]*operator="erode"/);
  assert.notEqual(thin.hash, original.hash);
  const customStyle = structuredClone(style);
  customStyle.regions.type.font = "name";
  assert.doesNotMatch(renderCard(monster, registry, customStyle).svg, /font-family="CardTypeLine"/);
  const spell = renderCard({ name: "Test Spell", type: "Spell Card", visual: { frame: "spell" } }, registry, style);
  assert.match(spell.svg, /data-text-block="kind"[^>]*font-family="CardTypeLine"/);
  assert.match(spell.svg, /font-family:CardTypeLine;src:url\('data:font\/ttf;base64,/);
  assert.doesNotMatch(spell.svg, /id="card-kind-weight"/);
  assert.match(spell.svg, /Card type: Yu-Gi-Oh! ITC Stone Serif Bold Small Caps/);
  const thinKindStyle = structuredClone(style);
  thinKindStyle.regions.kind.weight = 100;
  assert.match(renderCard({ name: "Test Trap", type: "Trap Card", visual: { frame: "trap" } }, registry, thinKindStyle).svg,
    /id="card-kind-weight"[^<]*><feMorphology[^>]*operator="erode"/);
  const state = testerState(registry, style);
  assert.match(state.credits.find(credit => credit.name === "monster-type").notice, /Adobe Systems/);
  assert.match(testerHtml(state), /font\.type/);
});
