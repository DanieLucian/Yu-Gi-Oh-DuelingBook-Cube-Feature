"use strict";
{
  const resumeKey = "cube-draft.room.v1";
  let credential = null, room = null, busy = false;
  let queue = Promise.resolve(), pending = 0, errorSource = null;
  let roomSignature = null, draftSignature = null;
  const localCube = cube;
  cube = () => room && state?.cubeId === "room-" + room.code ? { ...room.cube, cards: [] } : localCube();
  try { credential = JSON.parse(localStorage.getItem(resumeKey)); } catch {}
  const identityKey = "cube-draft.player.v1";
  let playerId = localStorage.getItem(identityKey);
  if (!/^[a-f0-9]{64}$/.test(playerId || "")) {
    playerId = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(identityKey, playerId);
  }
  let settingsDirty = false, actionPending = 0, dialogMode = null, dialogOpener = null, dialogSessionId = null;
  const settingFields = [["lobby-main-size", "mainDeckSize"], ["lobby-rounds", "rounds"], ["lobby-pack-size", "size"], ["lobby-seconds", "seconds"]];
  let galleryCube = null, galleryPage = 0;
  const css = document.createElement("style");
  css.textContent = `
    #rooms-view { height:100%; min-height:0; overflow:auto; padding:8px 0; }
    #rooms-view[hidden], .room-hidden[hidden], #room-entry[hidden], #room-lobby[hidden], #room-error[hidden] { display:none; }
    .room-entry { max-width:660px; margin:clamp(12px,9vh,100px) auto 0; }
    .room-entry h1 { font-size:38px; margin:12px 0; letter-spacing:-1px; }
    .room-entry p { color:var(--muted); font-size:15px; margin:0 0 24px; }
    .room-name-label { display:block; font-size:13px; margin-bottom:8px; }
    .room-input { width:100%; background:#0c1521; border:1px solid #3a4d63; border-radius:7px; color:inherit; padding:12px; }
    .room-input:focus { outline:2px solid var(--accent); outline-offset:1px; }
    .room-entry-actions { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:18px; }
    .room-entry-actions button { padding:14px; }
    #room-resume { margin-top:14px; }
    .room-feedback { max-width:1100px; margin:0 auto 14px; font-size:13px; }
    #room-status:empty, #room-error:empty { display:none; }
    #room-error { color:#ffc4b9; padding:12px; background:#482b30; border-radius:7px; margin-top:8px; }
    .room-lobby-top { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:20px; }
    .room-lobby-top h1 { font-size:30px; margin:6px 0; }
    .room-code-box { display:flex; align-items:center; gap:16px; padding:12px 16px; }
    .room-code-box small { display:block; color:var(--muted); font-size:10px; letter-spacing:1.4px; margin-bottom:4px; }
    #active-room-code { font:700 23px Consolas,monospace; color:var(--accent); letter-spacing:3px; user-select:all; }
    .room-lobby-grid { display:grid; grid-template-columns:minmax(240px,.75fr) minmax(0,1.7fr); gap:18px; align-items:start; }
    .room-panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:18px; }
    .room-panel-head h2 { font-size:18px; }
    #room-members { list-style:none; margin:0; padding:0; display:grid; gap:9px; }
    .room-member { display:flex; align-items:center; gap:10px; padding:12px; border:1px solid var(--line); border-radius:8px; background:#0f1825; }
    .room-member.empty { text-align:left; color:var(--muted); border-style:dashed; }
    .room-seat { display:grid; place-items:center; width:30px; height:30px; border-radius:50%; background:#243a3b; color:var(--accent); font-size:12px; flex:none; }
    .room-member-name { flex:1; overflow-wrap:anywhere; font-size:14px; }
    .room-member-tag { font-size:10px; color:var(--accent); }
    .room-member button { flex:none; padding:7px 9px; font-size:12px; }
    #room-form { border:0; padding:0; margin:0; min-width:0; }
    #room-form:disabled { opacity:.8; }
    .room-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .room-form-grid label { font-size:12px; color:var(--muted); display:flex; flex-direction:column; gap:7px; }
    .room-form-grid input, .room-form-grid select { font-size:14px; min-width:0; }
    .room-form-grid .room-wide { grid-column:1/-1; }
    .room-help { font-size:12px; color:var(--muted); line-height:1.5; margin:14px 0; }
    .room-setting-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:18px; }
    .room-setting-actions #room-start { margin-left:auto; }
    .room-bottom-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:18px; }
    #room-close { color:#ffc4b9; }
    #draft-end-session { width:100%; margin:0; }
    #draft-end-session[hidden] { display:none; }
    .room-dialog-form { display:grid; gap:14px; }
    .room-dialog-form h2 { font-size:22px; margin:0; }
    .room-dialog-actions { display:flex; justify-content:flex-end; gap:8px; }
    #room-cube-dialog { max-width:1100px; width:calc(100vw - 40px); height:min(850px,94dvh); display:flex; flex-direction:column; gap:14px; }
    .room-gallery-header { display:flex; justify-content:space-between; gap:15px; align-items:center; }
    #room-cube-search { max-width:450px; }
    #room-cube-grid { min-height:0; flex:1; overflow:auto; display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; align-content:start; }
    #room-cube-grid .card { aspect-ratio:813/1185; }
    .room-gallery-caption { font-size:12px; margin:7px 0; overflow-wrap:anywhere; }
    .room-gallery-paging { display:flex; justify-content:space-between; align-items:center; gap:12px; font-size:12px; }
    @media(max-width:680px) {
      .room-entry { margin-top:10px; } .room-entry h1 { font-size:30px; }
      .room-lobby-top { align-items:flex-start; flex-direction:column; gap:10px; }
      .room-code-box { width:100%; justify-content:space-between; }
      .room-lobby-grid { grid-template-columns:1fr; }
      .room-form-grid { gap:10px; }
      .room-setting-actions #room-start { margin-left:0; }
      #room-cube-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    }
  `;
  document.head.append(css);
  const roomView = document.createElement("section"); roomView.id = "rooms-view";
  roomView.innerHTML = `
    <div class="room-feedback"><div id="room-status" role="status"></div><div id="room-error" role="alert" hidden></div></div>
    <div id="room-entry" class="room-entry panel">
      <div class="eyebrow">A seat at the table</div><h1>Draft rooms</h1>
      <p>Choose your name, then join your friends or create a room.</p>
      <label class="room-name-label" for="room-name">Player name</label>
      <input class="room-input" id="room-name" maxlength="40" autocomplete="nickname" placeholder="Enter your player name" required>
      <div class="room-entry-actions"><button id="room-join" disabled>Join Room</button><button id="room-create" class="primary" disabled>Create Room</button></div>
      <button id="room-resume" class="room-hidden" hidden>Resume saved room</button>
    </div>
    <div id="room-lobby" hidden>
      <div class="room-lobby-top"><div><div class="eyebrow" id="room-role">Draft lobby</div><h1>Draft room</h1><span class="small" id="room-lobby-note"></span></div>
        <div class="panel room-code-box"><div><small>ROOM CODE</small><strong id="active-room-code"></strong></div><button id="room-copy" aria-label="Copy room code">Copy code</button></div>
      </div>
      <div class="room-lobby-grid">
        <aside class="panel"><div class="room-panel-head"><h2>Room members</h2><span id="room-member-count" class="badge"></span></div><ol id="room-members"></ol>
          <div class="room-bottom-actions"><button id="room-return" class="room-hidden" hidden>Return to draft</button></div>
        </aside>
        <section class="panel"><div class="room-panel-head"><h2>Room settings</h2><span class="badge" id="room-settings-role"></span></div>
          <fieldset id="room-form"><div class="room-form-grid">
            <label class="room-wide" for="lobby-cube">Cube selector<select class="room-input" id="lobby-cube"><option value="">Select a Cube</option></select></label>
            <label for="lobby-main-size">Main Deck quantity<input class="room-input" id="lobby-main-size" type="number" min="20" max="60" value="40"></label>
            <label for="lobby-rounds">Packs per player<input class="room-input" id="lobby-rounds" type="number" min="1" max="12" value="3"></label>
            <label for="lobby-pack-size">Cards per pack<input class="room-input" id="lobby-pack-size" type="number" min="1" max="30" value="15"></label>
            <label for="lobby-seconds">Seconds per pick<input class="room-input" id="lobby-seconds" type="number" min="0" max="300" value="30"><span>0 = no time limit</span></label>
          </div></fieldset>
          <p id="room-capacity" class="room-help"></p>
          <div class="room-setting-actions"><button id="room-view-cube">View Cube cards</button><button id="lobby-save" class="room-hidden" hidden>Save settings</button><button id="room-start" class="primary room-hidden" hidden>Start Draft</button></div>
          <p id="room-start-help" class="room-help"></p>
          <div id="room-lifecycle" class="room-bottom-actions"><button id="room-end-session" class="room-hidden" hidden>End drafting session</button><button id="room-close" class="room-hidden" hidden>Close room for everyone</button><button id="room-leave" class="room-hidden" hidden>Leave room</button></div>
          <p id="room-lifecycle-help" class="room-help"></p>
        </section>
      </div>
    </div>`;
  document.querySelector("main").append(roomView);
  const endSessionButton = document.createElement("button");
  endSessionButton.id = "draft-end-session"; endSessionButton.type = "button";
  endSessionButton.textContent = "End drafting session"; endSessionButton.hidden = true;
  $("deck-actions").prepend(endSessionButton);
  const modal = document.createElement("div"); modal.id = "room-entry-modal"; modal.className = "overlay"; modal.hidden = true;
  modal.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="room-dialog-title"><form class="room-dialog-form" id="room-entry-form">
    <h2 id="room-dialog-title"></h2><p class="small" id="room-dialog-description"></p>
    <label id="join-code-label" class="room-hidden" for="room-code">Room code<input class="room-input" id="room-code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Eight-character code"></label>
    <label id="create-count-label" class="room-hidden" for="room-player-count">Allowed players (including you)<input class="room-input" id="room-player-count" type="number" min="2" max="6" value="4"></label>
    <div id="room-dialog-error" class="warning" role="alert"></div><div class="room-dialog-actions"><button type="button" id="room-dialog-cancel">Cancel</button><button id="room-confirm" class="primary" type="submit">Confirm</button></div>
  </form></div>`;
  document.body.append(modal);
  const gallery = document.createElement("div"); gallery.id = "room-cube-modal"; gallery.className = "overlay"; gallery.hidden = true;
  gallery.innerHTML = `<div class="dialog" id="room-cube-dialog" role="dialog" aria-modal="true" aria-labelledby="room-cube-title">
    <div class="room-gallery-header"><div><h2 id="room-cube-title">Cube cards</h2><p class="small" id="room-cube-summary"></p></div><button id="room-cube-close">Close</button></div>
    <input id="room-cube-search" class="room-input" type="search" aria-label="Search Cube cards" placeholder="Search card names">
    <div id="room-cube-grid"></div><div class="room-gallery-paging"><button id="room-cube-previous">Previous</button><span id="room-cube-page"></span><button id="room-cube-next">Next</button></div></div>`;
  document.body.append(gallery);
  const roomNav = document.createElement("button"); roomNav.id = "rooms-nav"; roomNav.textContent = "Draft rooms"; document.querySelector("nav").prepend(roomNav);
  const localView = view;
  view = name => { roomView.hidden = name !== "rooms"; localView(name); if (name === "rooms") renderLobby(); };
  $("room-name").value = localStorage.getItem("cube-draft.player-name.v1") || "";
  $("room-resume").hidden = !credential;
  const setText = (id, value) => {
    if ($(id).textContent !== value) $(id).textContent = value;
  };
  const message = value => setText("room-status", value);
  const updateSeats = () => setText("seats", room.players.map(p => `${p.name}${p.you ? " (you)" : ""}: ${p.count} picks${p.picked ? " · ready" : ""}`).join(" | "));
  async function request(url, body) {
    const response = await fetch(url, { method: body ? "POST" : "GET", headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(credential ? { Authorization: "Bearer " + credential.token } : {})
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) {
      if (result.code === "ROOM_REMOVED") forgetRoom(result.error);
      throw Object.assign(Error(result.error || "Room request failed."), { removed: result.code === "ROOM_REMOVED" });
    }
    return result;
  }
  function syncEntry() {
    const validName = Boolean($("room-name").value.trim());
    $("room-join").disabled = !validName || Boolean(room) || actionPending > 0;
    $("room-create").disabled = !validName || Boolean(room) || actionPending > 0;
    $("room-confirm").disabled = actionPending > 0;
    $("room-entry").hidden = Boolean(room);
    $("room-lobby").hidden = !room;
  }
  function refreshCubeOptions() {
    const select = $("lobby-cube"), chosen = settingsDirty ? select.value : room?.cube?.id || "";
    const cubes = library.filter(c => !c.sample);
    const list = [...cubes];
    if (room?.cube && !list.some(c => c.id === room.cube.id)) list.push(room.cube);
    const html = '<option value="">Select a Cube</option>' + list.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    if (select.innerHTML !== html) select.innerHTML = html;
    select.value = chosen;
  }
  function settingsBody() {
    const selectedId = $("lobby-cube").value;
    const body = { config: Object.fromEntries(settingFields.map(([id, key]) => [key, Number($(id).value)])),
      cube: selectedId ? library.find(c => c.id === selectedId) || (room.cube?.id === selectedId ? undefined : null) : null };
    if (body.cube === undefined) delete body.cube;
    return body;
  }
  function needsSettingsSave() {
    return settingsDirty || $("lobby-cube").value !== (room.cube?.id || "") || settingFields.some(([id, key]) => Number($(id).value) !== room.config[key]);
  }
  function selectedLobbyCube() {
    const selectedId = $("lobby-cube").value;
    return library.find(c => c.id === selectedId) || (room.cube?.id === selectedId ? room.cube : null);
  }
  function lobbyReadiness() {
    if (room.players.length !== room.config.players) return { ready: false, reason: "Fill every seat with a player or bot before starting." };
    const selectedCube = selectedLobbyCube();
    if (!selectedCube) return { ready: false, reason: "Select a Cube before starting." };
    for (const [id] of settingFields) {
      const input = $(id), value = Number(input.value);
      if (!input.value.trim() || !Number.isInteger(value) || value < Number(input.min) || value > Number(input.max))
        return { ready: false, reason: `${input.labels[0].childNodes[0].textContent.trim()} must be a whole number from ${input.min} to ${input.max}.` };
    }
    const copies = selectedCube.cards ? total(selectedCube) : selectedCube.copies;
    const required = room.config.players * Number($("lobby-rounds").value) * Number($("lobby-pack-size").value);
    if (copies < required) return { ready: false, reason: `This draft needs ${required} copies; the selected Cube contains ${copies}. Reduce the packs or cards per pack, or select a larger Cube.` };
    return { ready: true, reason: needsSettingsSave() ? "Start Draft will save these settings and begin the draft." : "All seats are filled. Your room is ready to draft." };
  }
  async function saveSettings(body) {
    const next = await request(`/api/rooms/${credential.code}/settings`, body);
    settingsDirty = false; roomSignature = null; applyRoom(next);
  }
  function renderLobby() {
    syncEntry();
    if (!room) { $("room-end-session").hidden = true; endSessionButton.hidden = true; return; }
    setText("active-room-code", room.code);
    setText("room-role", room.host ? "Host lobby" : "Guest lobby");
    setText("room-lobby-note", room.phase === "lobby" ? "Invite players or fill empty seats with bots before drafting." : "Your draft is saved. Return to the table to continue.");
    setText("room-member-count", `${room.players.length}/${room.config.players}`);
    const members = Array.from({ length: room.config.players }, (_, i) => {
      const p = room.players.find((p, index) => (p.slot ?? index) === i);
      const disabled = room.phase !== "lobby" || actionPending > 0 ? "disabled" : "";
      const action = !room.host || i === 0 ? "" : p
        ? `<button data-room-remove="${esc(p.id)}" aria-label="Remove ${esc(p.name)}" title="Seats can be changed before drafting starts" ${disabled}>Remove</button>`
        : `<button data-room-add-bot="${i}" aria-label="Add bot to seat ${i+1}" ${disabled}>Add bot</button>`;
      return `<li class="room-member${p ? "" : " empty"}"><span class="room-seat">${i+1}</span><span class="room-member-name">${p ? esc(p.name) : "Waiting for player"}</span>${p ? `<span class="room-member-tag">${p.host || i === 0 ? "Host" : p.bot ? "Bot" : "Guest"}${p.you ? " · You" : ""}${p.left ? " · Left" : ""}</span>` : ""}${action}</li>`;
    }).join("");
    if ($("room-members").innerHTML !== members) $("room-members").innerHTML = members;
    $("room-form").disabled = !room.host || room.phase !== "lobby" || actionPending > 0;
    setText("room-settings-role", room.host ? "Host controls" : "View only");
    refreshCubeOptions();
    if (!settingsDirty || !room.host) {
      for (const [id, key] of settingFields) {
        if ($(id).value !== String(room.config[key])) $(id).value = room.config[key];
      }
    }
    $("lobby-save").hidden = !room.host || room.phase !== "lobby";
    $("lobby-save").disabled = !needsSettingsSave() || actionPending > 0;
    $("room-start").hidden = !room.host || room.phase !== "lobby";
    const readiness = lobbyReadiness();
    $("room-start").disabled = room.phase !== "lobby" || !readiness.ready || actionPending > 0;
    $("room-close").hidden = !room.host;
    $("room-close").disabled = actionPending > 0;
    const canEndSession = room.host && ["drafting", "finished"].includes(room.phase);
    for (const button of [$("room-end-session"), endSessionButton]) { button.hidden = !canEndSession; button.disabled = actionPending > 0; }
    $("room-leave").hidden = room.host;
    $("room-leave").disabled = !["lobby", "finished"].includes(room.phase) || actionPending > 0;
    setText("room-lifecycle-help", room.host
      ? canEndSession ? "End the drafting session to return everyone to this lobby. Close room ends the entire room. Draft data stays on the server." : "Close this room to end the session for everyone. Saved draft data stays on the server."
      : room.phase === "drafting"
        ? `Only the host (${room.players[0].name}) can close a running draft. You can leave when drafting is complete.`
        : `Only the host (${room.players[0].name}) can close the room for everyone. You can leave to create or join another room; saved draft data stays on the server.`);
    $("room-return").hidden = room.phase === "lobby";
    $("room-view-cube").disabled = !(room.cube || room.host && $("lobby-cube").value);
    const selectedCube = selectedLobbyCube();
    setText("room-capacity", selectedCube ? `${selectedCube.name} · ${selectedCube.cards?.length ?? selectedCube.uniqueCards} unique cards · ${selectedCube.cards ? total(selectedCube) : selectedCube.copies} copies · ${room.config.players * Number($("lobby-rounds").value) * Number($("lobby-pack-size").value)} copies needed` : "Select the built-in Mock Cube, or import a Cube in the Cube library and select it here.");
    setText("room-start-help", room.host ? readiness.reason : "Only the host can modify settings and start the draft.");
  }
  function forgetRoom(text) {
    modal.hidden = true; gallery.hidden = true;
    credential = null; room = null; state = null; selected = null;
    roomSignature = null; draftSignature = null; settingsDirty = false;
    localStorage.removeItem(resumeKey); $("room-resume").hidden = true;
    closeCardDialog(); render(); syncEntry();
    if ($("cube-editor").hidden) view("rooms");
    message(text);
  }
  function draftSnapshotSignature(snapshot) {
    // A newly saved section can appear in a different property order on the server.
    const pool = snapshot.pool.map(({ deckSection, ...card }) => [card, deckSection]);
    return JSON.stringify([snapshot.code, snapshot.sessionId, snapshot.phase, snapshot.config, snapshot.cube,
      snapshot.pack, pool, snapshot.round, snapshot.pick, snapshot.deadline, snapshot.deckOrder]);
  }
  function applyRoom(next, savedSwapSignature = null) {
    const signature = JSON.stringify(next);
    if (signature === roomSignature) return;
    const previous = room, changedRoom = previous?.code !== next.code;
    if (next.phase === "closed") { forgetRoom("This room has been closed by its host."); return; }
    roomSignature = signature; room = next;
    if (changedRoom) settingsDirty = false;
    const me = room.players.find(p => p.you);
    if (me) { $("room-name").value = me.name; localStorage.setItem("cube-draft.player-name.v1", me.name); }
    renderLobby();
    // Rooms saved before the built-in Cube existed can have no Cube selected.
    // Offer the same default as a new room, then save it when the host starts.
    if (changedRoom && room.host && room.phase === "lobby" && !room.cube) {
      $("lobby-cube").value = MockCube.id;
      settingsDirty = true;
      renderLobby();
    }
    if (room.phase === "lobby") {
      if (changedRoom || previous?.phase !== "lobby") {
        closeCardDialog(); selected = null; hoverCard = null; gallery.hidden = true;
        if (!modal.hidden && dialogMode === "end-session") hideDialog();
        state = null; render();
        if ($("cube-editor").hidden) view("rooms");
        if (previous && !changedRoom) { clearError(); message("Drafting session ended. You are back in the same room, ready for another draft."); }
      }
      draftSignature = null;
      return;
    }
    updateSeats();
    const nextDraftSignature = draftSnapshotSignature(room);
    if (nextDraftSignature === draftSignature) return;
    draftSignature = nextDraftSignature;
    if (nextDraftSignature === savedSwapSignature) {
      // The swap already moved the loaded card elements. Keep them in place
      // while adopting the saved pool order for subsequent sorts and swaps.
      state.pools[0] = structuredClone(room.pool);
      return;
    }
    if (changedRoom || previous?.phase === "lobby" || previous?.sessionId !== room.sessionId) {
      closeCardDialog(); selected = null; hoverCard = room.pack[0] || room.pool[0] || null;
    }
    config = room.config;
    state = { cubeId: "room-" + room.code, pools: [structuredClone(room.pool)], packs: [structuredClone(room.pack)], round: room.round,
      pick: room.pick, deadline: room.deadline, finished: room.phase === "finished", deckOrder: room.deckOrder };
    if (changedRoom || !room.pack.some(card => card.instanceId === selected)) selected = null;
    if (modalCard && (changedRoom || !(modalPicking ? room.pack : [...room.pack, ...room.pool]).some(card => card.instanceId === modalCard.instanceId))) closeCardDialog();
    if ((changedRoom || previous?.phase === "lobby") && $("cube-editor").hidden) view("table");
    render(); updateSeats();
    setText("status", room.phase === "finished" ? "Draft complete. Build your deck." : room.pack.length ? "Choose your card." : "Pick saved. Waiting for the other players.");
  }
  function clearError() {
    $("room-error").textContent = "";
    $("room-error").hidden = true;
    errorSource = null;
  }
  function run(work, background = false) {
    if (background && busy) return;
    pending++;
    busy = true;
    if (!background) actionPending++;
    syncEntry(); if (room) renderLobby();
    // User actions wait for an in-flight refresh instead of being silently discarded.
    queue = queue.then(async () => {
      if (!background) clearError();
      try {
        await work();
        if (background && errorSource === "refresh") clearError();
      } catch (error) {
        if (error.removed) return;
        // A successful refresh of the previous room must not erase a failed join.
        if (!background || errorSource !== "action") {
          $("room-error").textContent = error.message + (credential ? " Your saved seat is retained." : "");
          $("room-error").hidden = false;
          errorSource = background ? "refresh" : "action";
        }
      } finally { pending--; busy = pending > 0; if (!background) actionPending--; syncEntry(); if (room) renderLobby(); }
    });
    return queue;
  }
  function remember(next) {
    const saved = { code: next.code, token: next.token };
    // Save before exposing the room so refresh can recover the new seat.
    localStorage.setItem(resumeKey, JSON.stringify(saved));
    credential = saved; $("room-resume").hidden = false;
    delete next.token; applyRoom(next);
  }
  function showDialog(mode) {
    if ((mode === "join" || mode === "create") && !$("room-name").value.trim()) { view("rooms"); $("room-name").focus(); return; }
    if ((mode === "join" || mode === "create") && room) { view("rooms"); message("Close or leave your current room before opening another."); return; }
    if (mode === "end-session" && (!room?.host || !["drafting", "finished"].includes(room.phase))) return;
    dialogMode = mode; dialogOpener = document.activeElement;
    dialogSessionId = room?.sessionId || null;
    $("room-dialog-error").textContent = "";
    $("join-code-label").hidden = mode !== "join";
    $("create-count-label").hidden = mode !== "create";
    $("room-code").required = mode === "join"; $("room-code").disabled = mode !== "join";
    $("room-player-count").required = mode === "create"; $("room-player-count").disabled = mode !== "create";
    setText("room-dialog-title", mode === "join" ? "Join Room" : mode === "create" ? "Create Room" : mode === "end-session" ? "End drafting session?" : "Close room?");
    setText("room-dialog-description", mode === "join" ? "Enter the room code shared by your host." : mode === "create" ? "Choose the total number of players, including yourself. Select your Cube and settings in the lobby." : mode === "end-session" ? "Everyone will return to the lobby. The room code, remaining players, bots, Cube and settings stay in place. The current draft is saved on the server and cleared from the table." : `Room ${room.code} will close for all members. Saved draft data is retained on the server.`);
    setText("room-confirm", mode === "join" ? "Join Room" : mode === "create" ? "Create Room" : mode === "end-session" ? "End session" : "Close room");
    modal.hidden = false;
    $(mode === "join" ? "room-code" : mode === "create" ? "room-player-count" : "room-dialog-cancel").focus();
  }
  function hideDialog() { modal.hidden = true; if (dialogOpener?.isConnected) dialogOpener.focus(); }
  $("room-name").oninput = () => { localStorage.setItem("cube-draft.player-name.v1", $("room-name").value); syncEntry(); };
  $("room-join").onclick = () => showDialog("join");
  $("room-create").onclick = () => showDialog("create");
  $("room-dialog-cancel").onclick = hideDialog;
  modal.onclick = event => { if (event.target === modal) hideDialog(); };
  $("room-entry-form").onsubmit = event => {
    event.preventDefault();
    const name = $("room-name").value.trim(), code = $("room-code").value.trim().toUpperCase(), players = Number($("room-player-count").value), mode = dialogMode, sessionId = dialogSessionId;
    run(async () => {
      try {
        if (mode === "end-session") {
          const next = await request(`/api/rooms/${credential.code}/end-session`, { sessionId });
          hideDialog(); applyRoom(next); return;
        }
        if (mode === "close") { await request(`/api/rooms/${credential.code}/close`, {}); hideDialog(); forgetRoom("Room closed. You can create another room."); return; }
        if (!name) throw Error("Enter a player name.");
        if (mode === "join" && !/^[A-F0-9]{8}$/.test(code)) throw Error("Enter an eight-character room code.");
        localStorage.setItem("cube-draft.storage-check", "1"); localStorage.removeItem("cube-draft.storage-check");
        const next = mode === "join" ? await request(`/api/rooms/${code}/join`, { name, playerId }) : await request("/api/rooms", { name, playerId, config: { players } });
        remember(next); hideDialog(); view("rooms");
      } catch (error) { $("room-dialog-error").textContent = error.message; }
    });
  };
  $("room-resume").onclick = () => run(async () => { if (credential) applyRoom(await request(`/api/rooms/${credential.code}`)); });
  $("room-start").onclick = () => {
    if (!room?.host || room.phase !== "lobby" || !lobbyReadiness().ready) return;
    const body = needsSettingsSave() ? settingsBody() : null;
    run(async () => {
      if (body) await saveSettings(body);
      applyRoom(await request(`/api/rooms/${credential.code}/start`, {}));
    });
  };
  $("room-close").onclick = () => showDialog("close");
  $("room-end-session").onclick = endSessionButton.onclick = () => showDialog("end-session");
  $("room-leave").onclick = () => run(async () => { await request(`/api/rooms/${credential.code}/leave`, {}); forgetRoom("You left the room."); });
  $("room-members").onclick = event => {
    const add = event.target.closest("[data-room-add-bot]"), remove = event.target.closest("[data-room-remove]");
    if ((!add && !remove) || !room?.host || room.phase !== "lobby" || actionPending > 0) return;
    const code = room.code, body = add ? { slot: Number(add.dataset.roomAddBot) } : { playerId: remove.dataset.roomRemove };
    run(async () => {
      applyRoom(await request(`/api/rooms/${code}/${add ? "add-bot" : "remove-player"}`, body));
      message(add ? "Bot added. It will make random picks when the draft starts." : "Player removed from the room.");
    });
  };
  $("rooms-nav").onclick = () => { view("rooms"); renderLobby(); };
  $("room-return").onclick = () => view("table");
  $("settings-open").textContent = "Room settings";
  $("settings-open").onclick = () => { view("rooms"); if (room) renderLobby(); else $("room-name").focus(); };
  $("table-nav").onclick = $("back-table").onclick = () => view(room?.phase === "drafting" || room?.phase === "finished" ? "table" : "rooms");
  openSettings = id => {
    $("settings").hidden = true; view("rooms");
    if (room?.host && room.phase === "lobby" && library.some(c => c.id === id)) { $("lobby-cube").value = id; settingsDirty = true; }
    renderLobby();
  };
  $("start").onclick = () => { $("settings").hidden = true; view("rooms"); showDialog("create"); };
  for (const id of ["lobby-cube","lobby-main-size","lobby-rounds","lobby-pack-size","lobby-seconds"]) $(id).oninput = () => { settingsDirty = true; renderLobby(); };
  $("lobby-save").onclick = () => {
    const body = settingsBody();
    run(async () => { await saveSettings(body); message("Room settings saved."); });
  };
  $("room-copy").onclick = async () => {
    if (!room) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(room.code);
      else {
        const input = document.createElement("textarea"); input.value = room.code; input.style.cssText = "position:fixed;opacity:0"; document.body.append(input); input.select();
        const copied = document.execCommand("copy"); input.remove(); if (!copied) throw Error("Clipboard access unavailable"); $("room-copy").focus();
      }
      message("Room code copied to clipboard.");
    } catch { message("Clipboard access was denied. Select the room code and copy it manually."); }
  };
  function renderGallery() {
    if (!galleryCube) return;
    const query = $("room-cube-search").value.trim().toLocaleLowerCase();
    const cards = galleryCube.cards.filter(c => c.name.toLocaleLowerCase().includes(query));
    const pages = Math.max(1, Math.ceil(cards.length / 48)); galleryPage = Math.min(galleryPage, pages - 1);
    setText("room-cube-title", galleryCube.name);
    setText("room-cube-summary", `${galleryCube.cards.length} unique cards · ${total(galleryCube)} copies`);
    $("room-cube-grid").innerHTML = cards.slice(galleryPage * 48, (galleryPage + 1) * 48).map(c => `<article>${cardHtml(c)}<p class="room-gallery-caption">${esc(c.name)} · ×${c.copies}</p></article>`).join("") || '<p class="empty">No matching cards.</p>';
    setText("room-cube-page", `Page ${galleryPage + 1} of ${pages} · ${cards.length} cards`);
    $("room-cube-previous").disabled = galleryPage === 0; $("room-cube-next").disabled = galleryPage >= pages - 1;
  }
  $("room-view-cube").onclick = () => run(async () => {
    const local = room.host && library.find(c => c.id === $("lobby-cube").value);
    galleryCube = local || (await request(`/api/rooms/${credential.code}/cube`)).cube;
    galleryPage = 0; $("room-cube-search").value = ""; renderGallery(); gallery.hidden = false; $("room-cube-close").focus();
  });
  function closeGallery() { gallery.hidden = true; $("room-view-cube").focus(); }
  $("room-cube-close").onclick = closeGallery;
  gallery.onclick = event => { if (event.target === gallery) closeGallery(); };
  $("room-cube-search").oninput = () => { galleryPage = 0; renderGallery(); };
  $("room-cube-previous").onclick = () => { galleryPage--; renderGallery(); };
  $("room-cube-next").onclick = () => { galleryPage++; renderGallery(); };
  document.addEventListener("keydown", event => {
    const active = !modal.hidden ? modal : !gallery.hidden ? gallery : null;
    if (!active) return;
    if (event.key === "Escape") { event.preventDefault(); active === modal ? hideDialog() : closeGallery(); }
    if (event.key === "Tab") {
      const nodes = [...active.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(n => n.getClientRects().length);
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }
  });
  syncEntry(); view("rooms");
  pick = id => run(async () => {
    if (!room || room.phase !== "drafting") return;
    applyRoom(await request(`/api/rooms/${credential.code}/pick`, { instanceId: id, round: room.round, pick: room.pick }));
  });
  const originalSwap = swapDeckCards;
  swapDeckCards = (source, target) => {
    if (busy) return false;
    const swapped = originalSwap(source, target);
    if (swapped) {
      const deckOrder = state.deckOrder;
      const poolById = new Map(state.pools[0].map(card => [card.instanceId, card]));
      const cards = deckOrder.map(id => ({ ...poolById.get(id) }));
      const savedSwapSignature = draftSnapshotSignature({ ...room, pool: cards, deckOrder });
      run(async () => {
        applyRoom(await request(`/api/rooms/${credential.code}/deck`, { cards }), savedSwapSignature);
      });
    }
    return swapped;
  };
  setInterval(() => {
    updateTimer();
    if (credential) run(async () => applyRoom(await request(`/api/rooms/${credential.code}`)), true);
  }, 1000);
  if (credential) $("room-resume").click();
}
