"use strict";
// Keep one render request per visual card, shared by the pack and spotlight.
window.DraftCards = (() => {
  const entries = new Map(), queue = [];
  let active = 0, sequence = 0;
  let spotlightVersion = 0;
  const spotlightWaiters = new Map();
  const fields = ["name", "type", "frame", "attribute", "level", "atk", "def",
    "link", "effect", "pendulumEffect", "artwork", "visual"];
  function hydrate() {
    document.querySelectorAll("[data-render-card]").forEach(node => {
      const entry = entries.get(node.dataset.renderCard);
      if (!entry?.url || node.querySelector(".rendered-card")) return;
      const image = document.createElement("img");
      image.className = "rendered-card";
      image.alt = entry.card.name;
      image.onload = () => node.classList.add("has-render");
      image.onerror = () => { entry.url = null; image.remove(); };
      image.src = entry.url;
      if (entry.diagnostics.length) node.title = entry.diagnostics.join("\n");
      node.append(image);
    });
  }
  function pump() {
    while (active < 4 && queue.length) {
      const entry = queue.shift();
      active++;
      fetch("/api/draft-render", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.card),
      }).then(async response => {
        if (!response.ok) throw Error("Card render unavailable");
        const result = await response.json();
        if (!/^\/renders\/[a-f0-9]{64}\.svg$/.test(result.url)) throw Error("Invalid render URL");
        entry.url = result.url;
        entry.diagnostics = result.diagnostics || [];
        hydrate();
      }).catch(() => {
        document.querySelectorAll(`[data-render-card="${entry.id}"]`).forEach(node => {
          node.title = "Card image unavailable. Showing the basic preview.";
        });
      }).finally(() => {
        entry.settled = true;
        for (const resolve of spotlightWaiters.get(entry.id) || []) resolve();
        spotlightWaiters.delete(entry.id);
        active--; pump();
      });
    }
  }
  function entryFor(card) {
    const visual = Object.fromEntries(fields.filter(key => card[key] != null).map(key => [key, card[key]]));
    const key = JSON.stringify(visual);
    let entry = entries.get(key);
    if (!entry) {
      entry = { id: String(++sequence), card: visual, diagnostics: [] };
      entries.set(key, entry);
      entries.set(entry.id, entry);
      queue.push(entry);
      pump();
    }
    return entry;
  }
  async function showSpotlight(container, card, fallback) {
    const version = ++spotlightVersion;
    const entry = entryFor(card);
    if (container.firstElementChild?.dataset.renderCard === entry.id &&
        container.firstElementChild.classList.contains("has-render")) return;
    if (entry.spotlightNode) {
      container.replaceChildren(entry.spotlightNode);
      return;
    }
    const queued = queue.indexOf(entry);
    if (queued > 0) { queue.splice(queued, 1); queue.unshift(entry); }
    // Share the pending render with pack thumbnails, then decode off the page.
    if (!entry.settled) await new Promise(resolve => {
      const waiters = spotlightWaiters.get(entry.id) || [];
      waiters.push(resolve);
      spotlightWaiters.set(entry.id, waiters);
    });
    if (version !== spotlightVersion) return;
    if (!entry.url) {
      container.innerHTML = fallback;
      return;
    }
    const image = new Image();
    image.className = "rendered-card";
    image.alt = card.name;
    image.src = entry.url;
    try { await image.decode(); } catch {
      if (version === spotlightVersion) container.innerHTML = fallback;
      return;
    }
    if (version !== spotlightVersion) return;
    const template = document.createElement("template");
    template.innerHTML = fallback;
    const node = template.content.firstElementChild;
    node.classList.add("has-render");
    node.title = entry.diagnostics.join("\n");
    node.append(image);
    entry.spotlightNode = node;
    container.replaceChildren(node);
  }
  new MutationObserver(hydrate).observe(document.documentElement, { childList: true, subtree: true });
  return {
    cardHtml(card, fallback) {
      const entry = entryFor(card);
      return fallback.replace('class="card', `data-render-card="${entry.id}" class="card`);
    },
    showSpotlight,
  };
})();
