(() => {
  'use strict';
  const SECTIONS = ['main', 'extra', 'side'];
  const normalizeName = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  function normalizeId(value) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const id = String(value).trim();
    return /^[0-9]+$/.test(id) && !/^0+$/.test(id) ? id.replace(/^0+/, '') : null;
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagNameNS('*', 'parsererror').length) {
      throw new Error('Invalid XML. No Cube cards were changed.');
    }
    const root = doc.documentElement;
    if (root?.localName !== 'deck') throw new Error('Expected a DuelingBook <deck> XML file. No Cube cards were changed.');
    const entries = [];
    const visited = new Set();
    for (const section of root.children) {
      if (!SECTIONS.includes(section.localName) || section.namespaceURI !== root.namespaceURI) continue;
      for (const card of section.children) {
        if (card.localName !== 'card' || card.namespaceURI !== root.namespaceURI) continue;
        visited.add(card);
        const textName = card.textContent.trim();
        const attributeName = (card.getAttribute('name') || '').trim();
        entries.push({
          id: card.getAttribute('id') || '',
          name: textName || attributeName,
          section: section.localName,
          problem: textName && attributeName && normalizeName(textName) !== normalizeName(attributeName)
            ? 'The XML name attribute and card text disagree.' : ''
        });
      }
    }
    const allCards = [...root.getElementsByTagName('*')].filter(node => node.localName === 'card');
    if (allCards.some(card => !visited.has(card))) {
      throw new Error('Card entries must be directly inside <main>, <extra> or <side>. No Cube cards were changed.');
    }
    if (!entries.length) throw new Error('This XML deck contains no card entries. No Cube cards were changed.');
    return entries;
  }

  function addIndex(index, key, value) {
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(value);
  }

  // Build a plan from the original collection. Never choose a binding by XML
  // order, and never mutate cards while resolving another row's candidates.
  function planMatches(collection, entries) {
    const byId = new Map();
    const byName = new Map();
    const records = new Map();
    for (const [key, card] of Object.entries(collection)) {
      const localId = normalizeId(card.id ?? key);
      const savedId = normalizeId(card.duelingbookId);
      const hasSavedId = card.duelingbookId !== undefined && card.duelingbookId !== null && String(card.duelingbookId).trim() !== '';
      const issue = hasSavedId && !savedId ? 'The saved DuelingBook ID is invalid.'
        : localId && savedId && localId !== savedId ? 'The custom card ID and saved DuelingBook ID disagree.' : '';
      const record = {key, card, localId, savedId, issue};
      records.set(key, record);
      for (const id of new Set([localId, savedId].filter(Boolean))) addIndex(byId, id, record);
      addIndex(byName, normalizeName(card.name), record);
    }

    const groups = new Map();
    const nameIds = new Map();
    const items = [];
    for (const entry of entries) {
      const id = normalizeId(entry.id);
      if (!id || !SECTIONS.includes(entry.section)) {
        items.push({id: String(entry.id ?? ''), name: String(entry.name ?? ''), sections: SECTIONS.includes(entry.section) ? [entry.section] : [], occurrences: 1, status: 'invalid', reason: 'A positive numeric XML ID and a valid deck section are required.'});
        continue;
      }
      if (!groups.has(id)) {
        const group = {id, name: '', names: new Set(), sections: new Set(), occurrences: 0, problems: new Set()};
        groups.set(id, group);
        items.push(group);
      }
      const group = groups.get(id);
      const name = normalizeName(entry.name);
      if (name) {
        group.names.add(name);
        if (!group.name) group.name = String(entry.name).trim();
        if (!nameIds.has(name)) nameIds.set(name, new Set());
        nameIds.get(name).add(id);
      }
      if (entry.problem) group.problems.add(entry.problem);
      group.sections.add(entry.section);
      group.occurrences++;
    }

    const results = items.map(item => {
      if (item.status === 'invalid') return item;
      const result = {id:item.id, name:item.name, sections:SECTIONS.filter(s => item.sections.has(s)), occurrences:item.occurrences, status:'unmatched', reason:''};
      const skip = (status, reason) => Object.assign(result, {status, reason});
      const match = (record, method) => Object.assign(result, {status:'matched', method, cardKey:record.key, name:result.name || record.card.name, reason:method === 'id' ? 'Matched by an existing card ID.' : 'Matched by a unique official-card name.'});
      if (item.problems.size) return skip('conflict', [...item.problems].join(' '));
      if (item.names.size > 1) return skip('conflict', 'This XML ID has conflicting card names in the file.');

      const known = byId.get(item.id) || [];
      if (known.length > 1) return skip('conflict', 'This ID is bound to multiple Cube records: ' + known.map(r => r.key).join(', ') + '.');
      if (known.length === 1) {
        return known[0].issue ? skip('conflict', known[0].issue) : match(known[0], 'id');
      }
      const name = [...item.names][0];
      if (!name) return skip('unmatched', 'No known ID or card name is available for matching.');
      const candidates = byName.get(name) || [];
      if (!candidates.length) return skip('unmatched', 'No Cube card has this ID or name. Import the card from DuelingBook first.');
      if (candidates.length > 1) return skip('ambiguous', 'Multiple Cube cards have this name: ' + candidates.map(r => r.key).join(', ') + '.');
      const record = candidates[0];
      if (record.issue) return skip('conflict', record.issue);
      if (record.savedId && record.savedId !== item.id) return skip('conflict', 'This name is already bound to DuelingBook ID ' + record.savedId + '.');
      if (record.localId || !(record.card.origin === 'official' || String(record.card.id ?? record.key).startsWith('official:'))) {
        return skip('conflict', 'Custom cards require their exact card ID; a name cannot replace it.');
      }
      if (nameIds.get(name).size > 1) return skip('conflict', 'This name appears with multiple XML IDs in the file.');
      return match(record, 'name');
    });

    // Defend against several different XML IDs proposing the same Cube record.
    const proposals = new Map();
    for (const result of results) if (result.status === 'matched') addIndex(proposals, result.cardKey, result);
    for (const proposed of proposals.values()) {
      if (proposed.length < 2) continue;
      for (const result of proposed) {
        result.status = 'conflict';
        result.reason = 'Multiple XML IDs would bind to the same Cube card.';
        delete result.method;
        delete result.cardKey;
      }
    }

    const updates = [];
    const summary = {entries:entries.length, byId:0, byName:0, ambiguous:0, conflict:0, unmatched:0, invalid:0, multiSection:0};
    for (const result of results) {
      if (result.status !== 'matched') { summary[result.status]++; continue; }
      summary[result.method === 'id' ? 'byId' : 'byName']++;
      const card = records.get(result.cardKey).card;
      const update = {key:result.cardKey, duelingbookId:result.id};
      if (result.sections.length === 1) update.section = result.sections[0];
      else {
        summary.multiSection++;
        result.reason += ' Appears in several deck sections; the existing Cube section was kept.';
      }
      if (card.duelingbookId !== update.duelingbookId || (update.section !== undefined && card.section !== update.section)) updates.push(update);
    }
    return {updates, results, summary};
  }

  const api = Object.freeze({parseXml, planMatches});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.CubeXml = api;
})();
