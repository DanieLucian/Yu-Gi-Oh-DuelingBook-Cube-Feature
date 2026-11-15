const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const path=require('node:path');
const fs=require('node:fs');
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
function card(id,name,official=false) {
  const art=official?`https://example.test/pics/${id}.jpg`:`https://example.test/custom-pics/1/${id}.png`;
  return `<div class="cardfront_content"><span class="name_txt">${name}</span><img class="pic" src="${art}"><div class="effect_txt">Effect for ${name}</div></div>`;
}
async function contentPage(html) {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.abort());
  await page.setContent(`<style>.cardfront_content{position:relative;width:400px;height:580px}</style>${html}`);
  await page.evaluate(()=>{window.chrome={runtime:{onMessage:{addListener(fn){window.receive=fn;}}}};});
  await page.addScriptTag({path:path.resolve('content.js')});
  return page;
}
function send(page,message) {
  return page.evaluate(message=>new Promise(resolve=>window.receive(message,{},resolve)),message);
}
// Matches DuelingBook's CardFront template: the subtype is an image, and
// Normal cards retain a hidden continuous.webp placeholder.
function spellTrap(id, family, subtype, official=false) {
  return card(id, `${subtype} ${family}`, official).replace('</div>',
    `<img class="card_color" src="https://example.test/${family.toLowerCase()}_front2.webp">
    <span class="type_txt" style="display:none">Spellcaster / Effect</span>
    <span class="spell_type_txt">[ ${family.toUpperCase()} CARD ]</span>
    <img class="type_icon" ${subtype==='Normal'?'style="display:none"':''}
      src="https://example.test/${subtype==='Normal'?'continuous':subtype.toLowerCase()}.webp?v=1"></div>`);
}
async function popup(content,url='https://www.duelingbook.com/',cards={}) {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.abort());
  await page.setContent(fs.readFileSync('popup.html','utf8').replace('<script src="popup.js"></script>',''));
  await page.exposeFunction('sendToTab',message=>send(content,message));
  await page.evaluate(({url,cards})=>{
    window.saved={dbcd_cards_v1:cards};window.sent=[];
    window.chrome={storage:{local:{get:async()=>structuredClone(window.saved),set:async value=>{window.saved=structuredClone(value);}}},tabs:{query:async()=>[{id:1,url}],sendMessage:async(_id,message)=>{window.sent.push(message.type);return window.sendToTab(message);}}};
  },{url,cards});
  await page.addScriptTag({path:path.resolve('popup.js')});
  await page.waitForFunction(()=>document.querySelector('#site-state').textContent!=='Checking page…');
  return page;
}
test('editor includes official/custom cards in both containers and excludes search results and hover cards',async()=>{
  const page=await contentPage(`<div id="search_results">${card('99','Search result')}</div>
    <div id="deck_cards">${card('42','Custom deck monster')}<div>${card('blue-eyes','Official monster',true)}</div></div>
    <div id="side_cards">${card('43','Side trap')}${card('42','Custom deck monster')}</div>
    <div id="hover_preview">${card('100','Hover card')}</div>`);
  try {
    assert.deepEqual(await send(page,{type:'DBCD_CONTEXT'}),{ok:true,editor:true});
    const result=await send(page,{type:'DBCD_SCAN'});
    assert.equal(result.ok,true);assert.equal(result.rendered,4);assert.equal(result.cards.length,3);
    assert.deepEqual(result.cards.map(c=>c.name).sort(),['Custom deck monster','Official monster','Side trap']);
    assert.equal(result.cards.filter(c=>c.origin==='official').length,1);
    assert.equal(result.cards.find(c=>c.name==='Official monster').id.startsWith('official:'),true);
    assert.ok(result.cards.every(c=>c.copies===1));
  } finally {await page.close();}
});
for(const container of ['deck_cards','side_cards']) {
  test(`a standalone ${container} container includes hidden and offscreen cards`,async()=>{
    const page=await contentPage(`${card('99','Unselected search card')}<div id="${container}" style="display:none">${card('42','Selected hidden card')}</div>`);
    try {
      const result=await send(page,{type:'DBCD_SCAN'});
      assert.equal(result.cards.length,1);assert.equal(result.cards[0].id,'42');
      assert.equal(result.rendered,1);
    } finally {await page.close();}
  });
}
test('empty editor containers never fall back to importing unrelated cards',async()=>{
  const page=await contentPage(`<div id="deck_cards"></div><div id="side_cards"></div>${card('99','Search result')}`);
  try {
    const result=await send(page,{type:'DBCD_SCAN'});
    assert.equal(result.rendered,0);assert.deepEqual(result.cards,[]);
  } finally {await page.close();}
});
test('scanning re-reads containers after entering the editor or changing its cards',async()=>{
  const page=await contentPage(card('99','Search result'));
  try {
    assert.equal((await send(page,{type:'DBCD_CONTEXT'})).editor,false);
    await page.evaluate(markup=>{document.body.insertAdjacentHTML('beforeend',markup);},`<div id="deck_cards">${card('42','Deck card')}</div><div id="side_cards"></div>`);
    assert.equal((await send(page,{type:'DBCD_CONTEXT'})).editor,true);
    assert.deepEqual((await send(page,{type:'DBCD_SCAN'})).cards.map(c=>c.id),['42']);
    await page.evaluate(markup=>{document.getElementById('deck_cards').innerHTML='';document.getElementById('side_cards').innerHTML=markup;},card('43','New side card'));
    assert.deepEqual((await send(page,{type:'DBCD_SCAN'})).cards.map(c=>c.id),['43']);
  } finally {await page.close();}
});
test('preview uses the selected editor card and rejects cards removed from the editor',async()=>{
  const page=await contentPage(`${card('42','Stale hover card')}<div id="deck_cards">${card('42','Deck card')}</div>`);
  try {
    assert.equal((await send(page,{type:'DBCD_PREVIEW',id:'42'})).ok,true);
    assert.equal(await page.locator('#dbcd-preview-overlay .name_txt').textContent(),'Deck card');
    assert.equal((await send(page,{type:'DBCD_SCAN'})).rendered,1);
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{document.getElementById('deck_cards').innerHTML='';});
    assert.equal((await send(page,{type:'DBCD_PREVIEW',id:'42'})).ok,false);
  } finally {await page.close();}
});
for(const url of ['https://www.duelingbook.com/','https://www.duelingbook.com/index.php#deck-editor']) {
  test(`popup imports editor cards from ${url} without changing saved copies or annotations`,async()=>{
    const source=await contentPage(`<div id="deck_cards">${card('42','Updated card')}</div><div id="side_cards">${card('43','Side card')}</div>${card('99','Search card')}`);
    const old={id:'42',name:'Old card',artwork:'',origin:'custom',copies:7,section:'extra',duelingbookId:'42',importedAt:'2025-01-01',notes:'keep'};
    const ui=await popup(source,url,{'42':old});
    try {
      assert.equal(await ui.locator('#scan').isEnabled(),true);
      assert.equal(await ui.locator('#site-state').textContent(),'DuelingBook deck editor detected');
      await ui.locator('#scan').click();
      await ui.waitForFunction(()=>document.querySelector('#message').textContent.includes('Added 1'));
      const result=await ui.evaluate(()=>window.saved.dbcd_cards_v1);
      assert.deepEqual(Object.keys(result).sort(),['42','43']);
      assert.equal(result['42'].name,'Updated card');assert.equal(result['42'].copies,7);
      assert.equal(result['42'].section,'extra');assert.equal(result['42'].notes,'keep');
      assert.equal(result['42'].importedAt,'2025-01-01');
      await ui.locator('#scan').click();
      await ui.waitForFunction(()=>document.querySelector('#message').textContent.includes('Added 0'));
      assert.equal(await ui.locator('#instances').textContent(),'8');
    } finally {await ui.close();await source.close();}
  });
}
test('lobby without editor containers disables import',async()=>{
  const source=await contentPage(card('99','Unselected card'));
  const ui=await popup(source);
  try {assert.equal(await ui.locator('#scan').isDisabled(),true);assert.equal(await ui.locator('#site-state').textContent(),'Open the DuelingBook deck editor');}
  finally {await ui.close();await source.close();}
});
test('other origins are rejected even when they contain editor markup',async()=>{
  const source=await contentPage('<div id="deck_cards"></div>');
  const ui=await popup(source,'https://www.duelingbook.com.example.test/');
  try {assert.equal(await ui.locator('#scan').isDisabled(),true);assert.deepEqual(await ui.evaluate(()=>window.sent),[]);}
  finally {await ui.close();await source.close();}
});
test('missing content script prompts the user to refresh the DuelingBook tab',async()=>{
  const source=await contentPage('<div id="deck_cards"></div>');
  await source.evaluate(()=>{window.receive=()=>{throw new Error('Could not establish connection');};});
  const ui=await popup(source);
  try {assert.equal(await ui.locator('#scan').isDisabled(),true);assert.match(await ui.locator('#message').textContent(),/Refresh the DuelingBook tab/);}
  finally {await ui.close();await source.close();}
});
for (const attribute of ['class','id']) {
  test(`constructor detection and import accept ${attribute}-named deck/side containers`,async()=>{
    const source=await contentPage(`<div ${attribute}="deck_cards">${card('42','Deck monster')}</div><div ${attribute}="side_cards">${card('43','Side spell')}</div>${card('99','Search result')}`);
    const ui=await popup(source);
    try {
      assert.equal(await ui.locator('#scan').isEnabled(),true);
      await ui.locator('#scan').click();
      await ui.waitForFunction(()=>document.querySelector('#message').textContent.includes('Added 2'));
      assert.deepEqual(Object.keys(await ui.evaluate(()=>window.saved.dbcd_cards_v1)).sort(),['42','43']);
      assert.equal((await send(source,{type:'DBCD_PREVIEW',id:'43'})).ok,true);
      assert.equal(await source.locator('#dbcd-preview-overlay .name_txt').textContent(),'Side spell');
    } finally {await ui.close();await source.close();}
  });
}
for(const container of ['deck_cards','side_cards']) {
  test(`empty class-named ${container} never imports search results`,async()=>{
    const source=await contentPage(`<div class="${container} other-class"></div>${card('99','Search result')}`);
    try {
      assert.equal((await send(source,{type:'DBCD_CONTEXT'})).editor,true);
      const scan=await send(source,{type:'DBCD_SCAN'});
      assert.deepEqual(scan.cards,[]);assert.equal(scan.rendered,0);
    } finally {await source.close();}
  });
}
test('mixed and overlapping ID/class selectors import each selected node once',async()=>{
  const source=await contentPage(`<div id="deck_cards" class="deck_cards">${card('42','Deck card')}</div><div class="side_cards other-class">${card('43','Side card')}</div>${card('99','Outside card')}`);
  try {
    const scan=await send(source,{type:'DBCD_SCAN'});
    assert.equal(scan.rendered,2);assert.deepEqual(scan.cards.map(c=>c.id),['42','43']);
  } finally {await source.close();}
});

