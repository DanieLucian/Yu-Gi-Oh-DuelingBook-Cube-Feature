const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
const custom={id:'42',name:'Custom Card',origin:'custom',artwork:'',duelingbookId:'42',copies:7,section:'extra',importedAt:'2025-01-01',notes:{keep:true}};
const official=(id,name,duelingbookId='')=>({id,name,origin:'official',artwork:'',duelingbookId,copies:3,section:'unknown',importedAt:'2025-02-02'});
async function fixture(cards=[custom]) {
  const page=await browser.newPage({viewport:{width:464,height:700},acceptDownloads:true});
  await page.route('**/*',route=>route.abort());
  await page.setContent(fs.readFileSync('popup.html','utf8').replace(/<script src="[^"]+"><\/script>/g,''));
  await page.addStyleTag({path:path.resolve('popup.css')});
  await page.evaluate(cards=>{
    window.saved={dbcd_cards_v1:Object.fromEntries(cards.map(c=>[c.id,c]))};window.writes=0;window.failWrite=false;
    window.chrome={storage:{local:{get:async()=>structuredClone(window.saved),set:async next=>{
      await new Promise(resolve=>setTimeout(resolve,20));
      if(window.failWrite) throw new Error('Storage unavailable');
      window.saved=structuredClone(next);window.writes++;
    }}},tabs:{query:async()=>[]}};
  },cards);
  await page.addScriptTag({path:path.resolve('xml-matching.js')});
  await page.addScriptTag({path:path.resolve('popup.js')});
  await page.waitForFunction(()=>document.querySelector('#site-state').textContent!=='Checking page…');
  return page;
}
async function upload(page,xml) {
  await page.locator('#xml-file').setInputFiles({name:'deck.xml',mimeType:'application/xml',buffer:Buffer.from(xml)});
  await page.waitForFunction(()=>document.querySelector('#xml').disabled===false);
}
const stored=page=>page.evaluate(()=>window.saved.dbcd_cards_v1);
const text=page=>page.locator('#message').textContent();

test('popup reports partial matches and all skipped categories while preserving existing Cube data',async()=>{
  const cards=[custom,official('official:11111111','Renamed Card','123'),official('official:22222222','New Spell'),official('official:33333333','Bound Card','999'),official('official:44444444','Shared Name'),official('official:55555555','Shared Name')];
  const page=await fixture(cards);
  try {
    await upload(page,'<deck><main><card id="42">Custom Card</card><card id="42">Custom Card</card><card id="888">Bound Card</card><card id="555">Shared Name</card><card id="777">Missing Card</card><card>No ID</card></main><extra><card id="321">New Spell</card></extra><side><card id="123">Old Name</card></side></deck>');
    const next=await stored(page);
    assert.equal(Object.keys(next).length,cards.length);
    assert.deepEqual(next['42'],{...custom,section:'main'});
    assert.equal(next['official:11111111'].name,'Renamed Card');assert.equal(next['official:11111111'].section,'side');
    assert.equal(next['official:22222222'].duelingbookId,'321');assert.equal(next['official:22222222'].section,'extra');
    for (const card of cards) {assert.equal(next[card.id].copies,card.copies);assert.equal(next[card.id].importedAt,card.importedAt);}
    assert.deepEqual(next['official:33333333'],cards[3]);
    assert.equal(await page.locator('#xml-results li').count(),7);
    assert.equal(await page.locator('.xml-matched').count(),3);assert.equal(await page.locator('.xml-conflict').count(),1);
    assert.equal(await page.locator('.xml-ambiguous').count(),1);assert.equal(await page.locator('.xml-unmatched').count(),1);assert.equal(await page.locator('.xml-invalid').count(),1);
    assert.match(await text(page),/XML matched 3 distinct IDs \(2 by ID, 1 by name\)/);
    assert.match(await page.locator('#xml-summary').textContent(),/8 XML card entries processed/);
    assert.equal(await page.locator('#xml-file').inputValue(),'');
  } finally {await page.close();}
});
for(const [name,xml] of [
  ['malformed XML','<deck><main><card id="42">Bad</main></deck>'],
  ['unrelated XML','<collection><main><card id="42">Custom Card</card></main></collection>'],
  ['empty deck','<deck><main/><extra/><side/></deck>'],
  ['unsupported card nesting','<deck><main><group><card id="42">Custom Card</card></group></main></deck>']
]) {
  test(`${name} leaves storage untouched and clears a previous report`,async()=>{
    const page=await fixture();
    try {
      await upload(page,'<deck><extra><card id="42">Custom Card</card></extra></deck>');
      assert.equal(await page.locator('#xml-report').isVisible(),true);
      assert.equal(await page.evaluate(()=>window.writes),0);
      await upload(page,xml);
      assert.match(await text(page),/^XML matching failed:/);
      assert.deepEqual(await stored(page),{'42':custom});assert.equal(await page.evaluate(()=>window.writes),0);
      assert.equal(await page.locator('#xml-report').isHidden(),true);
      assert.equal(await page.locator('#xml-file').inputValue(),'');
    } finally {await page.close();}
  });
}
test('XML namespaces, escaped text and name attributes are parsed consistently',async()=>{
  const card=official('official:1234abcd','Spell & Café');
  const page=await fixture([custom,card]);
  try {
    await upload(page,'<?xml version="1.0" encoding="UTF-8"?><deck xmlns="urn:deck"><main><card id="123" name="Spell &amp; Cafe\u0301"/></main><side><card id="42" name="Custom Card"> Custom Card </card></side></deck>');
    const next=await stored(page);
    assert.equal(next[card.id].duelingbookId,'123');assert.equal(next[card.id].section,'main');assert.equal(next['42'].section,'side');
    assert.match(await text(page),/XML matched 2 distinct IDs/);
  } finally {await page.close();}
});
test('duplicate XML copies do not inflate quantities or choose the last deck section',async()=>{
  const card=official('official:1234abcd','Official Spell');
  const page=await fixture([custom,card]);
  try {
    await upload(page,'<deck><main><card id="42">Custom Card</card><card id="42">Custom Card</card></main><extra><card id="123">Official Spell</card><card id="123">Official Spell</card></extra><side><card id="42">Custom Card</card></side></deck>');
    const next=await stored(page);
    assert.deepEqual(next['42'],custom);assert.equal(next[card.id].copies,3);assert.equal(next[card.id].section,'extra');
    assert.match(await page.locator('#xml-summary').textContent(),/5 XML card entries processed/);
    assert.match(await page.locator('#xml-summary').textContent(),/Existing Cube sections kept for multi-section matches: 1/);
    assert.equal(await page.locator('#xml-results li').count(),2);
  } finally {await page.close();}
});
test('name-attribute disagreement skips all copies of that ID and displays a conflict',async()=>{
  const page=await fixture();
  try {
    await upload(page,'<deck><main><card id="42">Custom Card</card><card id="42" name="Other name">Custom Card</card></main></deck>');
    assert.deepEqual(await stored(page),{'42':custom});assert.equal(await page.evaluate(()=>window.writes),0);
    assert.equal(await page.locator('.xml-conflict').count(),1);
    assert.match(await page.locator('.xml-conflict').textContent(),/name attribute and card text disagree/);
  } finally {await page.close();}
});
test('failed XML writes leave stored and displayed state intact, and the same file can be retried',async()=>{
  const page=await fixture();
  const xml='<deck><main><card id="42">Custom Card</card></main></deck>';
  try {
    await page.evaluate(()=>window.failWrite=true);
    await upload(page,xml);
    assert.deepEqual(await stored(page),{'42':custom});assert.equal(await page.locator('#section-42').inputValue(),'extra');
    assert.match(await text(page),/XML matching failed: Storage unavailable/);
    assert.equal(await page.locator('#xml-report').isHidden(),true);
    await page.evaluate(()=>window.failWrite=false);
    await upload(page,xml);
    assert.equal((await stored(page))['42'].section,'main');assert.equal(await page.evaluate(()=>window.writes),1);
    assert.equal(await page.locator('.xml-matched').count(),1);
  } finally {await page.close();}
});
test('repeating XML matching reuses a saved ID after a name change and avoids no-op writes',async()=>{
  const card=official('official:1234abcd','Official Spell');
  const page=await fixture([card]);
  try {
    await upload(page,'<deck><main><card id="123">Official Spell</card></main></deck>');
    assert.equal(await page.evaluate(()=>window.writes),1);assert.match(await text(page),/0 by ID, 1 by name/);
    await upload(page,'<deck><main><card id="123">Earlier XML Name</card></main></deck>');
    assert.equal(await page.evaluate(()=>window.writes),1);assert.match(await text(page),/1 by ID, 0 by name/);
    assert.equal((await stored(page))[card.id].name,'Official Spell');
  } finally {await page.close();}
});
test('XML matching preserves copy edits that are still being saved',async()=>{
  const page=await fixture();
  try {
    await page.evaluate(()=>{
      const input=document.getElementById('copy-42');input.value='9';input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    await upload(page,'<deck><main><card id="42">Custom Card</card></main></deck>');
    const next=await stored(page);
    assert.equal(next['42'].copies,9);assert.equal(next['42'].section,'main');assert.deepEqual(next['42'].notes,{keep:true});
  } finally {await page.close();}
});
test('matching report escapes card names rather than inserting XML-provided HTML',async()=>{
  const page=await fixture();
  try {
    await upload(page,'<deck><main><card id="123">&lt;img src=x onerror="window.reportXss=true"&gt;</card></main></deck>');
    assert.equal(await page.locator('#xml-results img').count(),0);
    assert.match(await page.locator('#xml-results').textContent(),/<img src=x/);
    assert.equal(await page.evaluate(()=>window.reportXss),undefined);
    assert.deepEqual(await stored(page),{'42':custom});
  } finally {await page.close();}
});
test('matched IDs survive JSON export/restore with stable local identifiers and metadata',async()=>{
  const card=official('official:1234abcd','Official Spell');
  const source=await fixture([custom,card]);const target=await fixture([]);
  try {
    await upload(source,'<deck><main><card id="123">Official Spell</card></main><side><card id="42">Custom Card</card></side></deck>');
    const [download]=await Promise.all([source.waitForEvent('download'),source.locator('#export').click()]);
    const data=fs.readFileSync(await download.path());
    await target.locator('#json-file').setInputFiles({name:'cube.json',mimeType:'application/json',buffer:data});
    await target.waitForFunction(()=>document.querySelector('#import').disabled===false);
    assert.deepEqual(await stored(target),await stored(source));
    assert.equal((await stored(target))[card.id].duelingbookId,'123');
    assert.deepEqual(Object.keys(await stored(target)).sort(),['42','official:1234abcd']);
  } finally {await source.close();await target.close();}
});
