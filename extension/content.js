(() => {
  'use strict';
  const text = (node) => node?.textContent?.trim() || '';
  const display = (node) => {
    if (!node) return false;
    const inline = node.style?.display;
    return inline !== 'none' && getComputedStyle(node).display !== 'none';
  };
  function effectText(root) {
    if (!display(root)) return '';
    // Read the markup directly so breaks survive even in a hidden Extra Deck.
    let result = '';
    function endLine() {
      if (result && !/\n[ \t]*$/.test(result)) result += '\n';
    }
    function append(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        result += node.nodeValue;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches('script, style') || !display(node)) return;
      if (node.tagName === 'BR') {
        result += '\n';
        return;
      }
      const block = node.matches('div, p, li');
      if (block) endLine();
      for (const child of node.childNodes) append(child);
      if (block) endLine();
    }
    for (const child of root.childNodes) append(child);
    return result.replace(/\r\n?/g, '\n').trim();
  }
  const src = (node) => node?.currentSrc || node?.getAttribute('src') || '';
  const asset = (node) => src(node).split('/').pop()?.split('?')[0] || '';
  const normalize = (s) => s.replace(/\s+/g, ' ').trim();
  const SPELL_TRAP_ICONS = ['normal', 'continuous', 'counter', 'equip', 'field', 'quick-play', 'ritual'];
  function spellTrapIcon(node, role, type) {
    if (!['spell', 'trap'].includes(role) && (role || !/\b(?:spell|trap)\b/i.test(type))) return null;
    const icon = node.querySelector('img.type_icon');
    if (display(icon)) {
      const value = asset(icon).split('#')[0].replace(/\.(?:webp|png|jpe?g|svg)$/i, '').toLowerCase();
      // An unknown visible icon must not silently become a Normal card.
      return SPELL_TRAP_ICONS.includes(value) ? value : null;
    }
    const explicit = SPELL_TRAP_ICONS.find(value =>
      new RegExp(`\\b${value === 'quick-play' ? 'quick[- ]play' : value}\\b`, 'i').test(type));
    if (explicit) return explicit;
    // DuelingBook keeps a hidden continuous.webp placeholder on Normal cards.
    // Require the actual icon element and active Spell/Trap header as evidence.
    return icon && display(node.querySelector('.spell_type_txt')) ? 'normal' : null;
  }
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
    // DuelingBook's loadImage builds standard official artwork from its card ID.
    // External artwork filenames do not establish a DuelingBook identity.
    const officialIdMatch = artwork.match(/^https:\/\/images\.duelingbook\.com\/low-res\/([0-9]+)\.jpg(?:[?#]|$)/i);
    const name = normalize(text(node.querySelector('.name_txt')) || text(node.querySelector('.name2_txt')));
    if (!name || !artwork || /\/(?:blank|card_back)\.(?:png|webp|jpg)/i.test(artwork)) return null;
    const isCustom = Boolean(idMatch);
    const effectNode = node.querySelector('.effect_txt');
    const pendulumNode = node.querySelector('.card_pendulum_effect_txt');
    const attrNode = node.querySelector('img.attribute');
    const levels = [...node.querySelectorAll('.level')].filter(display).length;
    const role = asset(node.querySelector('.card_color')).replace(/_front\d*\.webp$/i, '').replace(/\.webp$/i, '');
    const typeNodes = [node.querySelector('.type_txt'), node.querySelector('.spell_type_txt')];
    const typeText = normalize(text(typeNodes.find(el => display(el) && text(el))) || typeNodes.map(text).find(Boolean) || '');
    const icon = spellTrapIcon(node, role, typeText);
    const visual = icon ? {version: 1, spellTrapIcon: icon} : {};
    if (role === 'xyz' || /\bxyz\b/i.test(typeText)) {
      const rank = [...node.querySelectorAll('.rank')].filter(display).length;
      // Rank sockets are separate from Level sockets in DuelingBook's template.
      // Missing/hidden sockets cannot establish a rank (including Rank 0).
      if (rank) Object.assign(visual, {version: 1, rank});
    }
    if (role === 'link' || /\blink\b/i.test(typeText)) {
      // DuelingBook numbers sockets clockwise from the upper-left corner.
      const directions = ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'];
      const arrows = [...node.querySelectorAll('img.red_arrow')];
      if (arrows.length) Object.assign(visual, {version: 1, linkArrows: directions.filter((_, index) =>
        display(node.querySelector(`img.red_arrow${index + 1}`)))});
    }
    if (!['spell', 'trap'].includes(role) && !/\b(?:spell|trap) card\b/i.test(typeText)) {
      for (const [field, selector] of [['scaleLeft', '.scale_left_txt'], ['scaleRight', '.scale_right_txt']]) {
        const scaleNode = node.querySelector(selector);
        const value = text(scaleNode);
        // Hidden placeholders and unavailable values must not become scale 0.
        if (display(scaleNode) && /^[0-9]{1,2}$/.test(value)) {
          Object.assign(visual, {version: 1, pendulum: true, [field]: Number(value)});
        }
      }
    }
    const record = {
      id: isCustom ? idMatch[1] : officialKey(name, artwork), name, artwork,
      origin: isCustom ? 'custom' : 'official',
      duelingbookId: isCustom ? idMatch[1] : officialIdMatch?.[1] || '',
      frame: src(node.querySelector('.card_color')),
      attribute: asset(attrNode).replace(/_attribute\.webp$/i, '').toUpperCase(),
      level: levels || null,
      type: typeText,
      ...(visual.version ? {visual} : {}),
      effect: effectText(effectNode),
      pendulumEffect: effectText(pendulumNode),
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

  // Constructor containers may use class names rather than element IDs.
  const EDITOR_CONTAINERS = '#deck_cards, .deck_cards, #extra_cards, .extra_cards, #side_cards, .side_cards';

  function editorPresent() {
    return Boolean(document.querySelector(EDITOR_CONTAINERS));
  }

  function cardRoots() {
    // Exclude editor search results and hover previews. Include cards outside
    // the visible area, and re-read the containers after each editor change.
    const selector = editorPresent()
      ? `:is(${EDITOR_CONTAINERS}) .cardfront_content`
      : '.cardfront_content';
    return [...document.querySelectorAll(selector)];
  }

  function scan() {
    const roots = cardRoots();
    const records = new Map();
    for (const root of roots) {
      const card = extractCard(root);
      if (!card) continue;
      // The page may contain a duplicate preview element. Prefer the record with the most information.
      const old = records.get(card.id);
      const score = (v) => [v.name, v.effect, v.type, v.frame, v.atk].filter(Boolean).join('').length;
      const visualScore = (v) => ['spellTrapIcon', 'scaleLeft', 'scaleRight', 'linkArrows', 'rank'].filter(key => v?.visual?.[key] != null).length + (v?.visual?.linkArrows?.length || 0);
      const metadataScore = visualScore(card) - visualScore(old);
      if (!old || metadataScore > 0 || (metadataScore === 0 && score(card) > score(old))) records.set(card.id, card);
    }
    return { cards: [...records.values()], rendered: roots.length, page: location.href };
  }

  let closePreview = null;

  function preview(id) {
    // Ignore our own clone, and prefer a laid-out card over hidden duplicates.
    const candidates = cardRoots()
      .filter(node => extractCard(node)?.id === id);
    const root = candidates.sort((a, b) =>
      Number(b.getBoundingClientRect().width > 0) - Number(a.getBoundingClientRect().width > 0))[0];
    if (!root) return {ok:false,error:'Card '+id+' is not rendered on this page. Open its deck first.'};
    closePreview?.();

    const computed = getComputedStyle(root);
    // offsetWidth/Height ignore ancestor transforms used by the deck grid.
    const width = root.offsetWidth || parseFloat(computed.width);
    const height = root.offsetHeight || parseFloat(computed.height);
    if (!(width > 0 && height > 0)) {
      return {ok:false,error:'Card dimensions are unavailable. Wait for the deck to finish loading.'};
    }
    const overlay = document.createElement('div');
    overlay.id = 'dbcd-preview-overlay';
    overlay.style.setProperty('all', 'initial', 'important');
    for (const [key, value] of Object.entries({position:'fixed',inset:'0',zIndex:'2147483647',display:'block'})) {
      overlay.style.setProperty(key.replace(/[A-Z]/g, c => '-'+c.toLowerCase()), value, 'important');
    }
    // A shadow root prevents site selectors from restyling the detached card.
    const shadow = overlay.attachShadow({mode:'open'});
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {position:'fixed',inset:'0',background:'rgba(4,9,17,.93)',display:'flex',alignItems:'center',justifyContent:'center'});
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'Full card preview');
    const host = document.createElement('div');
    Object.assign(host.style, {position:'relative',width:width+'px',height:height+'px',flex:'none',transformOrigin:'center'});
    const clone = root.cloneNode(true);
    const originals = [root, ...root.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    const pseudoRules = [];
    originals.forEach((original, i) => {
      const copy = copies[i];
      const style = getComputedStyle(original);
      copy.removeAttribute('style');
      // Include clipping, background layers, filters, visibility, and typography.
      for (const prop of style) copy.style.setProperty(prop, style.getPropertyValue(prop));
      copy.style.setProperty('animation', 'none');
      copy.style.setProperty('transition', 'none');
      copy.dataset.dbcdPreviewNode = String(i);
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(original, pseudo);
        if (ps.content === 'none' || ps.content === 'normal') continue;
        const declarations = [...ps].map(prop => prop+':'+ps.getPropertyValue(prop)+';').join('');
        pseudoRules.push('[data-dbcd-preview-node="'+i+'"]'+pseudo+'{'+declarations+'}');
      }
      // Freeze resolved artwork rather than depending on the clone's responsive context.
      if (original instanceof HTMLImageElement) {
        copy.removeAttribute('srcset');
        copy.removeAttribute('sizes');
        copy.src = original.currentSrc || original.src;
        copy.loading = 'eager';
      }
    });
    Object.assign(clone.style, {display:'block',visibility:'visible',position:'absolute',left:'0',top:'0',right:'auto',bottom:'auto',margin:'0',transform:'none',width:width+'px',height:height+'px',boxSizing:'border-box',pointerEvents:'none'});
    clone.setAttribute('inert', '');
    const styles = document.createElement('style');
    styles.textContent = pseudoRules.join('\n');
    host.append(clone);
    const close = document.createElement('button');
    close.textContent = 'Close preview ×';
    Object.assign(close.style, {position:'fixed',right:'18px',top:'18px',zIndex:'1',fontSize:'16px',padding:'12px 16px',background:'#294b78',color:'#fff',border:'1px solid #779cce',borderRadius:'8px',cursor:'pointer'});
    const previousFocus = document.activeElement;
    const updateScale = () => {
      const scale = Math.max(0.01, Math.min((window.innerWidth-32)/width, (window.innerHeight-112)/height, 1));
      host.style.transform = 'scale('+scale+')';
    };
    const onKey = event => {
      if (event.key === 'Escape') closePreview?.();
      if (event.key === 'Tab') { event.preventDefault(); close.focus(); }
    };
    closePreview = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updateScale);
      closePreview = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
    close.onclick = () => closePreview?.();
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closePreview?.(); });
    backdrop.append(host, close);
    shadow.append(styles, backdrop);
    document.body.append(overlay);
    updateScale();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', updateScale);
    close.focus();
    return {ok:true};
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'DBCD_CONTEXT') {
      sendResponse({ok:true,editor:editorPresent()});
      return;
    }
    if (message?.type !== 'DBCD_SCAN' && message?.type !== 'DBCD_PREVIEW') return;
    try {sendResponse(message.type==='DBCD_SCAN' ? {ok:true,...scan()} : preview(message.id));}
    catch(error){sendResponse({ok:false,error:String(error)});}
  });
})();
