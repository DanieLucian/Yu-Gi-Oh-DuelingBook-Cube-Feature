const {test}=require('node:test');
const assert=require('node:assert/strict');
const {planMatches}=require('../xml-matching.js');
const official=(id='official:1234abcd',name='Official Card',duelingbookId='')=>({id,name,origin:'official',duelingbookId,copies:7,section:'extra',importedAt:'2025-01-01',notes:{keep:true}});
const custom=(id='42',name='Custom Card')=>({id,name,origin:'custom',duelingbookId:id,copies:3,section:'extra'});
const row=(id,name,section='main')=>({id,name,section});
const plan=(cards,rows)=>planMatches(Object.fromEntries(cards.map(c=>[c.id,c])),rows);

test('saved official IDs match even when XML and rendered names differ',()=>{
  const result=plan([official(undefined,'New name','123')],[row('123','Old name')]);
  assert.equal(result.summary.byId,1);assert.equal(result.summary.byName,0);
  assert.deepEqual(result.updates,[{key:'official:1234abcd',duelingbookId:'123',section:'main'}]);
});
test('direct custom IDs win over unrelated cards with the same visible name',()=>{
  const result=plan([custom('42','Same name'),official(undefined,'Same name')],[row('42','Renamed custom')]);
  assert.equal(result.summary.byId,1);assert.equal(result.updates[0].key,'42');
});
test('name matching normalizes whitespace, case and canonically equivalent Unicode',()=>{
  const result=plan([official(undefined,"Caf\u00e9 Dragon")],[row('123','  CAFE\u0301\n\tDragon  ')]);
  assert.equal(result.summary.byName,1);assert.equal(result.updates[0].duelingbookId,'123');
});
test('official names are never matched fuzzily across punctuation changes',()=>{
  const result=plan([official(undefined,'Blue-Eyes')],[row('123','Blue Eyes')]);
  assert.equal(result.summary.unmatched,1);assert.deepEqual(result.updates,[]);
});
test('duplicate official names are reported without selecting an artwork variant',()=>{
  const result=plan([official(),official('official:abcdef12')],[row('123','Official Card')]);
  assert.equal(result.summary.ambiguous,1);assert.deepEqual(result.updates,[]);
});
test('a custom/official name collision is ambiguous without a known ID',()=>{
  const result=plan([custom('42','Shared'),official(undefined,'Shared')],[row('123','Shared')]);
  assert.equal(result.summary.ambiguous,1);assert.deepEqual(result.updates,[]);
});
test('existing bindings cannot be replaced through name matching',()=>{
  const result=plan([official(undefined,'Official Card','123')],[row('456','Official Card')]);
  assert.equal(result.summary.conflict,1);assert.deepEqual(result.updates,[]);
});
test('a custom ID cannot be replaced by a same-name XML row',()=>{
  const result=plan([custom()],[row('123','Custom Card')]);
  assert.equal(result.summary.conflict,1);assert.deepEqual(result.updates,[]);
});
test('two XML IDs for one unbound name conflict regardless of file order',()=>{
  const rows=[row('123','Official Card'),row('456','Official Card')];
  for (const input of [rows,[...rows].reverse()]) {
    const result=plan([official()],input);
    assert.equal(result.summary.conflict,2);assert.deepEqual(result.updates,[]);
  }
});
test('authoritative known-ID matches remain valid when another XML ID reuses the name',()=>{
  const result=plan([official(undefined,'Official Card','123')],[row('456','Official Card'),row('123','Official Card')]);
  assert.equal(result.summary.byId,1);assert.equal(result.summary.conflict,1);
  assert.equal(result.updates.length,1);assert.equal(result.updates[0].duelingbookId,'123');
});
test('an XML ID bound to multiple Cube records is a conflict even with one exact name',()=>{
  const result=plan([official(undefined,'First','123'),official('official:abcdef12','Second','123')],[row('123','First')]);
  assert.equal(result.summary.conflict,1);assert.deepEqual(result.updates,[]);
});
test('contradictory custom local and saved IDs are never used',()=>{
  const broken={...custom(),duelingbookId:'43'};
  const result=plan([broken],[row('42','Custom Card'),row('43','Custom Card')]);
  assert.equal(result.summary.conflict,2);assert.deepEqual(result.updates,[]);
});
test('invalid existing saved IDs are reported instead of silently replaced',()=>{
  const result=plan([official(undefined,'Official Card','not-an-id')],[row('123','Official Card')]);
  assert.equal(result.summary.conflict,1);assert.deepEqual(result.updates,[]);
});
test('duplicate XML copies in one section produce one match and keep Cube quantities',()=>{
  const card=official();
  const result=plan([card],[row('123',card.name),row('123',card.name),row('123',card.name)]);
  assert.equal(result.summary.entries,3);assert.equal(result.summary.byName,1);assert.equal(result.results[0].occurrences,3);
  assert.equal(result.updates.length,1);assert.equal(card.copies,7);
});
test('one ID appearing in Main and Side keeps its existing single Cube section',()=>{
  const card={...custom(),duelingbookId:''};
  for (const input of [[row('42',card.name),row('42',card.name,'side')],[row('42',card.name,'side'),row('42',card.name)]]) {
    const result=plan([card],input);
    assert.equal(result.summary.byId,1);assert.equal(result.summary.multiSection,1);
    assert.deepEqual(result.updates,[{key:'42',duelingbookId:'42'}]);
    assert.deepEqual(result.results[0].sections,['main','side']);
  }
});
test('conflicting XML names for one ID are skipped as a group',()=>{
  const result=plan([official(undefined,'First','123')],[row('123','First'),row('123','Second')]);
  assert.equal(result.summary.conflict,1);assert.equal(result.results[0].occurrences,2);assert.deepEqual(result.updates,[]);
});
test('a conflicting name-attribute row prevents partial annotation of that ID',()=>{
  const result=plan([official()],[row('123','Official Card'),{...row('123','Official Card'),problem:'The XML name attribute and card text disagree.'}]);
  assert.equal(result.summary.conflict,1);assert.deepEqual(result.updates,[]);
});
test('a name used by a conflicting ID group cannot bind a different ID by first occurrence',()=>{
  const result=plan([official()],[row('123','Official Card'),row('456','Official Card'),row('456','Different name')]);
  assert.equal(result.summary.conflict,2);assert.deepEqual(result.updates,[]);
});
for (const id of ['', '0', '-1', '1.5', '1e2', 'official:1234abcd', 9007199254740992]) {
  test(`invalid XML ID ${JSON.stringify(id)} cannot annotate a Cube card`,()=>{
    const result=plan([official()],[row(id,'Official Card')]);
    assert.equal(result.summary.invalid,1);assert.deepEqual(result.updates,[]);
  });
}
test('numeric IDs normalize leading zeros without losing large-ID precision',()=>{
  const large='900719925474099312345';
  const result=plan([official(undefined,'Official Card',large)],[row('000'+large,'Different name')]);
  assert.equal(result.summary.byId,1);assert.equal(result.updates[0].duelingbookId,large);
});
test('a known ID can match with no name; unknown nameless IDs are unmatched',()=>{
  const result=plan([custom()],[row('42',''),row('123','')]);
  assert.equal(result.summary.byId,1);assert.equal(result.summary.unmatched,1);
});
test('legacy numeric custom and hashed official records can match without an origin field',()=>{
  const a=custom();delete a.origin;
  const b=official();delete b.origin;
  const result=plan([a,b],[row('42','Renamed'),row('123','Official Card')]);
  assert.equal(result.summary.byId,1);assert.equal(result.summary.byName,1);
});
test('planning preserves input objects and is repeatable once updates are applied',()=>{
  const cards=[official(),custom()];const before=structuredClone(cards);
  Object.freeze(cards[0]);Object.freeze(cards[1]);
  const rows=[row('123','Official Card'),row('42','Custom Card','side')];
  const result=plan(cards,rows);
  assert.deepEqual(cards,before);
  const next=Object.fromEntries(before.map(c=>[c.id,c]));
  for(const update of result.updates) {
    next[update.key].duelingbookId=update.duelingbookId;
    if(update.section) next[update.key].section=update.section;
  }
  const repeated=planMatches(next,rows);
  assert.deepEqual(repeated.updates,[]);assert.equal(repeated.summary.byId,2);
  assert.deepEqual(next['official:1234abcd'].notes,{keep:true});assert.equal(next['official:1234abcd'].copies,7);
});
test('independent matches still succeed alongside unmatched, ambiguous and invalid entries',()=>{
  const cards=[custom(),official(undefined,'Shared'),official('official:abcdef12','Shared')];
  const result=plan(cards,[row('42','Custom Card'),row('123','Unknown'),row('456','Shared'),row('','Invalid')]);
  assert.equal(result.summary.byId,1);assert.equal(result.summary.unmatched,1);assert.equal(result.summary.ambiguous,1);assert.equal(result.summary.invalid,1);
  assert.deepEqual(result.updates,[{key:'42',duelingbookId:'42',section:'main'}]);
});
