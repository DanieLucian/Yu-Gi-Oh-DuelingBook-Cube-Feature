"use strict";
// Shared by the browser and server: a permanent, reproducible fictional Cube.
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MockCube = api;
})(globalThis, () => {
  const id = "mock-300", count = 300;
  function random(seed) {
    let n = seed >>> 0;
    return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
  }
  function create() {
    const rng = random(47039), choose = a => a[Math.floor(rng() * a.length)];
    const prefixes = ["Astral", "Ember", "Moonlit", "Crystal", "Verdant", "Iron", "Storm", "Shadow", "Golden", "Frozen", "Violet", "Runic"];
    const monsters = ["Dragon", "Sentinel", "Warden", "Knight", "Oracle", "Falcon", "Golem", "Wanderer", "Serpent", "Artisan"];
    const spells = ["Archive", "Invocation", "Compass", "Horizon", "Lantern", "Sanctuary", "Pact", "Mirror"];
    const traps = ["Ambush", "Barrier", "Reversal", "Prison", "Judgment", "Vortex", "Revenge", "Seal"];
    const cards = Array.from({ length: count }, (_, i) => {
      const category = i % 20 < 12 ? "monster" : i % 20 < 17 ? "spell" : "trap";
      const frame = category === "monster" ? choose(["normal", "effect", "effect", "effect", "ritual", "fusion", "synchro", "xyz", "link"]) : category;
      const rank = 1 + Math.floor(rng() * 8), level = 1 + Math.floor(rng() * 10), rating = 1 + Math.floor(rng() * 4);
      const race = choose(["Dragon", "Warrior", "Spellcaster", "Beast", "Machine", "Fairy", "Fiend", "Aqua"]);
      const subtype = choose(category === "spell" ? ["Normal", "Continuous", "Quick-Play", "Equip", "Field", "Ritual"] : ["Normal", "Continuous", "Counter"]);
      const monsterType = frame === "normal" ? "Normal" : frame === "effect" ? "Effect" : frame[0].toUpperCase() + frame.slice(1) + " / Effect";
      const name = `${choose(prefixes)} ${choose(category === "monster" ? monsters : category === "spell" ? spells : traps)} ${String(i + 1).padStart(3, "0")}`;
      const amount = choose([300, 400, 500, 700, 800]);
      const actions = ["Draw 1 card, then discard 1 card.", `One face-up monster gains ${amount} ATK until the end of this turn.`, "Return 1 card from your GY to the bottom of your Deck.", "Target 1 face-up card on the field; negate its effects until the end of this turn."];
      const condition = choose(["If you control another monster", "During your Main Phase", "When a monster is Summoned", "If a card is sent to your GY"]);
      return {
        id: `mock-${i + 1}`, origin: "mock", duelingbookId: "", name, copies: 1,
        artwork: `/mock-art/${i + 1}.svg`,
        type: category === "monster" ? `${race} / ${monsterType}` : `${subtype} ${category === "spell" ? "Spell" : "Trap"}`,
        section: ["fusion", "synchro", "xyz", "link"].includes(frame) ? "extra" : "main",
        attribute: category === "monster" ? choose(["DARK", "LIGHT", "EARTH", "WATER", "FIRE", "WIND"]) : "",
        level: category === "monster" && frame !== "link" ? (frame === "xyz" ? rank : level) : "",
        atk: category === "monster" ? String(500 + Math.floor(rng() * 29) * 100) : "",
        def: category === "monster" && frame !== "link" ? String(Math.floor(rng() * 31) * 100) : "",
        link: frame === "link" ? String(rating) : "",
        effect: frame === "normal" ? `A ${race.toLowerCase()} of the forgotten ${choose(["stars", "forest", "kingdom", "tides"])}. Its legend lives on in every new adventure.` : `${condition}: ${choose(actions)} You can only use this effect of "${name}" once per turn.`,
        visual: { frame, ...(frame === "xyz" ? { rank } : {}), ...(frame === "link" ? { linkArrows: ["bottom-left", "bottom", "bottom-right", "top"].slice(0, rating) } : {}) },
      };
    });
    return { id, name: "Mock Cube · 300 cards", builtIn: true, mock: true, schema: "dbcd-cube-v1", cards };
  }
  function artwork(number) {
    if (!Number.isInteger(number) || number < 1 || number > count) throw Error("Unknown mock artwork");
    const rng = random(number * 7219), hue = Math.floor(rng() * 360), accent = (hue + 120) % 360;
    const motif = number % 4;
    const stars = Array.from({ length: 28 }, () => `<circle cx="${Math.floor(rng()*600)}" cy="${Math.floor(rng()*430)}" r="${1 + Math.floor(rng()*3)}" fill="white" opacity="${(.15 + rng()*.55).toFixed(2)}"/>`).join("");
    const ridges = Array.from({ length: 3 }, (_, i) => `<path d="M-20 600 V${330+i*65} ${Array.from({length:8},(_,j)=>`L${j*100} ${220+i*70+Math.floor(rng()*100)}`).join(" ")} V620Z" fill="hsl(${hue} 35% ${14+i*8}%)"/>`).join("");
    const subject = motif === 0
      ? '<path d="M300 130 L210 65 236 194 144 290 232 350 194 490 300 438 406 490 368 350 456 290 364 194 390 65Z"/><path d="M270 245 L245 280 278 275 M330 245 L355 280 322 275" stroke="white" stroke-width="10" fill="none"/>'
      : motif === 1 ? '<path d="M300 90 L330 200 450 255 340 295 300 470 260 295 150 255 270 200Z"/><circle cx="300" cy="255" r="110" fill="none" stroke-width="7"/><circle cx="300" cy="255" r="150" fill="none" stroke-width="3"/>'
      : motif === 2 ? '<path d="M260 130 H340 V225 L370 260 V480 H230 V260 L260 225Z"/><path d="M200 480 V320 L155 270 110 320 V480 M400 480 V320 L445 270 490 320 V480"/><circle cx="300" cy="290" r="20" fill="white"/>'
      : '<path d="M300 110 C480 210 465 370 300 490 C135 370 120 210 300 110Z"/><path d="M300 170 L370 285 300 420 230 285Z" fill="none" stroke="white" stroke-width="9"/>';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><linearGradient id="bg" x2=".7" y2="1"><stop stop-color="hsl(${hue} 70% 12%)"/><stop offset="1" stop-color="hsl(${accent} 55% 32%)"/></linearGradient><linearGradient id="ink" x2="1" y2="1"><stop stop-color="hsl(${accent} 80% 82%)"/><stop offset=".5" stop-color="hsl(${hue} 65% 48%)"/><stop offset="1" stop-color="hsl(${accent} 65% 20%)"/></linearGradient></defs><path fill="url(#bg)" d="M0 0H600V600H0Z"/>${stars}<circle cx="${130 + Math.floor(rng()*340)}" cy="145" r="84" fill="hsl(${accent} 80% 78%)" opacity=".2"/>${ridges}<g fill="url(#ink)" stroke="hsl(${accent} 70% 76%)" stroke-width="5" stroke-linejoin="round">${subject}</g><ellipse cx="300" cy="520" rx="190" ry="22" fill="hsl(${hue} 60% 8%)" opacity=".45"/></svg>`;
  }
  return { id, count, create, artwork };
});
