const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {card,contentPage,send,spellTrap,popup,pendulumCard,xyzCard,newPage}=require('../extension/tests/harness.cjs');

test('Link sockets export active directions and render the corresponding arrows',async()=>{
  const directions=['top-left','top','top-right','right','bottom-right','bottom','bottom-left','left'];
  const html=card('42','Link Arrow Example').replace('</div>',
    '<img class="card_color" src="https://example.test/link_front.webp"><span class="type_txt">Dragon / Link / Effect</span><span class="link_txt">4</span>'+
    directions.map((_,i)=>`<img class="red_arrow red_arrow${i+1}" style="display:${i%2===0?'block':'none'}" src="https://example.test/red_arrow_corner.webp">`).join('')+'</div>');
  const page=await contentPage(`<div id="extra_cards">${html}</div>`);
  try {
    const scanned=(await send(page,{type:'DBCD_SCAN'})).cards[0];
    assert.deepEqual(scanned.visual.linkArrows,['top-left','top-right','bottom-right','bottom-left']);
    const {loadAssets,renderCard}=require('../drafter/renderer/render.cjs');
    const registry=loadAssets(path.join(__dirname,'../drafter/renderer/packs'),require('../drafter/renderer/packs/manifest.json'));
    const rendered=renderCard(scanned,registry);
    assert.equal((rendered.svg.match(/data-link-arrow=/g)||[]).length,4);
    assert.equal(rendered.diagnostics.includes('link-arrows-unresolved'),false);
    const pop=await popup(page,'https://www.duelingbook.com/',{'42':{...scanned,copies:3}});
    try {
      await pop.locator('#scan').click();
      await pop.waitForFunction(()=>window.saved.dbcd_cards_v1['42']?.copies===3);
      assert.deepEqual(await pop.evaluate(()=>window.saved.dbcd_cards_v1['42'].visual.linkArrows),scanned.visual.linkArrows);
    } finally {await pop.close();}
    await page.locator('.red_arrow').evaluateAll(arrows=>arrows.forEach(arrow=>arrow.style.display='block'));
    const all=(await send(page,{type:'DBCD_SCAN'})).cards[0];
    assert.deepEqual(all.visual.linkArrows,directions);
    assert.equal((renderCard(all,registry).svg.match(/data-link-arrow=/g)||[]).length,8);
  } finally {await page.close();}
});

test('official and custom Spell/Trap subtypes survive extraction and reach renderer icons',async()=>{
  const {renderCard}=require('../drafter/renderer/render.cjs');
  const cases=[...['Normal','Continuous','Equip','Quick-Play','Field','Ritual'].map(type=>['Spell',type]),
    ...['Normal','Continuous','Counter'].map(type=>['Trap',type])];
  const fixtures=cases.flatMap(([family,type])=>[false,true].map(official=>({family,type,official})));
  const source=await contentPage(`<div class="deck_cards">${fixtures.map(({family,type,official},i)=>spellTrap(String(i+1),family,type,official)).join('')}</div>`);
  try {
    const result=await send(source,{type:'DBCD_SCAN'});
    assert.equal(result.ok,true);assert.equal(result.cards.length,18);
    for (const [i,record] of result.cards.entries()) {
      const {family,type,official}=fixtures[i];
      const icon=type.toLowerCase();
      assert.equal(record.type,`[ ${family.toUpperCase()} CARD ]`);
      assert.equal(record.origin,official?'official':'custom');
      assert.deepEqual(record.visual,{version:1,spellTrapIcon:icon});
      const rendered=renderCard(JSON.parse(JSON.stringify(record)),{assets:new Map(),artworks:new Map()});
      assert.equal(rendered.model.icon,icon);
      assert.equal(rendered.diagnostics.includes('spell-trap-icon-unresolved'),false);
      assert.equal(rendered.diagnostics.includes(`missing-asset:icon.${icon}`),icon!=='normal');
    }
  } finally {await source.close();}
});

for (const official of [false,true]) {
  test(`${official?'official':'custom'} Pendulum scales reach the renderer, including zero in hidden Extra Decks`,async()=>{
    const {renderCard}=require('../drafter/renderer/render.cjs');
    const source=await contentPage(`<div class="extra_cards" style="display:none">${pendulumCard('42',0,13,official)}</div>`);
    try {
      const {cards}=await send(source,{type:'DBCD_SCAN'});
      assert.equal(cards.length,1);
      assert.deepEqual(cards[0].visual,{version:1,pendulum:true,scaleLeft:0,scaleRight:13});
      const rendered=renderCard(JSON.parse(JSON.stringify(cards[0])),{assets:new Map(),artworks:new Map()});
      assert.equal(rendered.model.scaleLeft,0);assert.equal(rendered.model.scaleRight,13);
      assert.equal(rendered.diagnostics.includes('pendulum-scales-unresolved'),false);
    } finally {await source.close();}
  });
}

