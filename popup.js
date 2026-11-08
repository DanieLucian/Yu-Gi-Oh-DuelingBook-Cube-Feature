'use strict';
const STORE_KEY = 'dbcd_cards_v1';
const $ = (id) => document.getElementById(id);
let collection = {};
let tabId = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(value, error=false) { $('message').textContent = value; $('message').className = 'message' + (error?' error':''); }
async function save() { await chrome.storage.local.set({[STORE_KEY]: collection}); }
async function load() { collection = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY] || {}; render(); }
function render() {
  const rows = Object.values(collection).sort((a,b)=>a.name.localeCompare(b.name));
  $('unique').textContent = String(rows.length);
  $('instances').textContent = String(rows.reduce((n,c)=>n+(Number(c.copies)||0),0));
  $('extra').textContent = String(rows.filter(c=>c.section==='extra').length);
  $('total').textContent = rows.length + ' unique';
  const q = $('filter').value.trim().toLowerCase();
  const filtered = rows.filter(c=>c.name.toLowerCase().includes(q) || c.id.includes(q));
  $('cards').innerHTML = filtered.length ? filtered.map(c=>`<article class="card" data-id="${escapeHtml(c.id)}">
    <img src="${escapeHtml(c.artwork)}" alt="Artwork for ${escapeHtml(c.name)}" referrerpolicy="no-referrer">
    <div><h3>${escapeHtml(c.name)}</h3><div class="id">ID: ${escapeHtml(c.id)} · ${escapeHtml(c.origin === 'official' ? 'Official' : 'Custom')} · ${escapeHtml(c.type || 'Unknown type')}</div><div class="details">${escapeHtml(c.effect || c.pendulumEffect || 'No effect text extracted')}</div><span class="tag">${escapeHtml(c.section || 'unknown')}</span><div><button type="button" data-action="preview">Preview full card</button></div></div>
    <div class="controls"><label for="copy-${escapeHtml(c.id)}">Copies</label><input type="number" min="1" max="99" id="copy-${escapeHtml(c.id)}" data-action="copies" value="${c.copies}"><button title="Remove card" data-action="remove">×</button></div>
  </article>`).join('') : '<div class="empty">No matching cards.</div>';
}
async function scan() {
  if (!tabId) return notice('Open a DuelingBook deck or card page first.', true);
  $('scan').disabled = true;
  try {
    const response = await chrome.tabs.sendMessage(tabId,{type:'DBCD_SCAN'});
    if (!response?.ok) throw new Error(response?.error || 'No response from page');
    let added=0, updated=0;
    for (const card of response.cards) {
      const old = collection[card.id];
      collection[card.id] = old ? {...card, copies:old.copies, section:old.section==='unknown'?card.section:old.section, duelingbookId:old.duelingbookId || card.duelingbookId, importedAt:old.importedAt} : {...card, importedAt:new Date().toISOString()};
      old ? updated++ : added++;
    }
    await save(); render();
    const officials = response.cards.filter(c=>c.origin==='official').length;
    const customs = response.cards.length - officials;
    notice(`${response.rendered} rendered elements → ${customs} custom + ${officials} official unique cards. Added ${added}, refreshed ${updated}.`);
  } catch (e) {
    notice('Scan failed: '+e.message+'. Refresh the DuelingBook page and try again.',true);
  } finally { $('scan').disabled=false; }
}
function download(name, content, type) {
  const blob = new Blob([content],{type}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function exportJson() {
  const out={schema:'dbcd-cube-v1',exportedAt:new Date().toISOString(),cards:Object.values(collection)};
  download('duelingbook-cube.json',JSON.stringify(out,null,2),'application/json');
  notice(`Exported ${out.cards.length} unique cards.`);
}
async function annotateXml(file) {
  const data=await file.text();const doc=new DOMParser().parseFromString(data,'application/xml');
  if(doc.querySelector('parsererror')) return notice('Invalid XML file.',true);
  let found=0, matchedByName=0, ambiguous=0;
  for (const section of ['main','extra','side']) {
    for (const card of doc.querySelectorAll(`deck > ${section} > card`)) {
      const id=card.getAttribute('id');
      if (collection[id]) { collection[id].section=section; collection[id].duelingbookId=id; found++; continue; }
      // Match official cards only when the visible card name is unique in the collection.
      // Do not guess a match for two distinct card records sharing the same name.
      const name = (card.textContent || '').trim().replace(/\s+/g,' ').toLowerCase();
      const candidates = Object.values(collection).filter(c=>c.origin==='official' && c.name.trim().replace(/\s+/g,' ').toLowerCase()===name);
      if (candidates.length===1) {
        const candidate=candidates[0];
        if (candidate.duelingbookId && candidate.duelingbookId!==id) { ambiguous++; continue; }
        candidate.duelingbookId=id;
        candidate.section=section;
        matchedByName++;
      } else if (candidates.length>1) ambiguous++;
    }
  }
  await save();render();notice(`XML matched ${found} IDs and ${matchedByName} official names; ${ambiguous} ambiguous matches skipped. No new cards added.`);
}
async function initialize() {
  await load();
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});
  const tab=tabs[0];
  if(tab && /^https:\/\/www\.duelingbook\.com\/(deck|card)(\?|$)/.test(tab.url||'')) {
    tabId=tab.id; $('site-state').textContent='DuelingBook page detected';$('site-state').className='status good';
  } else { $('site-state').textContent='Not on a DuelingBook deck';$('scan').disabled=true; }
}
$('scan').addEventListener('click',scan);
$('filter').addEventListener('input',render);
$('export').addEventListener('click',exportJson);
$('xml').addEventListener('click',()=>$('xml-file').click());
$('xml-file').addEventListener('change',async e=>{if(e.target.files[0]){try{await annotateXml(e.target.files[0]);}catch(err){notice(err.message,true);}}e.target.value='';});
$('cards').addEventListener('change',async e=>{
  if(e.target.dataset.action!=='copies')return;
  const id=e.target.closest('[data-id]')?.dataset.id;
  if(!collection[id])return;
  collection[id].copies=Math.max(1,Math.min(99,Math.trunc(Number(e.target.value)||1)));
  await save();render();
});
$('cards').addEventListener('click',async e=>{
  if(e.target.dataset.action==='preview'){
    const id=e.target.closest('[data-id]')?.dataset.id;
    if(!tabId)return notice('Open a DuelingBook deck containing this card first.',true);
    try {
      const response=await chrome.tabs.sendMessage(tabId,{type:'DBCD_PREVIEW',id});
      if(!response?.ok)throw new Error(response?.error||'Card not rendered on the active page');
      window.close();
    } catch(error){notice('Preview failed: '+error.message,true);}
    return;
  }
  if(e.target.dataset.action!=='remove')return;
  const id=e.target.closest('[data-id]')?.dataset.id;
  if(id&&collection[id]){delete collection[id];await save();render();notice(`Removed card ${id}.`);}
});
$('clear').addEventListener('click',async()=>{
  if(!confirm('Delete the local Cube collection? Export JSON first if you want a backup.'))return;
  collection={};await save();render();notice('Local collection cleared.');
});
initialize().catch(e=>notice('Startup error: '+e.message,true));