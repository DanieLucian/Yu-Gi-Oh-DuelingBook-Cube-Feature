const {test}=require('node:test');
const assert=require('node:assert/strict');
const {card,contentPage,send,spellTrap,popup,pendulumCard,xyzCard}=require('./harness.cjs');

test('scanning preserves material, condition, and Pendulum text breaks in hidden cards',async()=>{
  const html=card('42','Multiline example').replace('Effect for Multiline example',
    '2 Level 7 monsters<br>(Always treated as a "Struggler" card.)<br><span>Draw a card.</span><br><br>Then discard a card.')
    .replace('</div>','</div><div class="card_pendulum_effect_txt"><div>First line.</div><div>Next line.</div></div>');
  const page=await contentPage(`<div id="extra_cards" style="display:none">${html}</div>`);
  try {
    const result=await send(page,{type:'DBCD_SCAN'});
    assert.equal(result.cards[0].effect,'2 Level 7 monsters\n(Always treated as a "Struggler" card.)\nDraw a card.\n\nThen discard a card.');
    assert.equal(result.cards[0].pendulumEffect,'First line.\nNext line.');
  } finally {await page.close();}
});
test('Link sockets export active directions',async()=>{
  const directions=['top-left','top','top-right','right','bottom-right','bottom','bottom-left','left'];
  const html=card('42','Link Arrow Example').replace('</div>',
    '<img class="card_color" src="https://example.test/link_front.webp"><span class="type_txt">Dragon / Link / Effect</span><span class="link_txt">4</span>'+
    directions.map((_,i)=>`<img class="red_arrow red_arrow${i+1}" style="display:${i%2===0?'block':'none'}" src="https://example.test/red_arrow_corner.webp">`).join('')+'</div>');
  const page=await contentPage(`<div id="extra_cards">${html}</div>`);
  try {
    const scanned=(await send(page,{type:'DBCD_SCAN'})).cards[0];
    assert.deepEqual(scanned.visual.linkArrows,['top-left','top-right','bottom-right','bottom-left']);
    const pop=await popup(page,'https://www.duelingbook.com/',{'42':{...scanned,copies:3}});
    try {
      await pop.locator('#scan').click();
      await pop.waitForFunction(()=>window.saved.dbcd_cards_v1['42']?.copies===3);
      assert.deepEqual(await pop.evaluate(()=>window.saved.dbcd_cards_v1['42'].visual.linkArrows),scanned.visual.linkArrows);
    } finally {await pop.close();}
    await page.locator('.red_arrow').evaluateAll(arrows=>arrows.forEach(arrow=>arrow.style.display='block'));
    const all=(await send(page,{type:'DBCD_SCAN'})).cards[0];
    assert.deepEqual(all.visual.linkArrows,directions);
  } finally {await page.close();}
});
test('editor includes official/custom cards in all three containers and excludes search results and hover cards',async()=>{
  const page=await contentPage(`<div id="search_results">${card('99','Search result')}</div>
    <div id="deck_cards">${card('42','Custom deck monster')}<div>${card('blue-eyes','Official monster',true)}</div></div>
    <div id="extra_cards">${card('44','Custom fusion')}${card('stardust','Official synchro',true)}${card('42','Custom deck monster')}</div>
    <div id="side_cards">${card('43','Side trap')}${card('42','Custom deck monster')}</div>
    <div id="hover_preview">${card('100','Hover card')}</div>`);
  try {
    assert.deepEqual(await send(page,{type:'DBCD_CONTEXT'}),{ok:true,editor:true});
    const result=await send(page,{type:'DBCD_SCAN'});
    assert.equal(result.ok,true);assert.equal(result.rendered,7);assert.equal(result.cards.length,5);
    assert.deepEqual(result.cards.map(c=>c.name).sort(),['Custom deck monster','Custom fusion','Official monster','Official synchro','Side trap']);
    assert.equal(result.cards.filter(c=>c.origin==='official').length,2);
    assert.equal(result.cards.find(c=>c.name==='Official monster').id.startsWith('official:'),true);
    assert.ok(result.cards.every(c=>c.copies===1));
  } finally {await page.close();}
});
for(const container of ['deck_cards','extra_cards','side_cards']) {
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

for (const attribute of ['id','class']) {
  test(`standalone ${attribute}-named Extra Deck supports detection, rescans and previews`,async()=>{
    const source=await contentPage(`<div ${attribute}="extra_cards"></div>${card('99','Search result')}`);
    const ui=await popup(source);
    try {
      assert.equal(await ui.locator('#scan').isEnabled(),true);
      assert.deepEqual((await send(source,{type:'DBCD_SCAN'})).cards,[]);
      await source.evaluate(markup=>{document.querySelector('[id="extra_cards"], .extra_cards').innerHTML=markup;},card('44','Extra monster'));
      assert.deepEqual((await send(source,{type:'DBCD_SCAN'})).cards.map(c=>c.id),['44']);
      assert.equal((await send(source,{type:'DBCD_PREVIEW',id:'44'})).ok,true);
      await source.keyboard.press('Escape');
      await source.evaluate(()=>{document.querySelector('[id="extra_cards"], .extra_cards').innerHTML='';});
      assert.equal((await send(source,{type:'DBCD_PREVIEW',id:'44'})).ok,false);
      assert.deepEqual((await send(source,{type:'DBCD_SCAN'})).cards,[]);
    } finally {await ui.close();await source.close();}
  });
}
for(const url of ['https://www.duelingbook.com/','https://www.duelingbook.com/index.php#deck-editor']) {
  test(`popup imports editor cards from ${url} without changing saved copies or annotations`,async()=>{
    const source=await contentPage(`<div id="deck_cards"></div><div id="extra_cards">${card('42','Updated card')}</div><div id="side_cards">${card('43','Side card')}</div>${card('99','Search card')}`);
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
  test(`constructor detection and import accept ${attribute}-named deck/extra/side containers`,async()=>{
    const source=await contentPage(`<div ${attribute}="deck_cards">${card('42','Deck monster')}</div><div ${attribute}="extra_cards">${card('44','Extra monster')}</div><div ${attribute}="side_cards">${card('43','Side spell')}</div>${card('99','Search result')}`);
    const ui=await popup(source);
    try {
      assert.equal(await ui.locator('#scan').isEnabled(),true);
      await ui.locator('#scan').click();
      await ui.waitForFunction(()=>document.querySelector('#message').textContent.includes('Added 3'));
      assert.deepEqual(Object.keys(await ui.evaluate(()=>window.saved.dbcd_cards_v1)).sort(),['42','43','44']);
      assert.equal((await send(source,{type:'DBCD_PREVIEW',id:'44'})).ok,true);
      assert.equal(await source.locator('#dbcd-preview-overlay .name_txt').textContent(),'Extra monster');
    } finally {await ui.close();await source.close();}
  });
}
for(const container of ['deck_cards','extra_cards','side_cards']) {
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
  const source=await contentPage(`<div id="deck_cards" class="deck_cards">${card('42','Deck card')}</div><div id="extra_cards" class="extra_cards">${card('44','Extra card')}</div><div class="side_cards other-class">${card('43','Side card')}</div>${card('99','Outside card')}`);
  try {
    const scan=await send(source,{type:'DBCD_SCAN'});
    assert.equal(scan.rendered,3);assert.deepEqual(scan.cards.map(c=>c.id),['42','44','43']);
  } finally {await source.close();}
});

test('official and custom Spell/Trap subtypes are extracted',async()=>{
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


for (const official of [false,true]) {
  test(`${official?'official':'custom'} Pendulum scales are extracted, including zero in hidden Extra Decks`,async()=>{
    const source=await contentPage(`<div class="extra_cards" style="display:none">${pendulumCard('42',0,13,official)}</div>`);
    try {
      const {cards}=await send(source,{type:'DBCD_SCAN'});
      assert.equal(cards.length,1);
      assert.deepEqual(cards[0].visual,{version:1,pendulum:true,scaleLeft:0,scaleRight:13});
    } finally {await source.close();}
  });
}

test('hidden, missing and invalid scale placeholders remain unresolved',async()=>{
  const fixtures=[
    pendulumCard('1',0,8).replace('class="scale_left_txt"','class="scale_left_txt" style="display:none"'),
    pendulumCard('2','',8),pendulumCard('3','?',8),pendulumCard('4','100',8),
    pendulumCard('5','-1',8),pendulumCard('6','1.5',8),
    pendulumCard('7',0,8).replace(/<span class="scale_left_txt">.*?<\/span>/,''),
    pendulumCard('8',0,8).replace(/class="scale_(left|right)_txt"/g,'style="display:none" class="scale_$1_txt"'),
    pendulumCard('9',0,8).replace('effect_front2.webp','spell_front2.webp').replace('Spellcaster / Pendulum / Effect','[ SPELL CARD ]')
  ];
  const source=await contentPage(`<div class="deck_cards">${fixtures.join('')}</div>`);
  try {
    const {cards}=await send(source,{type:'DBCD_SCAN'});
    assert.equal(cards.length,9);
    for (const record of cards.slice(0,7)) {
      assert.equal(record.visual.scaleLeft,undefined);assert.equal(record.visual.scaleRight,8);
    }
    assert.equal(cards[7].visual,undefined);assert.equal(cards[8].visual,undefined);
  } finally {await source.close();}
});

test('duplicate Pendulum cards prefer available scales in either order',async()=>{
  const complete=pendulumCard('42',0,8);
  const incomplete=complete.replace(/<span class="scale_(?:left|right)_txt">.*?<\/span>/g,'');
  for (const html of [incomplete+complete,complete+incomplete]) {
    const source=await contentPage(`<div class="deck_cards">${html}</div>`);
    try {
      const {cards}=await send(source,{type:'DBCD_SCAN'});
      assert.equal(cards.length,1);assert.equal(cards[0].visual.scaleLeft,0);assert.equal(cards[0].visual.scaleRight,8);
    } finally {await source.close();}
  }
});

test('Pendulum rescan updates scales and JSON round trip preserves scales and annotations',async()=>{
  const source=await contentPage(`<div class="extra_cards">${pendulumCard('42',0,13)}</div>`);
  const old={id:'42',name:'Old',copies:7,section:'extra',importedAt:'2025-01-01',notes:'keep',
    visual:{version:1,scaleLeft:2,scaleRight:2,customNote:'keep visual metadata'}};
  const ui=await popup(source,'https://www.duelingbook.com/',{'42':old});
  const restored=await popup(source);
  try {
    await ui.locator('#scan').click();
    await ui.waitForFunction(()=>window.saved.dbcd_cards_v1['42'].visual.scaleLeft===0);
    await ui.locator('#scan').click();
    await ui.waitForFunction(()=>document.querySelector('#message').textContent.includes('Added 0'));
    // A later incomplete scan must retain the last known scales.
    await source.evaluate(()=>{document.querySelectorAll('.scale_left_txt, .scale_right_txt').forEach(el=>el.remove());});
    await ui.locator('#scan').click();
    await ui.waitForFunction(()=>document.querySelector('#message').textContent.includes('Added 0'));
    await ui.evaluate(()=>{URL.createObjectURL=blob=>{window.exportedCube=blob.text();return 'blob:test';};});
    await ui.locator('#export').click();
    const exported=await ui.evaluate(()=>window.exportedCube);
    const record=JSON.parse(exported).cards[0];
    assert.deepEqual(record.visual,{version:1,pendulum:true,scaleLeft:0,scaleRight:13,customNote:'keep visual metadata'});
    assert.equal(record.copies,7);assert.equal(record.section,'extra');
    assert.equal(record.notes,'keep');assert.equal(record.importedAt,old.importedAt);
    await restored.locator('#json-file').setInputFiles({name:'cube.json',mimeType:'application/json',buffer:Buffer.from(exported)});
    await restored.waitForFunction(()=>window.saved.dbcd_cards_v1['42']);
    assert.deepEqual(await restored.evaluate(()=>window.saved.dbcd_cards_v1['42']),record);
  } finally {await ui.close();await restored.close();await source.close();}
});

test('official artwork IDs populate duelingbookId without changing collection keys',async()=>{
  const urls=[
    ['https://images.duelingbook.com/low-res/12345.jpg','12345'],
    ['https://images.duelingbook.com/low-res/12345.jpg?version=2','12345'],
    ['https://images.duelingbook.com/low-res/67890.jpg#art','67890'],
    ['https://example.test/low-res/12345.jpg',''],
    ['https://images.duelingbook.com.example.test/low-res/12345.jpg',''],
    ['https://images.duelingbook.com/low-res/blue-eyes.jpg',''],
    ['https://images.duelingbook.com/low-res/12345.jpg/other',''],
    ['https://images.duelingbook.com/overframes/12345.jpg','']
  ];
  for (const [url,expected] of urls) {
    const markup=card('blue-eyes','Official monster',true).replace('https://example.test/pics/blue-eyes.jpg',url);
    const source=await contentPage(`<div class="deck_cards">${markup}</div>`);
    try {
      const {cards}=await send(source,{type:'DBCD_SCAN'});
      assert.equal(cards.length,1);assert.equal(cards[0].origin,'official');
      assert.equal(cards[0].duelingbookId,expected);
      assert.match(cards[0].id,/^official:[0-9a-f]{8}$/);
      // The pre-existing local hash remains stable for saved collections.
      let hash=2166136261;
      for (const char of 'Official monster\u0000'+url.split('?')[0]) {
        hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);
      }
      assert.equal(cards[0].id,'official:'+(hash>>>0).toString(16).padStart(8,'0'));
    } finally {await source.close();}
  }
});

test('official ID rescan fills old records and survives export/restore without adding duplicates',async()=>{
  const markup=card('12345','Official monster',true).replace('https://example.test/pics/12345.jpg','https://images.duelingbook.com/low-res/12345.jpg?version=2');
  const source=await contentPage(`<div class="extra_cards">${markup}</div>`);
  const extracted=(await send(source,{type:'DBCD_SCAN'})).cards[0];
  const old={...extracted,duelingbookId:'',copies:4,section:'extra',notes:'keep',importedAt:'2025-01-01'};
  const ui=await popup(source,'https://www.duelingbook.com/',{[old.id]:old});
  const restored=await popup(source);
  try {
    await ui.locator('#scan').click();
    await ui.waitForFunction(()=>document.querySelector('#message').textContent.includes('Added 0'));
    const saved=await ui.evaluate(()=>window.saved.dbcd_cards_v1);
    assert.deepEqual(Object.keys(saved),[old.id]);
    assert.equal(saved[old.id].duelingbookId,'12345');
    assert.equal(saved[old.id].copies,4);assert.equal(saved[old.id].section,'extra');
    assert.equal(saved[old.id].notes,'keep');assert.equal(saved[old.id].importedAt,old.importedAt);
    await ui.evaluate(()=>{URL.createObjectURL=blob=>{window.exportedCube=blob.text();return 'blob:test';};});
    await ui.locator('#export').click();
    const exported=await ui.evaluate(()=>window.exportedCube);
    assert.equal(JSON.parse(exported).cards[0].duelingbookId,'12345');
    await restored.locator('#json-file').setInputFiles({name:'cube.json',mimeType:'application/json',buffer:Buffer.from(exported)});
    await restored.waitForFunction(()=>Object.keys(window.saved.dbcd_cards_v1).length===1);
    assert.deepEqual(await restored.evaluate(()=>window.saved.dbcd_cards_v1),saved);
  } finally {await ui.close();await restored.close();await source.close();}
});


for (const official of [false,true]) {
  test(`${official?'official':'custom'} Xyz ranks extract separately from levels`,async()=>{
    const source=await contentPage(`<div class="extra_cards" style="display:none">${xyzCard('42',4,official)}${xyzCard('43',13,official,true)}</div>`);
    try {
      const {cards}=await send(source,{type:'DBCD_SCAN'});
      assert.equal(cards.length,2);
      for (const [i,record] of cards.entries()) {
        const rank=i===0?4:13;
        assert.equal(record.visual.rank,rank);assert.equal(record.level,null);
      }
      assert.equal(cards[1].visual.scaleLeft,2);assert.equal(cards[1].visual.scaleRight,8);
    } finally {await source.close();}
  });
}

test('Xyz scans ignore hidden rank placeholders and duplicate scans prefer known ranks',async()=>{
  const complete=xyzCard('42',4), incomplete=xyzCard('42',0);
  for (const html of [incomplete+complete,complete+incomplete]) {
    const source=await contentPage(`<div class="extra_cards">${html}</div>`);
    try {
      const {cards}=await send(source,{type:'DBCD_SCAN'});
      assert.equal(cards.length,1);assert.equal(cards[0].visual.rank,4);
    } finally {await source.close();}
  }
  const source=await contentPage(`<div class="deck_cards">${xyzCard('43',0)}${xyzCard('44',4).replace('xyz_front2','effect_front2').replace('Dragon / Xyz / Effect','Dragon / Effect')}<div class="cardfront_content"><span class="name_txt">Level monster</span><img class="pic" src="https://example.test/custom-pics/1/45.png">${'<img class="level">'.repeat(3)}</div></div>`);
  try {
    const {cards}=await send(source,{type:'DBCD_SCAN'});
    assert.equal(cards[0].visual?.rank,undefined);assert.equal(cards[1].visual?.rank,undefined);
    assert.equal(cards[2].level,3);assert.equal(cards[2].visual?.rank,undefined);
  } finally {await source.close();}
});

test('Xyz rescan repairs old records and Cube export/restore retains the rank',async()=>{
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
  } finally {await ui.close();await restored.close();await source.close();}
});
