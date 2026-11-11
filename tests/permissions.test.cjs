const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));

test('manifest requests only local storage and the supported HTTPS DuelingBook host',()=>{
  assert.deepEqual(manifest.permissions,['storage']);
  assert.deepEqual(manifest.host_permissions,['https://www.duelingbook.com/*']);
  assert.deepEqual(manifest.optional_permissions || [],[]);
  assert.deepEqual(manifest.optional_host_permissions || [],[]);
  for(const script of manifest.content_scripts){
    assert.deepEqual(script.matches,['https://www.duelingbook.com/*']);
    assert.equal(script.all_frames || false,false);
    assert.equal(script.match_origin_as_fallback || false,false);
    assert.equal(script.match_about_blank || false,false);
  }
});

test('packaged runtime uses only the reviewed Chrome API surface',()=>{
  const html=fs.readFileSync(manifest.action.default_popup,'utf8');
  const files=new Set([...manifest.content_scripts.flatMap(script=>script.js),...[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m=>m[1])]);
  const apiCalls=new Set([...files].flatMap(file=>[...fs.readFileSync(file,'utf8').matchAll(/\bchrome\.([\w.]+)\s*\(/g)].map(m=>m[1])));
  assert.deepEqual([...apiCalls].sort(),['runtime.onMessage.addListener','storage.local.get','storage.local.set','tabs.query','tabs.sendMessage']);
});

test('popup still supports local Cube storage and XML when an unrelated tab URL is withheld',async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.setContent(fs.readFileSync('popup.html','utf8').replace('<script src="popup.js"></script>',''));
    await page.evaluate(()=>{
      window.saved={dbcd_cards_v1:{42:{id:'42',name:'Custom Card',origin:'custom',artwork:'',copies:7,section:'unknown',duelingbookId:'42'}}};
      window.chrome={storage:{local:{get:async()=>structuredClone(window.saved),set:async data=>{window.saved=structuredClone(data);}}},tabs:{query:async()=>[{id:1,active:true}],sendMessage:async()=>{throw new Error('Unrelated tabs must not receive messages');}}};
    });
    await page.addScriptTag({path:path.resolve('popup.js')});
    await page.waitForFunction(()=>document.querySelector('#site-state').textContent==='Not on DuelingBook');
    assert.equal(await page.locator('#scan').isDisabled(),true);
    assert.equal(await page.locator('#unique').textContent(),'1');
    await page.locator('#xml-file').setInputFiles({name:'deck.xml',mimeType:'text/xml',buffer:Buffer.from('<deck><extra><card id="42">Custom Card</card></extra></deck>')});
    await page.waitForFunction(()=>window.saved.dbcd_cards_v1['42'].section==='extra');
    assert.equal(await page.evaluate(()=>window.saved.dbcd_cards_v1['42'].copies),7);
  } finally {await browser.close();}
});

test('installed extension imports, previews, stores and matches XML without an activeTab grant',async t=>{
  const profile=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'dbcd-permissions-'));
  const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox','--enable-unsafe-extension-debugging']});
  try {
    const session=await context.browser().newBrowserCDPSession();
    let id;
    try {({id}=await session.send('Extensions.loadUnpacked',{path:process.cwd()}));}
    catch(error){
      if(/Loading of unpacked extensions is disabled by the administrator|Method not (?:available|found)|wasn't found/.test(error.message)){
        t.skip('Installed-extension permission check unavailable: '+error.message);return;
      }
      throw error;
    }
    const html='<style>.cardfront_content{position:relative;width:400px;height:580px}</style><div class="deck_cards"><div class="cardfront_content"><span class="name_txt">Custom Card</span><img class="pic" src="https://www.duelingbook.com/custom-pics/1/42.png"></div></div><div class="side_cards"></div>';
    await context.route('**/*',route=>{
      const url=route.request().url();
      if(url.startsWith('https://www.duelingbook.com/') || url.startsWith('https://example.test/')) {
        if(route.request().resourceType()==='document')return route.fulfill({contentType:'text/html',body:html});
        return route.abort();
      }
      return route.continue();
    });
    const app=await context.newPage();await app.goto('https://www.duelingbook.com/');
    const ui=await context.newPage();await app.bringToFront();await ui.goto('chrome-extension://'+id+'/popup.html');
    await ui.waitForFunction(()=>document.querySelector('#site-state').textContent==='DuelingBook deck editor detected');
    const granted=await ui.evaluate(()=>chrome.permissions.getAll());
    assert.equal(granted.permissions.includes('activeTab'),false);
    assert.equal(granted.permissions.includes('tabs'),false);
    assert.deepEqual(granted.origins,['https://www.duelingbook.com/*']);
    await ui.locator('#scan').click();await ui.waitForFunction(()=>document.querySelector('#unique').textContent==='1');
    await ui.locator('#xml-file').setInputFiles({name:'deck.xml',mimeType:'text/xml',buffer:Buffer.from('<deck><side><card id="42">Custom Card</card></side></deck>')});
    await ui.waitForFunction(async()=>((await chrome.storage.local.get('dbcd_cards_v1')).dbcd_cards_v1['42'].section==='side'));
    await app.bringToFront();
    const preview=await ui.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return chrome.tabs.sendMessage(tab.id,{type:'DBCD_PREVIEW',id:'42'});});
    assert.equal(preview.ok,true);assert.equal(await app.locator('#dbcd-preview-overlay').count(),1);
    const unrelated=await context.newPage();await unrelated.goto('https://example.test/');
    await unrelated.bringToFront();
    const tab=await ui.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return {url:tab.url,title:tab.title};});
    assert.ok(tab.url===undefined || tab.url==='');
  } finally {await context.close();fs.rmSync(profile,{recursive:true,force:true});}
});
