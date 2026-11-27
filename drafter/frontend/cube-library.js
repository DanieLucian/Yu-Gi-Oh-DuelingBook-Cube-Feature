"use strict";
if (location.protocol !== "file:") {
  (() => {
    const ownerKey = "cube-draft.player.v1";
    let identity = localStorage.getItem(ownerKey);
    if (!/^[a-f0-9]{64}$/.test(identity || "")) {
      identity = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(ownerKey, identity);
    }
    let cubes = [], loaded = false, editing = null, sourceId = "", page = 0;
    const pageSize = 20;
    const panel = $("cube-editor");
    const filters = $("editor-filters");
    const appTitle = document.title;
    const editorPath = id => "/cube-editor/" + encodeURIComponent(id);
    const editorIdFromUrl = () => /^\/cube-editor\/([a-zA-Z0-9-]{1,100})$/.exec(location.pathname)?.[1];
    async function api(path, method = "GET", body) {
      const response = await fetch("/api/cubes" + path, { method,
        headers: { "X-Cube-Owner": identity, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Cube database unavailable.");
      return result;
    }
    const originalRender = renderLibrary;
    renderLibrary = () => {
      originalRender();
      $("library").querySelectorAll("[data-cube]").forEach(button => {
        const c = library.find(item => item.id === button.dataset.cube);
        if (!c || c.builtIn) return;
        const actions = document.createElement("div");
        actions.className = "cube-tile-actions";
        const edit = document.createElement("a");
        edit.className = "cube-edit-link";
        edit.href = editorPath(c.id);
        edit.textContent = c.editable ? "Edit Cube" : "View Cube";
        edit.dataset.editCube = c.id;
        actions.append(edit);
        if (c.editable) {
          const remove = document.createElement("button");
          remove.textContent = "Delete Cube";
          remove.dataset.deleteCube = c.id;
          actions.append(remove);
        }
        button.after(actions);
      });
    };
    importFile = async file => {
      if (file.size > 10 * 1024 * 1024) return $("library-error").textContent = "Cube import limit: 10 MB.";
      try {
        const parsed = JSON.parse(await file.text());
        const validated = readCube(parsed, file.name);
        await api("/import", "POST", { name: validated.name, cube: parsed });
        await refresh(); toast("Cube imported into the shared library.");
      } catch (error) { $("library-error").textContent = error.message; }
    };
    const originalView = view;
    view = name => {
      panel.hidden = name !== "editor";
      if (panel.hidden) {
        if (editorIdFromUrl()) history.pushState({ editorExitView: name }, "", "/draft");
        document.title = appTitle;
      }
      originalView(name);
    };
    const create = document.createElement("div");
    create.style.cssText = "display:flex;gap:8px;align-items:center";
    create.innerHTML = '<label>New Cube name <input id="new-cube-name" maxlength="100"></label><button id="new-cube-create" class="primary">Create Cube</button><button id="refresh-cubes">Refresh Cubes</button>';
    $("drop-zone").before(create);
    $("library-view").querySelector(".upload p:nth-of-type(2)").textContent = "Imported cards are saved once in the shared server catalog; each Cube keeps its own copy counts.";
    const value = id => $(id).value.trim();
    const currentCube = () => cubes.find(c => c.id === editing);
    const labels = { monster: "Monster", spell: "Spell", trap: "Trap", level: "Level", rank: "Rank", link: "Link" };
    const subtypeOptions = {
      spell: ["normal", "continuous", "equip", "field", "quick-play", "ritual"],
      trap: ["normal", "continuous", "counter"],
    };
    const monsterTraits = ["normal", "effect", "ritual", "fusion", "synchro", "xyz", "link", "pendulum",
      "tuner", "flip", "gemini", "spirit", "toon", "union", "special summon"];
    const monsterAttributes = new Set(["DARK", "LIGHT", "EARTH", "WATER", "FIRE", "WIND", "DIVINE"]);
    const linkDirections = ["top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left", "top-left"];
    const cardData = new WeakMap();
    const normalizeType = text => text.toLowerCase().replace(/[\s_]+/g, " ").trim();
    const typeLabel = type => type.replace(/\b\w/g, letter => letter.toUpperCase());
    function parseStat(raw) {
      const match = /^(?:(?:atk|def|link(?: rating)?)[\s/:–-]*)?(\d+)$/i.exec(String(raw ?? "").trim());
      return match ? Number(match[1]) : null;
    }
    function metadata(card) {
      if (cardData.has(card)) return cardData.get(card);
      const frame = String(cardKind(card)).toLowerCase();
      const category = frame === "spell" || frame === "trap" ? frame : "monster";
      const typeLine = String(card.type || "").trim().replace(/^\[\s*|\s*\]$/g, "");
      const visual = card.visual || {};
      let info = { category, typeLine };
      if (category === "monster") {
        const parts = typeLine.split("/").map(normalizeType).filter(Boolean);
        const race = parts.find(part => part !== "monster" && !monsterTraits.includes(part));
        const traits = new Set(parts.filter(part => monsterTraits.includes(part)));
        if (monsterTraits.includes(frame)) traits.add(frame);
        if (visual.pendulum || card.pendulumEffect || /pendulum/i.test(card.frame || "")) traits.add("pendulum");
        const ratingKind = frame === "xyz" ? "rank" : frame === "link" ? "link" : "level";
        const rating = frame === "xyz" ? parseStat(visual.rank) ?? parseStat(card.rank) ?? parseStat(card.level)
          : frame === "link" ? parseStat(card.link) ?? parseStat(card.linkRating) : parseStat(card.level);
        info = { ...info, race, traits, ratingKind, rating,
          scaleLeft: parseStat(visual.scaleLeft), scaleRight: parseStat(visual.scaleRight),
          atk: parseStat(card.atk), def: frame === "link" ? null : parseStat(card.def) };
      } else {
        const subtype = String(visual.spellTrapIcon || "").toLowerCase();
        info.subtype = subtypeOptions[category].includes(subtype) ? subtype : subtypeOptions[category].find(
          option => new RegExp(`\\b${option === "quick-play" ? "quick[- ]play" : option}\\b`, "i").test(typeLine));
      }
      cardData.set(card, info);
      return info;
    }
    function setOptions(id, prompt, options) {
      const select = $(id);
      const previous = select.value;
      select.replaceChildren(new Option(prompt, ""), ...options.map(option => new Option(typeLabel(option), option)));
      if (options.includes(previous)) select.value = previous;
    }
    function updateFilterFields() {
      const category = value("editor-category");
      $("editor-monster-fields").hidden = category !== "monster";
      $("editor-subtype-field").hidden = !subtypeOptions[category];
      $("editor-rating").disabled = !value("editor-rating-kind");
      setOptions("editor-subtype", "Any subtype", subtypeOptions[category] || []);
    }
    function inRange(stat, min, max) {
      return (Number.isNaN(min) || stat !== null && stat >= min)
        && (Number.isNaN(max) || stat !== null && stat <= max);
    }
    function matchingCards(cards) {
      const search = value("editor-search").toLowerCase();
      const category = value("editor-category"), subtype = value("editor-subtype");
      const race = value("editor-race"), trait = value("editor-trait");
      const eitherType = value("editor-type-match") === "or";
      const ratingKind = value("editor-rating-kind"), rating = $("editor-rating").valueAsNumber;
      const [atkMin, atkMax, defMin, defMax] = ["atk-min", "atk-max", "def-min", "def-max"]
        .map(stat => $("editor-" + stat).valueAsNumber);
      return cards.filter(card => {
        if (!card.name.toLowerCase().includes(search)) return false;
        if (!category) return true;
        const info = metadata(card);
        if (info.category !== category) return false;
        if (category !== "monster") return !subtype || info.subtype === subtype;
        const raceMatch = info.race === race;
        const traitMatch = info.traits.has(trait);
        const typesMatch = eitherType && race && trait ? raceMatch || traitMatch
          : (!race || raceMatch) && (!trait || traitMatch);
        return typesMatch
          && (!ratingKind || (info.ratingKind === ratingKind && (Number.isNaN(rating) || info.rating === rating)))
          && inRange(info.atk, atkMin, atkMax) && inRange(info.def, defMin, defMax);
      });
    }
    const metadataTag = (label, icon = "") => label ? `<span>${icon}${esc(label)}</span>` : "";
    const iconImage = src => `<img class="editor-meta-icon" src="${src}" alt="" width="19" height="19">`;
    const rendererIcon = key => iconImage(`/card-icons/${key}`);
    const genericIcon = glyph => `<span class="editor-meta-icon editor-generic-icon" aria-hidden="true">${glyph}</span>`;
    function linkArrowIcon(arrows) {
      const active = Array.isArray(arrows) ? linkDirections.filter(direction => arrows.includes(direction)) : [];
      const accessibility = active.length
        ? `role="img" aria-label="Link arrows: ${active.join(", ")}"`
        : 'aria-hidden="true"';
      return `<svg class="editor-meta-icon editor-link-icon" viewBox="0 0 32 32" focusable="false" ${accessibility}>
        <path class="editor-link-center" d="M10.5 7.5h11l3 3v11l-3 3h-11l-3-3v-11Z"/>
        ${linkDirections.map((direction, i) => {
          const shape = i % 2 === 0 ? "M10 6.5 16 1.5 22 6.5Z" : "M22.5 2.5h7v7Z";
          const angle = Math.floor(i / 2) * 90;
          return `<path class="editor-link-arrow${active.includes(direction) ? " is-active" : ""}" data-direction="${direction}" transform="rotate(${angle} 16 16)" d="${shape}"/>`;
        }).join("")}
      </svg>`;
    }
    function cardMetadataHtml(card) {
      const info = metadata(card);
      if (info.category !== "monster") {
        const subtypeIcon = info.subtype === "normal" ? genericIcon("●")
          : info.subtype ? rendererIcon(`icon.${info.subtype}`) : "";
        return metadataTag(labels[info.category], rendererIcon(`attribute.${info.category.toUpperCase()}`))
          + metadataTag(info.subtype ? typeLabel(info.subtype) : "Subtype unavailable", subtypeIcon);
      }
      const attribute = String(card.attribute ?? "").trim().toUpperCase();
      const attributeIcon = monsterAttributes.has(attribute) ? rendererIcon(`attribute.${attribute}`) : genericIcon("?");
      const isLink = info.ratingKind === "link";
      const ratingIcon = isLink ? linkArrowIcon(card.visual?.linkArrows) : rendererIcon(`icon.${info.ratingKind}`);
      const attack = metadataTag(`ATK ${info.atk ?? (card.atk || "—")}`);
      const defense = isLink ? "" : metadataTag(`DEF ${info.def ?? (card.def || "—")}`);
      return metadataTag(attribute || "Attribute unavailable", attributeIcon)
        + metadataTag(`${labels[info.ratingKind]} ${info.rating ?? "—"}`, ratingIcon)
        + (info.typeLine ? metadataTag(`[ ${info.typeLine} ]`) : "")
        + `<span class="editor-combat-stats">${attack}${defense}</span>`;
    }
    function pendulumEffectHtml(card) {
      const { traits, scaleLeft, scaleRight } = metadata(card);
      const hasScale = traits?.has("pendulum") || scaleLeft != null || scaleRight != null;
      if (!hasScale && !card.pendulumEffect) return "";
      const scaleValue = scaleLeft != null && scaleLeft === scaleRight
        ? scaleLeft : `L ${scaleLeft ?? "—"} / R ${scaleRight ?? "—"}`;
      return `<div class="editor-pendulum-heading">
        <h4>Pendulum effect</h4>
        ${hasScale ? metadataTag(`P Scale ${scaleValue}`, iconImage(pendulumIconSource())) : ""}
      </div>
      <p>${esc(card.pendulumEffect || "Pendulum effect text unavailable.")}</p>
      <h4>Card text</h4>`;
    }
    function renderCardRow(card, editable) {
      return `<article class="panel editor-card-row">
        <div>${cardHtml(card)}</div>
        <div class="editor-card-copy">
          <div class="editor-card-heading">
            <h3>${esc(card.name)}</h3>
            <div class="editor-actions editor-card-actions">
              ${editable ? `<label>Copies <input type="number" min="1" max="1000" value="${esc(card.copies)}" data-copy="${esc(card.id)}" aria-label="Copies of ${esc(card.name)}"></label>
                <button data-save-copy="${esc(card.id)}">Save copies</button><button data-remove-card="${esc(card.id)}">Remove</button>`
                : `<span class="small">Copies · ${esc(card.copies)}</span>`}
            </div>
          </div>
          <div class="editor-card-meta">${cardMetadataHtml(card)}</div>
          ${pendulumEffectHtml(card)}
          <p>${esc(card.effect || "No card text in this Cube record.")}</p>
        </div>
      </article>`;
    }
    function drawCards() {
      const c = currentCube();
      if (!c) return;
      const matches = matchingCards(c.cards);
      const pages = Math.max(1, Math.ceil(matches.length / pageSize));
      page = Math.min(page, pages - 1);
      $("editor-cards").innerHTML = matches.slice(page * pageSize, (page + 1) * pageSize)
        .map(card => renderCardRow(card, c.editable)).join("") || `<p class="panel muted">${c.cards.length ? "No cards match these filters." : "No cards in this Cube."}</p>`;
      $("editor-page").textContent = `${matches.length} of ${c.cards.length} cards · Page ${page + 1} of ${pages}`;
      $("editor-prev").disabled = page === 0;
      $("editor-next").disabled = page >= pages - 1;
      $("editor-prev").parentElement.hidden = pages < 2;
    }
    function drawSourceCards() {
      const search = value("editor-source-search").toLowerCase();
      const source = cubes.find(c => c.id === sourceId);
      const cards = source?.cards.filter(card => card.name.toLowerCase().includes(search)).slice(0, 50) || [];
      $("editor-source-cards").innerHTML = cards.map(card =>
        `<div class="editor-source-card"><span>${esc(card.name)}</span><button data-add-card="${esc(card.id)}">Add one</button></div>`
      ).join("") || "Choose a source Cube with matching cards.";
    }
    function draw() {
      if (panel.hidden) return;
      const c = currentCube();
      $("editor-title").textContent = c?.name || (loaded ? "Cube unavailable" : "Loading Cube…");
      $("editor-mode").textContent = c?.editable ? "Cube editor" : "Cube viewer";
      $("editor-body").hidden = !c;
      $("editor-edit-actions").hidden = !c?.editable;
      $("editor-summary").textContent = c
        ? `${c.cards.length} unique cards · ${total(c)} copies${c.editable ? "" : " · Read only"}`
        : loaded ? "This Cube could not be found in the shared library." : "";
      document.title = c ? `${c.name} · Cube Draft` : appTitle;
      if (!c) return;
      if (document.activeElement !== $("editor-name")) $("editor-name").value = c.name;
      const monsters = c.cards.map(metadata).filter(info => info.category === "monster");
      const races = [...new Set(monsters.map(info => info.race).filter(Boolean))].sort();
      const traits = [...new Set(monsters.flatMap(info => [...info.traits]))].sort();
      setOptions("editor-race", "Any type", races);
      setOptions("editor-trait", "Any second type", traits);
      updateFilterFields();
      drawCards();
      $("editor-source-panel").hidden = !c.editable;
      if (c.editable) {
        const sources = cubes.filter(item => item.id !== c.id && item.cards.length);
        if (!sources.some(item => item.id === sourceId)) sourceId = sources[0]?.id || "";
        $("editor-source").replaceChildren(...sources.map(item => new Option(item.name, item.id)));
        $("editor-source").value = sourceId;
        drawSourceCards();
      }
    }
    async function refresh() {
      cubes = (await api("")).cubes;
      loaded = true;
      library = [example, ...cubes];
      renderLibrary(); draw();
    }
    function openEditor(id) {
      if (editorIdFromUrl() !== id) {
        if (!$("library-view").hidden) history.replaceState({ editorExitView: "library" }, "");
        history.pushState(null, "", editorPath(id));
      }
      editing = id;
      sourceId = "";
      page = 0;
      filters.reset();
      $("editor-source-search").value = "";
      $("editor-source-panel").open = false;
      $("editor-message").textContent = "";
      view("editor");
      draw();
      panel.scrollTop = 0;
      $("editor-title").focus({ preventScroll: true });
    }
    function reportError(error) {
      $(panel.hidden ? "library-error" : "editor-message").textContent = error.message;
    }
    async function change(work) {
      const changedId = editing;
      try {
        await work(); $("editor-message").textContent = "Saved."; await refresh();
        if (changedId && $("lobby-cube")?.value === changedId) $("lobby-cube").dispatchEvent(new Event("input", { bubbles: true }));
      }
      catch (error) { reportError(error); }
    }
    async function deleteCube(id) {
      const c = cubes.find(item => item.id === id);
      if (!c?.editable || !confirm(`Delete Cube “${c.name}”? Draft rooms already using it keep their snapshot.`)) return;
      $("library-error").textContent = "";
      try {
        await api(`/${id}`, "DELETE", {});
        if (!panel.hidden && editing === id) view("library");
        await refresh();
        toast(`Deleted ${c.name}.`);
      } catch (error) {
        reportError(error);
      }
    }
    $("new-cube-create").onclick = async () => {
      try {
        const { cube } = await api("", "POST", { name: value("new-cube-name") });
        $("new-cube-name").value = "";
        await refresh();
        openEditor(cube.id);
      } catch (error) { reportError(error); }
    };
    $("refresh-cubes").onclick = () => refresh().catch(reportError);
    $("editor-close").onclick = () => view("library");
    $("editor-rename").onclick = () => change(() => api("/" + editing, "PATCH", { name: value("editor-name") }));
    $("editor-delete").onclick = () => deleteCube(editing);
    filters.onsubmit = event => event.preventDefault();
    filters.oninput = event => {
      if (["editor-category", "editor-rating-kind"].includes(event.target.id)) updateFilterFields();
      page = 0;
      drawCards();
    };
    $("editor-clear-filters").onclick = () => {
      filters.reset();
      page = 0;
      updateFilterFields();
      drawCards();
    };
    for (const [id, step] of [["editor-prev", -1], ["editor-next", 1]]) {
      $(id).onclick = () => {
        page += step;
        drawCards();
        $("editor-page").scrollIntoView({ block: "start" });
      };
    }
    $("editor-source").onchange = () => { sourceId = $("editor-source").value; drawSourceCards(); };
    $("editor-source-search").oninput = drawSourceCards;
    $("editor-cards").onclick = event => {
      const save = event.target.closest("[data-save-copy]"), remove = event.target.closest("[data-remove-card]");
      const cardId = save?.dataset.saveCopy || remove?.dataset.removeCard;
      if (!cardId) return;
      const path = `/${editing}/cards/${encodeURIComponent(cardId)}`;
      if (save) change(() => api(path, "PATCH", { copies: Number([...$("editor-cards").querySelectorAll("[data-copy]")].find(input => input.dataset.copy === cardId).value) }));
      else change(() => api(path, "DELETE", {}));
    };
    $("editor-source-cards").onclick = event => {
      const add = event.target.closest("[data-add-card]");
      if (add) change(() => api("/" + editing, "POST", { sourceCubeId: sourceId, cardId: add.dataset.addCard, copies: 1 }));
    };
    $("library").addEventListener("click", event => {
      const remove = event.target.closest("[data-delete-cube]");
      if (remove) { deleteCube(remove.dataset.deleteCube); return; }
      const edit = event.target.closest("[data-edit-cube]");
      if (!edit || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openEditor(edit.dataset.editCube);
    });
    window.addEventListener("popstate", () => {
      const id = editorIdFromUrl();
      if (id) openEditor(id);
      else if (history.state?.editorExitView) view(history.state.editorExitView);
      else if (!panel.hidden) view("library");
    });
    const requestedCube = editorIdFromUrl();
    if (requestedCube) openEditor(requestedCube);
    else if (history.state?.editorExitView === "library") view("library");
    // Import existing browser Cubes once, retaining their identifiers.
    (async () => {
      try {
        await refresh();
        const saved = JSON.parse(localStorage.getItem(key) || "[]");
        if (Array.isArray(saved) && saved.length) {
          for (const c of saved) {
            if (c.builtIn || c.sample) continue;
            const existing = cubes.find(item => item.id === c.id);
            if (existing?.editable) continue;
            await api("/import", "POST", { ...(existing ? {} : { id: c.id }), name: c.name, cube: { schema: "dbcd-cube-v1", cards: c.cards } });
          }
          localStorage.removeItem(key); await refresh();
        }
      } catch (error) { reportError(error); }
    })();

    function pendulumIconSource() {
      // Konami's icon_pendulum.png. Embed the original bytes so an already
      // running server can display it without loading a new icon manifest.
      return "data:image/png;base64,\
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\
MMwmTB7WEY6GzwjfEH5vpvlM6cy2CIjgR2yIuB9pGZkX+X0UKSoyqi7qUbRTdHF09yzWrORZ+2e9jvGPqYy5O9tqtnJ2Z6xqbFJsY+ybuIC4qriBeIf4RfGX\
EnQTJAntieTE2MQ9ieNzAudsmjOc5JpUlnRjruXcorkX5unOy553PFk1WZB8OIWYEpeyP+WDIEJQLxhP5aduTR0T8oSbhU9FvqKNolGxt7hKPJLmnVaV9jjd\
O31D+miGT0Z1xjMJT1IreZEZkrkj801WRNberM/ZcdktOZSclJyjUg1plrQr1zC3KLdPZisrkw3keeZtyhuTh8r35CP5c/PbFWyFTNGjtFKuUA4WTC+oK3hb\
GFt4uEi9SFrUM99m/ur5IwuCFny9kLBQuLCz2Lh4WfHgIr9FuxYji1MXdy4xXVK6ZHhp8NJ9y2jLspb9UOJYUlXyannc8o5Sg9KlpUMrglc0lamUycturvRa\
uWMVYZVkVe9ql9VbVn8qF5VfrHCsqK74sEa45uJXTl/VfPV5bdra3kq3yu3rSOuk626s91m/r0q9akHV0IbwDa0b8Y3lG19tSt50oXpq9Y7NtM3KzQM1YTXt\
W8y2rNvyoTaj9nqdf13LVv2tq7e+2Sba1r/dd3vzDoMdFTve75TsvLUreFdrvUV99W7S7oLdjxpiG7q/5n7duEd3T8Wej3ulewf2Re/ranRvbNyvv7+yCW1S\
No0eSDpw5ZuAb9qb7Zp3tXBaKg7CQeXBJ9+mfHvjUOihzsPcw83fmX+39QjrSHkr0jq/dawto22gPaG97+iMo50dXh1Hvrf/fu8x42N1xzWPV56gnSg98fnk\
gpPjp2Snnp1OPz3Umdx590z8mWtdUV29Z0PPnj8XdO5Mt1/3yfPe549d8Lxw9CL3Ytslt0utPa49R35w/eFIr1tv62X3y+1XPK509E3rO9Hv03/6asDVc9f4\
1y5dn3m978bsG7duJt0cuCW69fh29u0XdwruTNxdeo94r/y+2v3qB/oP6n+0/rFlwG3g+GDAYM/DWQ/vDgmHnv6U/9OH4dJHzEfVI0YjjY+dHx8bDRq98mTO\
k+GnsqcTz8p+Vv9563Or59/94vtLz1j82PAL+YvPv655qfNy76uprzrHI8cfvM55PfGm/K3O233vuO+638e9H5ko/ED+UPPR+mPHp9BP9z7nfP78L/eE8/sl\
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\
7WYji8QAAAAASUVORK5CYII=";
    }
  })();
}
