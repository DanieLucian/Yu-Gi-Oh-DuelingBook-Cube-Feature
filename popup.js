'use strict';
const STORE_KEY = 'dbcd_cards_v1';
const $ = (id) => document.getElementById(id);
let collection = {};
let tabId = null;
let collectionLoaded;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(value, error=false) { $('message').textContent = value; $('message').className = 'message' + (error?' error':''); }
// Serialize writes in this popup and publish UI state only after storage succeeds.
let pendingWrite = Promise.resolve();
function updateCollection(edit) {
  const write = pendingWrite.then(async () => {
    await collectionLoaded;
    const next = structuredClone(collection);
    const result = edit(next);
    await chrome.storage.local.set({[STORE_KEY]: next});
    collection = next;
    render();
    return result;
  });
  pendingWrite = write.catch(() => {});
  return write;
}
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
    <div><h3>${escapeHtml(c.name)}</h3><div class="id">ID: ${escapeHtml(c.id)} · ${escapeHtml(c.origin === 'official' ? 'Official' : 'Custom')} · ${escapeHtml(c.type || 'Unknown type')}</div><div class="details">${escapeHtml(c.effect || c.pendulumEffect || 'No effect text extracted')}</div><label class="section-label" for="section-${escapeHtml(c.id)}">Section</label><select id="section-${escapeHtml(c.id)}" data-action="section">${[['unknown','Unassigned'],['main','Main Deck'],['extra','Extra Deck'],['side','Side Deck']].map(([value,label])=>`<option value="${value}"${(c.section || 'unknown')===value?' selected':''}>${label}</option>`).join('')}</select><div><button type="button" data-action="preview">Preview full card</button></div></div>
    <div class="controls"><label for="copy-${escapeHtml(c.id)}">Copies</label><input type="number" min="1" max="99" id="copy-${escapeHtml(c.id)}" data-action="copies" value="${escapeHtml(c.copies)}"><button title="Remove card" data-action="remove">×</button></div>
  </article>`).join('') : '<div class="empty">No matching cards.</div>';
}
async function scan() {
  if (!tabId) return notice('Open a DuelingBook deck or card page first.', true);
  $('scan').disabled = true;
  try {
    const response = await chrome.tabs.sendMessage(tabId,{type:'DBCD_SCAN'});
    if (!response?.ok) throw new Error(response?.error || 'No response from page');
    const {added, updated} = await updateCollection(next => {
      let added=0, updated=0;
      for (const card of response.cards) {
        const old = next[card.id];
        next[card.id] = old ? {...old, ...card, copies:old.copies, section:old.section==='unknown'?card.section:old.section, duelingbookId:old.duelingbookId || card.duelingbookId, importedAt:old.importedAt} : {...card, importedAt:new Date().toISOString()};
        old ? updated++ : added++;
      }
      return {added, updated};
    });
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
async function exportJson() {
  await collectionLoaded;
  await pendingWrite;
  const out={schema:'dbcd-cube-v1',exportedAt:new Date().toISOString(),cards:Object.values(collection)};
  download('duelingbook-cube.json',JSON.stringify(out,null,2),'application/json');
  notice(`Exported ${out.cards.length} unique cards.`);
}
function parseCubeBackup(data) {
  if (!data || data.schema !== 'dbcd-cube-v1' || !Array.isArray(data.cards)) {
    throw new Error('Choose an exported Cube JSON file (dbcd-cube-v1).');
  }
  const seen = new Set();
  for (const card of data.cards) {
    if (!card || typeof card !== 'object' || Array.isArray(card) ||
        typeof card.id !== 'string' || !/^(?:[0-9]+|official:[0-9a-f]{8})$/.test(card.id) ||
        typeof card.name !== 'string' || !card.name.trim()) {
      throw new Error('Every card must have a valid card ID and name. Nothing was imported.');
    }
    if (seen.has(card.id)) throw new Error('Duplicate card ID in backup: '+card.id+'. Nothing was imported.');
    seen.add(card.id);
    if (!Number.isInteger(card.copies) || card.copies < 1 || card.copies > 99 ||
        !['unknown','main','extra','side'].includes(card.section ?? 'unknown')) {
      throw new Error('Card '+card.id+' has invalid copies or section. Nothing was imported.');
    }
    for (const field of ['artwork','type','effect','pendulumEffect','origin','duelingbookId','importedAt']) {
      if (card[field] !== undefined && typeof card[field] !== 'string') {
        throw new Error('Card '+card.id+' has an invalid '+field+'. Nothing was imported.');
      }
    }
  }
  return data.cards;
}
async function importJson(file) {
  const cards = parseCubeBackup(JSON.parse(await file.text()));
  const {added, skipped} = await updateCollection(next => {
    let added=0, skipped=0;
    for (const card of cards) {
      if (Object.hasOwn(next, card.id)) { skipped++; continue; }
      next[card.id] = {...card, section:card.section ?? 'unknown'};
      added++;
    }
    return {added, skipped};
  });
  notice(`Imported ${added} cards; kept ${skipped} existing cards unchanged. Copies were not added together.`);
}
async function annotateXml(file) {
  const data=await file.text();const doc=new DOMParser().parseFromString(data,'application/xml');
  if(doc.querySelector('parsererror')) return notice('Invalid XML file.',true);
  const {found, matchedByName, ambiguous} = await updateCollection(next => {
    let found=0, matchedByName=0, ambiguous=0;
    for (const section of ['main','extra','side']) {
      for (const card of doc.querySelectorAll(`deck > ${section} > card`)) {
        const id=card.getAttribute('id');
        if (next[id]) { next[id].section=section; next[id].duelingbookId=id; found++; continue; }
        // Match official cards only when the visible card name is unique in the collection.
        // Do not guess a match for two distinct card records sharing the same name.
        const name = (card.textContent || '').trim().replace(/\s+/g,' ').toLowerCase();
        const candidates = Object.values(next).filter(c=>c.origin==='official' && c.name.trim().replace(/\s+/g,' ').toLowerCase()===name);
        if (candidates.length===1) {
          const candidate=candidates[0];
          if (candidate.duelingbookId && candidate.duelingbookId!==id) { ambiguous++; continue; }
          candidate.duelingbookId=id;
          candidate.section=section;
          matchedByName++;
        } else if (candidates.length>1) ambiguous++;
      }
    }
    return {found, matchedByName, ambiguous};
  });
  notice(`XML matched ${found} IDs and ${matchedByName} official names; ${ambiguous} ambiguous matches skipped. No new cards added.`);
}
async function initialize() {
  await collectionLoaded;
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});
  const tab=tabs[0];
  if(tab && /^https:\/\/www\.duelingbook\.com\/(deck|card)(\?|$)/.test(tab.url||'')) {
    tabId=tab.id; $('site-state').textContent='DuelingBook page detected';$('site-state').className='status good';
  } else { $('site-state').textContent='Not on a DuelingBook deck';$('scan').disabled=true; }
}
$('scan').addEventListener('click',scan);
$('filter').addEventListener('input',render);
$('export').addEventListener('click',()=>exportJson().catch(error=>notice('Export failed: '+error.message,true)));
$('import').addEventListener('click',()=>$('json-file').click());
$('json-file').addEventListener('change',async e=>{
  const input = e.target;
  if (!input.files[0]) return;
  $('import').disabled = true;
  try { await importJson(input.files[0]); }
  catch (error) { notice('Import failed: '+error.message,true); }
  finally { input.value=''; $('import').disabled=false; }
});
$('xml').addEventListener('click',()=>$('xml-file').click());
$('xml-file').addEventListener('change',async e=>{if(e.target.files[0]){try{await annotateXml(e.target.files[0]);}catch(err){notice(err.message,true);}}e.target.value='';});
$('cards').addEventListener('change',async e=>{
  const action=e.target.dataset.action;
  if (action!=='copies' && action!=='section') return;
  const id=e.target.closest('[data-id]')?.dataset.id;
  const value=e.target.value;
  if (!collection[id]) return;
  try {
    await updateCollection(next => {
      if (!next[id]) return;
      if (action==='copies') next[id].copies=Math.max(1,Math.min(99,Math.trunc(Number(value)||1)));
      else if (['unknown','main','extra','side'].includes(value)) next[id].section=value;
    });
  } catch (error) { render(); notice('Could not save changes: '+error.message,true); }
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
  if(id&&collection[id]) {
    try { await updateCollection(next => { delete next[id]; }); notice(`Removed card ${id}.`); }
    catch (error) { notice('Could not remove card: '+error.message,true); }
  }
});
$('clear').addEventListener('click',async()=>{
  if(!confirm('Delete the local Cube collection? Export JSON first if you want a backup.'))return;
  try { await updateCollection(next => { for (const id of Object.keys(next)) delete next[id]; }); notice('Local collection cleared.'); }
  catch (error) { notice('Could not clear collection: '+error.message,true); }
});
collectionLoaded=load();
initialize().catch(e=>notice('Startup error: '+e.message,true));