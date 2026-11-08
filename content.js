(() => {
  'use strict';
  const text = (node) => node?.textContent?.trim() || '';
  const display = (node) => {
    if (!node) return false;
    const inline = node.style?.display;
    return inline !== 'none' && getComputedStyle(node).display !== 'none';
  };
  const src = (node) => node?.currentSrc || node?.getAttribute('src') || '';
  const asset = (node) => src(node).split('/').pop()?.split('?')[0] || '';
  const normalize = (s) => s.replace(/\s+/g, ' ').trim();
  // Deterministic local key for official cards. This is NOT a DuelingBook card ID.
  // Prefer the artwork URL (without its cache-busting query) and card name.
  function officialKey(name, url) {
    const clean = url.split('?')[0];
    let hash = 2166136261;
    for (const char of name + '\u0000' + clean) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return 'official:' + (hash >>> 0).toString(16).padStart(8, '0');
  }

  function extractCard(node) {
    const picture = node.querySelector('img.pic');
    const artwork = src(picture);
    const idMatch = artwork.match(/\/custom-pics\/\d+\/(\d+)\.(?:jpg|jpeg|png|webp)(?:\?|$)/i);
    const name = normalize(text(node.querySelector('.name_txt')) || text(node.querySelector('.name2_txt')));
    if (!name || !artwork || /\/(?:blank|card_back)\.(?:png|webp|jpg)/i.test(artwork)) return null;
    const isCustom = Boolean(idMatch);
    const effectNode = node.querySelector('.effect_txt');
    const pendulumNode = node.querySelector('.card_pendulum_effect_txt');
    const attrNode = node.querySelector('img.attribute');
    const levels = [...node.querySelectorAll('.level')].filter(display).length;
    const role = asset(node.querySelector('.card_color')).replace(/_front\d*\.webp$/i, '').replace(/\.webp$/i, '');
    const typeText = normalize(text(node.querySelector('.type_txt')) || text(node.querySelector('.spell_type_txt')));
    const record = {
      id: isCustom ? idMatch[1] : officialKey(name, artwork), name, artwork,
      origin: isCustom ? 'custom' : 'official',
      duelingbookId: isCustom ? idMatch[1] : '',
      frame: src(node.querySelector('.card_color')),
      attribute: asset(attrNode).replace(/_attribute\.webp$/i, '').toUpperCase(),
      level: levels || null,
      type: typeText,
      effect: display(effectNode) ? text(effectNode) : '',
      pendulumEffect: display(pendulumNode) ? text(pendulumNode) : '',
      atk: display(node.querySelector('.card_atk_txt')) ? text(node.querySelector('.card_atk_txt')) : '',
      def: display(node.querySelector('.card_def_txt')) ? text(node.querySelector('.card_def_txt')) : '',
      link: display(node.querySelector('.link_txt')) ? text(node.querySelector('.link_txt')) : '',
      passcode: text(node.querySelector('.passcode_txt')),
      section: 'unknown',
      copies: 1,
      source: location.href,
      updatedAt: new Date().toISOString()
    };
    return record;
  }

  function scan() {
    const roots = [...document.querySelectorAll('.cardfront_content')];
    const records = new Map();
    for (const root of roots) {
      const card = extractCard(root);
      if (!card) continue;
      // The page may contain a duplicate preview element. Prefer the record with the most information.
      const old = records.get(card.id);
      const score = (v) => [v.name, v.effect, v.type, v.frame, v.atk].filter(Boolean).join('').length;
      if (!old || score(card) > score(old)) records.set(card.id, card);
    }
    return { cards: [...records.values()], rendered: roots.length, page: location.href };
  }

  function preview(id) {
    const roots = [...document.querySelectorAll('.cardfront_content')];
    const root = roots.find(node => {
      const url = src(node.querySelector('img.pic'));
      const customId = url.match(/\/custom-pics\/\d+\/(\d+)\.(?:jpg|jpeg|png|webp)(?:\?|$)/i)?.[1];
      const name = normalize(text(node.querySelector('.name_txt')) || text(node.querySelector('.name2_txt')));
      return customId === id || (!customId && officialKey(name, url) === id);
    });
    if (!root) return {ok:false,error:'Card '+id+' is not rendered on this page. Open its deck first.'};
    document.getElementById('dbcd-preview-overlay')?.remove();
    const overlay=document.createElement('div');
    overlay.id='dbcd-preview-overlay';
    Object.assign(overlay.style, {position:'fixed',inset:'0',zIndex:'2147483647',background:'rgba(4,9,17,.93)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Arial, sans-serif'});
    const host=document.createElement('div');
    Object.assign(host.style,{position:'relative',width:'813px',height:'1185px',flex:'none',transformOrigin:'center center'});
    const clone=root.cloneNode(true);
    // Preserve DuelingBook's existing typography and positioning without changing the original card.
    // The computed styles remain available even if the card was hidden in the deck grid.
    const originals=[root,...root.querySelectorAll('*')];
    const copies=[clone,...clone.querySelectorAll('*')];
    const properties=['position','display','left','top','right','bottom','width','height','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','white-space','color','background-color','border','padding','margin','transform','transform-origin','object-fit','opacity','z-index','overflow','box-sizing','text-shadow'];
    originals.forEach((original,i)=>{
      const computed=getComputedStyle(original);
      for (const prop of properties) copies[i].style.setProperty(prop,computed.getPropertyValue(prop));
    });
    Object.assign(clone.style,{display:'block',position:'absolute',left:'0',top:'0',width:'813px',height:'1185px',pointerEvents:'none'});
    host.append(clone);
    const close=document.createElement('button');
    close.textContent='Close preview ×';
    Object.assign(close.style,{position:'fixed',right:'18px',top:'18px',zIndex:'2147483647',fontSize:'16px',padding:'12px 16px',background:'#294b78',color:'#fff',border:'1px solid #779cce',borderRadius:'8px',cursor:'pointer'});
    const esc=e=>{if(e.key==='Escape'){overlay.remove();document.removeEventListener('keydown',esc);}};
    close.onclick=()=>{overlay.remove();document.removeEventListener('keydown',esc);};
    overlay.addEventListener('click',e=>{if(e.target===overlay)close.click();});
    overlay.append(host,close);document.body.append(overlay);
    const updateScale=()=>{const scale=Math.min((window.innerWidth-64)/813,(window.innerHeight-64)/1185,1);host.style.transform=`scale(${Math.max(.12,scale)})`;};
    updateScale();
    document.addEventListener('keydown',esc);
    return {ok:true};
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'DBCD_SCAN' && message?.type !== 'DBCD_PREVIEW') return;
    try {sendResponse(message.type==='DBCD_SCAN' ? {ok:true,...scan()} : preview(message.id));}
    catch(error){sendResponse({ok:false,error:String(error)});}
  });
})();