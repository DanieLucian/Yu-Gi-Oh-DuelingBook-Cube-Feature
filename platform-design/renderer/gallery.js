"use strict";
const $ = (id) => document.getElementById(id);
const monster = {
  id: "demo",
  name: "Example Monster",
  type: "Warrior / Effect",
  attribute: "DARK",
  level: 4,
  atk: "1800",
  def: "1200",
  effect:
    "This is a fictional card for inspecting the server rendering layout.",
  artwork: "",
};
const samples = [
  { ...monster, name: "Example Normal Monster", type: "Warrior / Normal" },
  { ...monster, name: "Example Effect Monster" },
  {
    ...monster,
    name: "Example Ritual Monster",
    type: "Warrior / Ritual / Effect",
    level: 6,
  },
  {
    ...monster,
    name: "Example Fusion Monster",
    type: "Dragon / Fusion / Effect",
    level: 8,
  },
  {
    ...monster,
    name: "Example Synchro Monster",
    type: "Dragon / Synchro / Effect",
    level: 8,
  },
  {
    ...monster,
    name: "Example Xyz Monster",
    type: "Warrior / Xyz / Effect",
    visual: { version: 1, rank: 4 },
  },
  {
    ...monster,
    name: "Example Link Monster",
    type: "Cyberse / Link / Effect",
    link: "LINK-3",
    visual: { version: 1, linkArrows: ["top", "bottom-left", "bottom-right"] },
  },
  {
    ...monster,
    name: "Example Pendulum Monster",
    type: "Spellcaster / Pendulum / Effect",
    pendulumEffect: "A separate Pendulum effect goes here.",
    visual: { version: 1, scaleLeft: 2, scaleRight: 7 },
  },
  {
    ...monster,
    name: "Example Xyz Pendulum Monster",
    type: "Dragon / Xyz / Pendulum / Effect",
    pendulumEffect: "Pendulum text is separate from the monster effect.",
    visual: { version: 1, rank: 7, scaleLeft: 4, scaleRight: 4 },
  },
  {
    id: "demo-spell",
    name: "Example Quick-Play Spell",
    type: "[ SPELL CARD ]",
    effect:
      "The subtype comes from optional visual metadata when the original JSON lacks it.",
    visual: { version: 1, spellTrapIcon: "quick-play" },
  },
  {
    id: "demo-trap",
    name: "Example Counter Trap",
    type: "Counter Trap",
    effect:
      "Trap cards show their subtype icon and omit monster stars and combat stats.",
  },
];
let imported = [],
  sequence = 0;
function options(select, cards) {
  select.replaceChildren(
    ...cards.map((c, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = c.name || `Card ${i + 1}`;
      return o;
    }),
  );
}
async function show(card) {
  const current = ++sequence;
  $("status").textContent = "Rendering on server…";
  $("json").textContent = JSON.stringify(card, null, 2);
  $("card").hidden = true;
  $("diagnostics").replaceChildren();
  try {
    const response = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });
    const result = await response.json();
    if (current !== sequence) return;
    if (!response.ok) throw Error(result.error);
    $("card").src = result.url;
    $("card").hidden = false;
    $("status").textContent = result.cacheHit
      ? "Loaded cached server render."
      : "Rendered and cached on server.";
    $("diagnostics").replaceChildren(
      ...(result.diagnostics.length
        ? result.diagnostics
        : [
            "No missing asset or metadata warnings. Compare visually with the original.",
          ]
      ).map((message) => {
        const li = document.createElement("li");
        li.textContent = message;
        return li;
      }),
    );
  } catch (error) {
    if (current === sequence) $("status").textContent = error.message;
  }
}
options($("sample"), samples);
$("sample").onchange = () => show(samples[Number($("sample").value)]);
$("imported").onchange = () => show(imported[Number($("imported").value)]);
$("file").onchange = async () => {
  const file = $("file").files[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw Error("Cube preview limit: 10 MB.");
    const data = JSON.parse(await file.text());
    if (
      data?.schema !== "dbcd-cube-v1" ||
      !Array.isArray(data.cards) ||
      !data.cards.length ||
      data.cards.length > 10000
    )
      throw Error(
        "Choose a non-empty dbcd-cube-v1 JSON with at most 10,000 records.",
      );
    imported = data.cards;
    options($("imported"), imported);
    $("imported").disabled = false;
    show(imported[0]);
  } catch (error) {
    $("status").textContent = error.message;
  }
  $("file").value = "";
};
$("sample").value = "1";
show(samples[1]);
