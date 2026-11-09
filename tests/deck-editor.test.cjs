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
