const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const path = require('node:path');
let browser;
before(async () => { browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']}); });
after(async () => { await browser?.close(); });
async function fixture(kind, extra = '') {
  const page = await browser.newPage();
  await page.setContent(`<style>
    .grid {transform:scale(.3);transform-origin:top left}
    .cardfront_content {position:relative;width:400px;height:580px;overflow:hidden;background:purple}
    .cardfront_content span {position:absolute;font:18px serif;letter-spacing:2px}
    .cardfront_content::before {content:'frame';position:absolute;top:0}
    .name_txt {top:20px;left:30px} .pic {width:300px;height:300px;position:absolute;top:70px;left:50px}
    .effect_txt {top:400px;clip-path:inset(0);white-space:pre-wrap}
    .card_atk_txt {display:${kind==='Spell'||kind==='Trap'?'none':'block'}}
    .link_txt {display:${kind==='Link'?'block':'none'}}
    .pendulum {display:${kind==='Pendulum'?'block':'none'}}
  </style>${extra}<div class="grid"><div class="cardfront_content"><span class="name_txt">${kind}</span><img class="pic" src="https://example.test/custom-pics/1/42.png"><span class="effect_txt">Effect text</span><span class="card_atk_txt">2500</span><span class="link_txt">LINK-3</span><span class="pendulum">Pendulum effect</span></div></div>`);
  await page.evaluate(() => {window.chrome={runtime:{onMessage:{addListener(fn){window.message=fn;}}}};});
  await page.addScriptTag({path:path.resolve('content.js')});
  return page;
}
async function message(page, type, id='42') {return page.evaluate(({type,id}) => new Promise(resolve=>window.message({type,id}, {}, resolve)),{type,id});}
for (const kind of ['Monster','Spell','Trap','Fusion','Synchro','Xyz','Link','Pendulum']) {
  test(`${kind}: preserves source layout, hidden fields, and pseudo frame`,async()=>{
    const page=await fixture(kind);
    try {
      assert.equal((await message(page,'DBCD_PREVIEW')).ok,true);
      const result=await page.evaluate(()=>{
        const original=document.querySelector('.cardfront_content');
        const shadow=document.querySelector('#dbcd-preview-overlay').shadowRoot;
        const clone=shadow.querySelector('.cardfront_content');
        const properties=['display','left','top','width','height','font-family','font-size','letter-spacing','clip-path'];
        const equal = (a,b) => a === b || (/^-?[\d.]+px$/.test(a) && /^-?[\d.]+px$/.test(b) && Math.abs(parseFloat(a)-parseFloat(b)) < .05);
        return {width:clone.offsetWidth,height:clone.offsetHeight,transform:getComputedStyle(clone).transform,
          same:[...original.querySelectorAll('*')].every((el,i)=>properties.every(p=>equal(getComputedStyle(el).getPropertyValue(p),getComputedStyle(clone.querySelectorAll('*')[i]).getPropertyValue(p)))),
          pseudo:getComputedStyle(clone,'::before').content,sourceWidth:original.offsetWidth};
      });
      assert.deepEqual(result,{width:400,height:580,transform:'none',same:true,pseudo:'"frame"',sourceWidth:400});
      const scan=await message(page,'DBCD_SCAN');
      assert.equal(scan.rendered,1); assert.equal(scan.cards.length,1);
    } finally {await page.close();}
  });
}
test('replacement, resize, Escape, backdrop, and missing card',async()=>{
  const page=await fixture('Monster');
  try {
    assert.equal((await message(page,'DBCD_PREVIEW','missing')).ok,false);
    await message(page,'DBCD_PREVIEW'); await message(page,'DBCD_PREVIEW');
    assert.equal(await page.locator('#dbcd-preview-overlay').count(),1);
    await page.setViewportSize({width:320,height:400});
    await page.waitForTimeout(50);
    assert.ok(await page.locator('#dbcd-preview-overlay .cardfront_content').evaluate(el=>el.getBoundingClientRect().height<=288));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#dbcd-preview-overlay').count(),0);
    await message(page,'DBCD_PREVIEW');
    await page.getByRole('button',{name:'Close preview ×'}).click();
    assert.equal(await page.locator('#dbcd-preview-overlay').count(),0);
    await message(page,'DBCD_PREVIEW');
    await page.getByRole('dialog').click({position:{x:1,y:1}});
    assert.equal(await page.locator('#dbcd-preview-overlay').count(),0);
  } finally {await page.close();}
});
test('v0.3 collection survives load and reimport with identity and annotations intact',async()=>{
  const page=await browser.newPage();
  const fs=require('node:fs');
  try {
    await page.setContent(fs.readFileSync('popup.html','utf8').replace('<script src="popup.js"></script>',''));
    await page.evaluate(()=>{
      const old={id:'42',name:'Old',artwork:'',copies:7,section:'extra',duelingbookId:'42',importedAt:'2025-01-01',origin:'custom'};
      window.saved={dbcd_cards_v1:{42:old}};
      window.chrome={storage:{local:{get:async()=>saved,set:async value=>{window.saved=value;}}},tabs:{query:async()=>[{id:1,url:'https://www.duelingbook.com/deck?id=1'}],sendMessage:async()=>({ok:true,rendered:1,cards:[{...old,name:'New',copies:1,section:'unknown',importedAt:'new'}]})}};
    });
    await page.addScriptTag({path:path.resolve('popup.js')});
    await page.waitForFunction(()=>document.querySelector('#unique').textContent==='1');
    await page.locator('#scan').click();
    await page.waitForFunction(()=>window.saved.dbcd_cards_v1['42'].name==='New');
    const record=await page.evaluate(()=>window.saved.dbcd_cards_v1['42']);
    assert.equal(record.copies,7);assert.equal(record.section,'extra');assert.equal(record.duelingbookId,'42');assert.equal(record.importedAt,'2025-01-01');
  } finally {await page.close();}
});