test('official and custom Spell/Trap subtypes survive extraction and reach renderer icons',async()=>{
  const {renderCard}=require('../platform-design/renderer/render.cjs');
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

test('missing and unknown icons stay unresolved; monsters ignore stale subtype images',async()=>{
  const absent=spellTrap('1','Spell','Continuous').replace(/<img class="type_icon"[^>]*>/,'');
  const unknown=spellTrap('2','Trap','Counter').replace('counter.webp','unknown.webp');
  const monster=spellTrap('3','Spell','Ritual').replace('spell_front2.webp','ritual_front2.webp')
    .replace('class="type_txt" style="display:none"','class="type_txt"')
    .replace('class="spell_type_txt"','class="spell_type_txt" style="display:none"');
  const explicit=spellTrap('4','Spell','Quick-Play').replace(/<img class="type_icon"[^>]*>/,'')
    .replace('[ SPELL CARD ]','[ Quick-Play Spell ]');
  const source=await contentPage(absent+unknown+monster+explicit);
  try {
    const {cards}=await send(source,{type:'DBCD_SCAN'});
    assert.equal(cards.length,4);
    for (const record of cards.slice(0,3)) assert.equal(record.visual,undefined);
    assert.equal(cards[2].type,'Spellcaster / Effect');
    assert.equal(cards[3].visual.spellTrapIcon,'quick-play');
  } finally {await source.close();}
});

test('duplicate cards prefer the copy with subtype metadata in either order',async()=>{
  const complete=spellTrap('42','Trap','Counter');
  const incomplete=complete.replace(/<img class="type_icon"[^>]*>/,'');
  for (const html of [incomplete+complete,complete+incomplete]) {
    const source=await contentPage(html);
    try {
      const {cards}=await send(source,{type:'DBCD_SCAN'});
      assert.equal(cards.length,1);assert.equal(cards[0].visual.spellTrapIcon,'counter');
    } finally {await source.close();}
  }
});

test('rescan and Cube JSON export/restore retain subtype and existing annotations',async()=>{
  const source=await contentPage(`<div class="deck_cards">${spellTrap('42','Trap','Counter')}</div>`);
  const old={id:'42',name:'Old card',copies:7,section:'side',importedAt:'2025-01-01',notes:'keep',
    visual:{version:1,spellTrapIcon:'normal',customNote:'keep visual metadata'}};
  const ui=await popup(source,'https://www.duelingbook.com/',{'42':old});
  const restored=await popup(source);
  try {
    await ui.locator('#scan').click();
    await ui.waitForFunction(()=>window.saved.dbcd_cards_v1['42'].visual.spellTrapIcon==='counter');
    // Capture the actual export Blob without depending on a download directory.
    await ui.evaluate(()=>{URL.createObjectURL=blob=>{window.exportedCube=blob.text();return 'blob:test';};});
    await ui.locator('#export').click();
    const exported=await ui.evaluate(()=>window.exportedCube);
    const backup=JSON.parse(exported);
    assert.equal(backup.schema,'dbcd-cube-v1');
    const record=backup.cards[0];
    assert.equal(record.copies,7);assert.equal(record.section,'side');
    assert.equal(record.importedAt,old.importedAt);assert.equal(record.notes,'keep');
    assert.deepEqual(record.visual,{version:1,spellTrapIcon:'counter',customNote:'keep visual metadata'});
    await restored.locator('#json-file').setInputFiles({name:'cube.json',mimeType:'application/json',buffer:Buffer.from(exported)});
    await restored.waitForFunction(()=>window.saved.dbcd_cards_v1['42']);
    assert.deepEqual(await restored.evaluate(()=>window.saved.dbcd_cards_v1['42']),record);
  } finally {await ui.close();await restored.close();await source.close();}
});