for (const official of [false,true]) {
  test(`${official?'official':'custom'} Xyz ranks extract separately from levels and render rank stars`,async()=>{
    const {renderCard}=require('../drafter/renderer/render.cjs');
    const source=await contentPage(`<div class="extra_cards" style="display:none">${xyzCard('42',4,official)}${xyzCard('43',13,official,true)}</div>`);
    try {
      const {cards}=await send(source,{type:'DBCD_SCAN'});
      assert.equal(cards.length,2);
      for (const [i,record] of cards.entries()) {
        const rank=i===0?4:13;
        assert.equal(record.visual.rank,rank);assert.equal(record.level,null);
        const rendered=renderCard(record,{assets:new Map(),artworks:new Map()});
        assert.equal(rendered.model.count,rank);assert.equal(rendered.model.frame,'xyz');
        assert.equal((rendered.svg.match(/data-star="rank"/g)||[]).length,rank);
        assert.equal(rendered.diagnostics.includes('level-rank-unresolved'),false);
      }
      assert.equal(cards[1].visual.scaleLeft,2);assert.equal(cards[1].visual.scaleRight,8);
    } finally {await source.close();}
  });
}

test('Xyz rescan repairs old records and Cube export/restore retains rank stars',async()=>{
  const {renderCard}=require('../drafter/renderer/render.cjs');
  const source=await contentPage(`<div class="extra_cards">${xyzCard('42',4)}</div>`);
  const old={id:'42',name:'Old Xyz',level:null,copies:3,section:'extra',importedAt:'2025-01-01',notes:'keep',visual:{version:1,customNote:'keep'}};
  const ui=await popup(source,'https://www.duelingbook.com/',{'42':old});
  const restored=await popup(source);
  try {
    await ui.locator('#scan').click();
    await ui.waitForFunction(()=>window.saved.dbcd_cards_v1['42'].visual.rank===4);
    await ui.evaluate(()=>{URL.createObjectURL=blob=>{window.exportedCube=blob.text();return 'blob:test';};});
    await ui.locator('#export').click();
    const exported=await ui.evaluate(()=>window.exportedCube);
    const record=JSON.parse(exported).cards[0];
    assert.equal(record.visual.rank,4);assert.equal(record.visual.customNote,'keep');
    assert.equal(record.copies,3);assert.equal(record.section,'extra');assert.equal(record.notes,'keep');assert.equal(record.importedAt,old.importedAt);
    await restored.locator('#json-file').setInputFiles({name:'cube.json',mimeType:'application/json',buffer:Buffer.from(exported)});
    await restored.waitForFunction(()=>window.saved.dbcd_cards_v1['42']);
    const saved=await restored.evaluate(()=>window.saved.dbcd_cards_v1['42']);
    assert.deepEqual(saved,record);
    assert.equal((renderCard(saved,{assets:new Map(),artworks:new Map()}).svg.match(/data-star="rank"/g)||[]).length,4);
  } finally {await ui.close();await restored.close();await source.close();}
});

test('drafting client retains extracted Xyz rank and loads an SVG with rank stars',async()=>{
  const {renderCard}=require('../drafter/renderer/render.cjs');
  const source=await contentPage(`<div class="extra_cards">${xyzCard('42',4)}</div>`);
  const page=await newPage();
  let payload, rendered;
  try {
    const record=JSON.parse(JSON.stringify((await send(source,{type:'DBCD_SCAN'})).cards[0]));
    await page.route('https://draft.test/**',async route=>{
      if (route.request().url().endsWith('/api/draft-render')) {
        payload=route.request().postDataJSON();
        rendered=renderCard(payload,{assets:new Map(),artworks:new Map()});
        return route.fulfill({json:{url:`/renders/${rendered.hash}.svg`,diagnostics:rendered.diagnostics}});
      }
      if (route.request().url().includes('/renders/')) return route.fulfill({contentType:'image/svg+xml',body:rendered.svg});
      return route.fulfill({contentType:'text/html',body:'<div id="pack"></div>'});
    });
    await page.goto('https://draft.test/');
    await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../drafter/frontend/draft-renderer.js'),'utf8')});
    await page.evaluate(card=>{document.getElementById('pack').innerHTML=DraftCards.cardHtml(card,'<div class="card"></div>');},record);
    await page.waitForSelector('#pack .has-render .rendered-card');
    assert.equal(payload.visual.rank,4);assert.equal(payload.level,undefined);
    assert.equal((rendered.svg.match(/data-star="rank"/g)||[]).length,4);
  } finally {await page.close();await source.close();}
});
