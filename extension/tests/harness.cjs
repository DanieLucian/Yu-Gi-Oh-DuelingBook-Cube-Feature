const {before,after}=require('node:test');
const {chromium}=require('playwright');
const path=require('node:path');
const fs=require('node:fs');
const packageDir=path.resolve(__dirname,'../../dist/extension');
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});});
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
  await page.addScriptTag({path:path.join(packageDir,'content.js')});
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
  await page.setContent(fs.readFileSync(path.join(packageDir,'popup.html'),'utf8').replace('<script src="popup.js"></script>',''));
  await page.exposeFunction('sendToTab',message=>send(content,message));
  await page.evaluate(({url,cards})=>{
    window.saved={dbcd_cards_v1:cards};window.sent=[];
    window.chrome={storage:{local:{get:async()=>structuredClone(window.saved),set:async value=>{window.saved=structuredClone(value);}}},tabs:{query:async()=>[{id:1,url}],sendMessage:async(_id,message)=>{window.sent.push(message.type);return window.sendToTab(message);}}};
  },{url,cards});
  await page.addScriptTag({path:path.join(packageDir,'popup.js')});
  await page.waitForFunction(()=>document.querySelector('#site-state').textContent!=='Checking page…');
  return page;
}

// DuelingBook's public newCardFront template uses separate printed scale spans.
function pendulumCard(id, left, right, official=false) {
  return card(id, 'Pendulum monster', official).replace('</div>', `
    <img class="card_color" src="https://example.test/effect_front2.webp">
    <span class="type_txt">Spellcaster / Pendulum / Effect</span>
    <span class="card_pendulum_effect_txt">Pendulum effect</span>
    <span class="scale_left_txt">${left}</span><span class="scale_right_txt">${right}</span></div>`);
}

function xyzCard(id, rank, official=false, pendulum=false) {
  return card(id,'Xyz monster',official).replace('</div>',`
    <img class="card_color" src="https://example.test/xyz_front2.webp">
    <span class="type_txt">Dragon / Xyz / ${pendulum?'Pendulum / ':''}Effect</span>
    ${Array.from({length:13},(_,i)=>`<img class="rank rank${i+1}" style="display:${i<rank?'block':'none'}" src="https://example.test/rank.webp">`).join('')}
    <img class="level" style="display:none" src="https://example.test/level.webp">
    ${pendulum?'<span class="scale_left_txt">2</span><span class="scale_right_txt">8</span>':''}</div>`);
}

module.exports={card,contentPage,send,spellTrap,popup,pendulumCard,xyzCard,newPage:()=>browser.newPage()};
