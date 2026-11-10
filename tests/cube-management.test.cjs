const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
let browser;
before(async () => {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
});
after(async () => { await browser?.close(); });
const custom = {id:'42',name:'Custom monster',origin:'custom',artwork:'',copies:3,section:'extra',duelingbookId:'42',importedAt:'2025-01-01',notes:{tag:'keep me'}};
const official = {id:'official:1234abcd',name:'Official spell',origin:'official',artwork:'',copies:2,section:'main',duelingbookId:'123',importedAt:'2025-02-02'};
const backup = cards => ({schema:'dbcd-cube-v1',exportedAt:'2026-11-09',cards});
async function fixture(cards=[custom,official]) {
  const page=await browser.newPage({viewport:{width:464,height:650},acceptDownloads:true});
  await page.route('**/*', route => route.abort());
  await page.setContent(fs.readFileSync('popup.html','utf8').replace(/<script src="[^"]+"><\/script>/g,''));
  await page.addStyleTag({path:path.resolve('popup.css')});
  await page.evaluate(cards => {
    window.saved={dbcd_cards_v1:Object.fromEntries(cards.map(c=>[c.id,c]))};
    window.failWrite=false;
    window.writes=0;
    window.scanCards=[];
    window.chrome={storage:{local:{
      get:async()=>structuredClone(window.saved),
      set:async value=>{
        await new Promise(resolve=>setTimeout(resolve,10));
        if (window.failWrite) throw new Error('Storage unavailable');
        window.saved=structuredClone(value); window.writes++;
      }
    }},tabs:{query:async()=>[{id:1,url:'https://www.duelingbook.com/deck?id=1'}],sendMessage:async()=>({ok:true,rendered:window.scanCards.length,cards:window.scanCards})}};
  },cards);
  await page.addScriptTag({path:path.resolve('xml-matching.js')});
  await page.addScriptTag({path:path.resolve('popup.js')});
  await page.waitForFunction(()=>document.querySelector('#site-state').textContent==='DuelingBook page detected');
  return page;
}
async function importFile(page, value) {
  await page.locator('#json-file').setInputFiles({name:'cube.json',mimeType:'application/json',buffer:Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
  await page.waitForFunction(()=>document.querySelector('#import').disabled===false);
}
const stored = page => page.evaluate(()=>window.saved.dbcd_cards_v1);
const message = page => page.locator('#message').textContent();

test('export and restore round trip retains v0.3 keys, counts, IDs and unknown metadata',async()=>{
  const source=await fixture();
  const target=await fixture([]);
  try {
    const [download]=await Promise.all([source.waitForEvent('download'),source.locator('#export').click()]);
    const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(exported.schema,'dbcd-cube-v1');
    assert.deepEqual(exported.cards,[custom,official]);
    await importFile(target,exported);
    assert.deepEqual(await stored(target),{'42':custom,[official.id]:official});
    assert.equal(await target.locator('#unique').textContent(),'2');
    assert.equal(await target.locator('#instances').textContent(),'5');
    assert.match(await message(target),/Imported 2 cards/);
  } finally {await source.close();await target.close();}
});
test('repeated import adds only missing IDs and never overwrites existing cards or sums copies',async()=>{
  const page=await fixture([custom]);
  try {
    const data=backup([{...custom,copies:99,section:'side',duelingbookId:'changed'},official]);
    await importFile(page,data);
    assert.deepEqual(await stored(page),{'42':custom,[official.id]:official});
    assert.match(await message(page),/Imported 1 cards; kept 1 existing/);
    await importFile(page,data);
    assert.deepEqual(await stored(page),{'42':custom,[official.id]:official});
    assert.match(await message(page),/Imported 0 cards; kept 2 existing/);
    assert.equal(await page.locator('#json-file').inputValue(),'');
  } finally {await page.close();}
});
const invalidCases = [
  ['malformed JSON','{not json'],
  ['wrong schema',{schema:'other',cards:[official]}],
  ['non-array cards',{schema:'dbcd-cube-v1',cards:{}}],
  ['invalid ID',backup([{...official,id:'__proto__'}])],
  ['missing name',backup([{...official,name:null}])],
  ['duplicate IDs',backup([official,official])],
  ['fractional copies',backup([{...official,copies:1.5}])],
  ['out-of-range copies',backup([{...official,copies:100}])],
  ['zero copies',backup([{...official,copies:0}])],
  ['string copies',backup([{...official,copies:'3'}])],
  ['invalid section',backup([{...official,section:'invalid'}])],
  ['invalid text field',backup([{...official,effect:{text:'bad'}}])],
  ['valid card before invalid card',backup([official,{...custom,id:'55',copies:-1}])]
];
for (const [name,data] of invalidCases) {
  test(`invalid backup (${name}) leaves the collection untouched`,async()=>{
    const page=await fixture([custom]);
    try {
      await importFile(page,data);
      assert.deepEqual(await stored(page),{'42':custom});
      assert.equal(await page.evaluate(()=>window.writes),0);
      assert.match(await message(page),/^Import failed:/);
    } finally {await page.close();}
  });
}
test('section/copy edits persist across popup reopen and page reimport',async()=>{
  const page=await fixture([custom]);
  try {
    await page.locator('#section-42').selectOption('side');
    await page.waitForFunction(()=>window.saved.dbcd_cards_v1['42'].section==='side');
    assert.equal(await page.locator('#extra').textContent(),'0');
    await page.locator('#copy-42').fill('8');await page.locator('#copy-42').press('Tab');
    await page.waitForFunction(()=>window.saved.dbcd_cards_v1['42'].copies===8);
    await page.evaluate(()=>{window.scanCards=[{id:'42',name:'Refreshed name',origin:'custom',copies:1,section:'unknown',duelingbookId:'42',artwork:''}];});
    await page.locator('#scan').click();
    await page.waitForFunction(()=>window.saved.dbcd_cards_v1['42'].name==='Refreshed name');
    const updated=(await stored(page))['42'];
    assert.equal(updated.copies,8);assert.equal(updated.section,'side');assert.deepEqual(updated.notes,custom.notes);
    assert.equal(updated.importedAt,custom.importedAt);
    const reopened=await fixture([updated]);
    try {assert.equal(await reopened.locator('#section-42').inputValue(),'side');assert.equal(await reopened.locator('#copy-42').inputValue(),'8');}
    finally {await reopened.close();}
  } finally {await page.close();}
});
test('failed writes keep both stored and displayed state and later edits still succeed',async()=>{
  const page=await fixture([custom]);
  try {
    await page.evaluate(()=>window.failWrite=true);
    await page.locator('#section-42').selectOption('main');
    await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('Could not save changes:'));
    assert.equal(await page.locator('#section-42').inputValue(),'extra');
    await importFile(page,backup([official]));
    assert.match(await message(page),/Import failed: Storage unavailable/);
    assert.deepEqual(await stored(page),{'42':custom});
    await page.evaluate(()=>window.failWrite=false);
    await importFile(page,backup([official]));
    assert.equal(Object.keys(await stored(page)).length,2);
  } finally {await page.close();}
});
test('XML annotations still work and preserve existing custom metadata',async()=>{
  const page=await fixture();
  try {
    await page.locator('#xml-file').setInputFiles({name:'deck.xml',mimeType:'text/xml',buffer:Buffer.from('<deck><main><card id="42">Custom monster</card></main><side><card id="123">Official spell</card></side></deck>')});
    await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('XML matched'));
    const result=await stored(page);
    assert.equal(result['42'].section,'main');assert.equal(result[official.id].section,'side');
    assert.deepEqual(result['42'].notes,custom.notes);assert.equal(result[official.id].duelingbookId,'123');
  } finally {await page.close();}
});
test('new cards with the same name but different IDs remain distinct',async()=>{
  const page=await fixture([custom]);
  try {
    await importFile(page,backup([{...official,name:custom.name}]));
    assert.equal(Object.keys(await stored(page)).length,2);
    assert.equal(await page.locator('#instances').textContent(),'5');
  } finally {await page.close();}
});
test('rapid edits are queued and export waits for the last copy change',async()=>{
  const page=await fixture([custom]);
  try {
    const [download]=await Promise.all([page.waitForEvent('download'),page.evaluate(()=>{
      const section=document.getElementById('section-42');section.value='side';section.dispatchEvent(new Event('change',{bubbles:true}));
      const copies=document.getElementById('copy-42');copies.value='11';copies.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('export').click();
    })]);
    const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(exported.cards[0].copies,11);assert.equal(exported.cards[0].section,'side');
    assert.equal((await stored(page))['42'].copies,11);
  } finally {await page.close();}
});
