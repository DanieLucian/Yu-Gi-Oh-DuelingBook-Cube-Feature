"use strict";
(async () => {
  const $ = (id) => document.getElementById(id);
  const { DEFAULT_STYLE, normalizeStyle } = window.CardStyles;
  const { composeCard } = window.CardRenderer;
  const standalone = Boolean($("tester-data"));
  const state = standalone
    ? JSON.parse($("tester-data").textContent)
    : await (await fetch("/api/tester-state")).json();
  const data = state.registry;
  $("credits").textContent = (state.credits || [])
    .map(
      (source) =>
        source.notice +
        "\n\nSource checksums:\n" +
        JSON.stringify(source.provenance, null, 2),
    )
    .join("\n\n");
  if (data.profile !== "predefined-813-v1") {
    $("status").textContent =
      "This tester requires the supplied predefined card frames. Your custom pack keeps its existing layout; select the predefined-813-v1 pack to tune typography.";
    document
      .querySelectorAll("input, select, button")
      .forEach((control) => (control.disabled = true));
    return;
  }
  const registry = {
    ...data,
    assets: new Map(data.assets),
    artworks: new Map(data.artworks),
    composites: new Map(),
    imageSizes: new Map(),
  };
  for (const [key, size] of data.sizes)
    registry.imageSizes.set(registry.assets.get(key), size);
  for (const [key, size] of data.artworkSizes)
    registry.imageSizes.set(registry.artworks.get(key), size);
  for (const [key, spec] of data.composites)
    registry.composites.set(key, {
      ...spec,
      layers: spec.layers.map((layer) => ({
        ...layer,
        data: registry.assets.get(layer.key),
      })),
    });
  let style = normalizeStyle(state.style),
    current,
    imageUrl,
    timer,
    generation = 0;
  const base = {
    name: "Example Monster",
    type: "Dragon / Effect",
    attribute: "DARK",
    level: 4,
    atk: "1800",
    def: "1200",
    effect:
      "This monster has a short effect. You can edit the text to test longer paragraphs and compare the layout.",
    visual: { frame: "effect" },
  };
  let cards = [
    {
      ...base,
      name: "Example Normal Monster",
      type: "Dragon / Normal",
      effect:
        "A fierce dragon whose wings carry it across the night sky. Its power has become the subject of many legends.",
      visual: { frame: "normal" },
    },
    base,
    ...["ritual", "fusion", "synchro", "xyz", "link"].map((frame) => ({
      ...base,
      name: `Example ${frame[0].toUpperCase() + frame.slice(1)} Monster`,
      type: `Dragon / ${frame} / Effect`,
      link: "LINK-3",
      visual: {
        frame,
        rank: 4,
        linkArrows: ["top", "bottom-left", "bottom-right"],
      },
    })),
    {
      ...base,
      name: "Torrential Tribute",
      type: "Normal Trap",
      effect:
        "When a monster(s) is Summoned: Destroy all monsters on the field.",
      visual: { frame: "trap", spellTrapIcon: "normal" },
    },
    {
      ...base,
      name: "Example Quick-Play Spell",
      type: "Quick-Play Spell",
      visual: { frame: "spell", spellTrapIcon: "quick-play" },
    },
    ...["effect", "normal", "xyz"].map((frame) => ({
      ...base,
      name: `Example ${frame} Pendulum`,
      type: `Dragon / ${frame} / Pendulum`,
      effect:
        frame === "normal"
          ? "A mysterious dragon that exists between two worlds."
          : base.effect,
      pendulumEffect:
        "Once per turn: You can add one Dragon monster from your Deck to your hand.",
      visual: { frame, pendulum: true, scaleLeft: 2, scaleRight: 8, rank: 4 },
    })),
  ];
  const fields = [
    "size",
    "weight",
    "italic",
    "letterSpacing",
    "offsetX",
    "offsetY",
    "minSize",
    "lineHeight",
    "edgeOpacity",
  ];
  const labels = {
    name: "Bundled small caps",
    body: "Bundled card body",
    serif: "System serif (device dependent)",
    "sans-serif": "System sans serif (device dependent)",
  };
  function message(text) {
    $("status").textContent = text;
  }
  function render() {
    clearTimeout(timer);
    try {
      const result = composeCard(current, registry, style),
        old = imageUrl;
      imageUrl = URL.createObjectURL(
        new Blob([result.svg], { type: "image/svg+xml" }),
      );
      $("card").src = imageUrl;
      if (old) URL.revokeObjectURL(old);
      $("diagnostics").replaceChildren(
        ...result.diagnostics.map((text) => {
          const li = document.createElement("li");
          li.textContent = text;
          return li;
        }),
      );
      message(
        standalone
          ? "Live preview. Export the style to apply it on your server."
          : "Live preview. Save to server when you are happy with the style.",
      );
      return true;
    } catch (error) {
      message(error.message);
      return false;
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(render, 80);
  }
  function fillFonts() {
    $("font").replaceChildren(
      ...[...Object.keys(labels), ...Object.keys(style.fonts)].map((id) => {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = labels[id] || style.fonts[id].name;
        return o;
      }),
    );
  }
  function regionControls() {
    const region = style.regions[$("region").value];
    fillFonts();
    $("font").value = region.font;
    for (const key of fields) {
      const field = $(key),
        exists = Object.hasOwn(region, key);
      if ($(key + "-field")) $(key + "-field").hidden = !exists;
      if (exists) {
        if (key === "italic") field.checked = region[key];
        else field.value = region[key];
      }
    }
    $("edgeOpacity").disabled = region.font !== "name";
  }
  function allControls() {
    regionControls();
    $("starGap").value = style.stars.gap;
    $("starSize").value = style.stars.size;
    for (const key of ["atkX", "defX", "baseline"])
      $(key).value = style.stats[key];
  }
  function selectCard() {
    current = structuredClone(cards[Number($("sample").value)]);
    for (const [field, key] of [
      ["cardName", "name"],
      ["cardEffect", "effect"],
      ["pendulumEffect", "pendulumEffect"],
      ["cardAtk", "atk"],
      ["cardDef", "def"],
    ])
      $(field).value = current[key] ?? "";
    render();
  }
  function cardOptions() {
    $("sample").replaceChildren(
      ...cards.map((card, i) => {
        const o = document.createElement("option");
        o.value = i;
        o.textContent = card.name;
        return o;
      }),
    );
    $("sample").value = "0";
    selectCard();
  }
  function edit(change) {
    const draft = structuredClone(style);
    try {
      change(draft);
      style = normalizeStyle(draft);
      generation++;
      schedule();
    } catch (error) {
      message(error.message);
    }
  }
  for (const key of fields)
    $(key).addEventListener("input", () =>
      edit((draft) => {
        draft.regions[$("region").value][key] =
          key === "italic" ? $(key).checked : Number($(key).value);
      }),
    );
  $("font").onchange = () => {
    edit((draft) => (draft.regions[$("region").value].font = $("font").value));
    regionControls();
  };
  $("region").onchange = regionControls;
  $("sample").onchange = selectCard;
  for (const [field, key] of [
    ["starGap", "gap"],
    ["starSize", "size"],
  ])
    $(field).oninput = () =>
      edit((draft) => (draft.stars[key] = Number($(field).value)));
  for (const key of ["atkX", "defX", "baseline"])
    $(key).oninput = () =>
      edit((draft) => (draft.stats[key] = Number($(key).value)));
  for (const [field, key] of [
    ["cardName", "name"],
    ["cardEffect", "effect"],
    ["pendulumEffect", "pendulumEffect"],
    ["cardAtk", "atk"],
    ["cardDef", "def"],
  ])
    $(field).oninput = () => {
      current[key] = $(field).value;
      schedule();
    };
  $("zoom").oninput = () => {
    $("card").closest(".preview").style.maxWidth = $("zoom").value + "px";
  };
  $("reset").onclick = () => {
    style = normalizeStyle(DEFAULT_STYLE);
    generation++;
    allControls();
    render();
  };
  function download(name, body, type) {
    const url = URL.createObjectURL(new Blob([body], { type })),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("export").onclick = () => {
    try {
      download(
        "card-render-style.json",
        JSON.stringify(normalizeStyle(style), null, 2),
        "application/json",
      );
      message(
        "Exported settings and uploaded fonts. Send the JSON back in the chat to update project defaults.",
      );
    } catch (error) {
      message(error.message);
    }
  };
  $("profile-file").onchange = async () => {
    try {
      const file = $("profile-file").files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024)
        throw Error("Style profile limit: 8 MB.");
      style = normalizeStyle(JSON.parse(await file.text()));
      generation++;
      allControls();
      if (render())
        message("Imported style and fonts. Preview it, then save or export.");
    } catch (error) {
      message(error.message);
    } finally {
      $("profile-file").value = "";
    }
  };
  $("cube-file").onchange = async () => {
    try {
      const file = $("cube-file").files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024)
        throw Error("Cube preview limit: 10 MB.");
      const data = JSON.parse(await file.text());
      if (
        data.schema !== "dbcd-cube-v1" ||
        !Array.isArray(data.cards) ||
        !data.cards.length ||
        data.cards.length > 10000
      )
        throw Error("Choose a non-empty dbcd-cube-v1 Cube JSON.");
      cards = data.cards;
      cardOptions();
    } catch (error) {
      message(error.message);
    } finally {
      $("cube-file").value = "";
    }
  };
  function dataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error("Could not read file."));
      reader.readAsDataURL(file);
    });
  }
  $("art-file").onchange = async () => {
    try {
      const file = $("art-file").files[0];
      if (!file) return;
      if (
        file.size > 10 * 1024 * 1024 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw Error("Choose a PNG, JPEG or WebP up to 10 MB.");
      const src = await dataUrl(file),
        img = new Image();
      img.src = src;
      await img.decode();
      registry.artworks.set("tester-local-art", src);
      current.artwork = "tester-local-art";
      render();
    } catch (error) {
      message(error.message);
    } finally {
      $("art-file").value = "";
    }
  };
  $("font-file").onchange = async () => {
    const target = $("region").value;
    try {
      const file = $("font-file").files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024)
        throw Error("Font limit: 2 MB. Choose a WOFF2 file.");
      const encoded = (await dataUrl(file)).split(",")[1];
      // Reuse an identical font rather than exhausting the six-font limit.
      let id = Object.keys(style.fonts).find(
        (id) => style.fonts[id].data === encoded,
      );
      if (!id) {
        id = "upload-" + crypto.randomUUID();
        const draft = structuredClone(style);
        draft.fonts[id] = { name: file.name, data: encoded };
        normalizeStyle(draft);
        const family = "Measure_" + id,
          face = new FontFace(family, `url(data:font/woff2;base64,${encoded})`);
        await face.load();
        document.fonts.add(face);
        try {
          const canvas = document.createElement("canvas"),
            ctx = canvas.getContext("2d");
          ctx.font = `1000px "${family}"`;
          ctx.fontKerning = "none";
          const chars = new Set();
          for (let n = 32; n < 0x600; n++) chars.add(String.fromCodePoint(n));
          for (let n = 0x2000; n < 0x2070; n++)
            chars.add(String.fromCodePoint(n));
          for (const c of cards)
            for (const char of String(c.name || "") +
              String(c.effect || "") +
              String(c.pendulumEffect || ""))
              if (chars.size < 8192) chars.add(char);
          const widths = {};
          for (const char of chars)
            widths[char] = ctx.measureText(char).width / 1000;
          const m = ctx.measureText("Mg");
          draft.fonts[id].metrics = {
            widths,
            ascent: (m.fontBoundingBoxAscent || 850) / 1000,
            descent: (m.fontBoundingBoxDescent || 250) / 1000,
          };
          // Merge into the current profile so controls changed during file decoding survive.
          const next = structuredClone(style);
          next.fonts[id] = draft.fonts[id];
          next.regions[target].font = id;
          style = normalizeStyle(next);
        } finally {
          document.fonts.delete(face);
        }
      } else {
        const draft = structuredClone(style);
        draft.regions[target].font = id;
        style = normalizeStyle(draft);
      }
      generation++;
      allControls();
      if (render())
        message(
          "Font loaded and measured. Preview it, then save or export the style with its font file.",
        );
    } catch (error) {
      message("Font was not applied: " + error.message);
    } finally {
      $("font-file").value = "";
    }
  };
  $("mode").textContent = standalone
    ? "Standalone tester · no server connection required"
    : "Local server tester · saving updates all future server renders";
  if (standalone) {
    $("save").textContent = "Save in this browser";
    try {
      const saved = localStorage.getItem("cube-card-render-style-v1");
      if (saved) style = normalizeStyle(JSON.parse(saved));
    } catch {
      /* Export remains available when local storage is unavailable. */
    }
  }
  $("save").onclick = async () => {
    const savedGeneration = generation;
    try {
      const value = normalizeStyle(style);
      if (standalone) {
        localStorage.setItem(
          "cube-card-render-style-v1",
          JSON.stringify(value),
        );
        message(
          "Saved in this browser. Export the JSON to apply it to the server.",
        );
      } else {
        $("save").disabled = true;
        const response = await fetch("/api/style", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        message(
          savedGeneration === generation
            ? "Saved to server. New renders use this style, including uploaded fonts, across restarts."
            : "Saved the earlier settings. Your latest edits are still preview-only; save again to apply them.",
        );
      }
    } catch (error) {
      message(error.message);
    } finally {
      $("save").disabled = false;
    }
  };
  allControls();
  cardOptions();
})().catch((error) => {
  document.getElementById("status").textContent =
    "Could not start the tester: " + error.message;
});
