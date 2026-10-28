const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const source=buildSync({entryPoints:['src/metadata-authblk.ts'],bundle:true,write:false,platform:'node',format:'cjs',target:'es2022'}).outputFiles[0].text;
const compiled={exports:{}};new Function('module','exports',source)(compiled,compiled.exports);
const {buildMetadataAuthblk}=compiled.exports;
const p=text=>({type:'p',children:[{text}]}),entry=(role,id,text,props={})=>({type:'metadata_entry',role,id,...props,children:[p(text)]}),block=(id,...children)=>({type:'document_metadata',id,children});
const render=nodes=>nodes.map(node=>typeof node.text==='string'?node.text:(node.children||[]).map(child=>typeof child.text==='string'?child.text:render([child])).join('')).join('\n\n');

test('native authblk output shares affiliations and thanks while retaining free and unreferenced notes',()=>{
  const metadata=block('m',entry('title','title','Title',{noteIds:['funding']}),entry('author','alice','Alice',{affiliationIds:['a','b'],noteIds:['equal','email']}),entry('author','bob','Bob',{affiliationIds:['a'],noteIds:['equal']}),entry('affiliation','a','Institute A'),entry('affiliation','b','Institute B'),entry('note','funding','Funding note'),entry('note','equal','Equal contribution'),entry('note','email','Correspondence'),entry('note','unused','Other descriptive information'),entry('text','text','Free text'),p('Ordinary paragraph'));
  const before=JSON.stringify(metadata),output=buildMetadataAuthblk([metadata],render);
  assert.equal(output.packages,'\\usepackage[noblocks]{authblk}\n');
  assert.match(output.setup,/\\title\{Title\\thanks\{Funding note\}\}/);
  assert.match(output.setup,/\\author\[1,2\]\{Alice\\thanks\{Equal contribution\}\\thanks\{Correspondence\}\}/);
  assert.match(output.setup,/\\author\[1\]\{Bob\\protect\\footnotemark\[2\]\}/);
  assert.equal((output.setup.match(/Equal contribution/g)||[]).length,1);assert.match(output.setup,/\\affil\[1\]\{Institute A\}/);assert.match(output.setup,/\\affil\[2\]\{Institute B\}/);
  assert.equal(output.bodyByBlock.get(metadata),'\\maketitle\n\nOther descriptive information\n\nFree text\n\nOrdinary paragraph\n\n');
  assert.equal(JSON.stringify(metadata),before);
});

test('authors without affiliations all survive, and a partially unaffiliated author gets no inherited marker',()=>{
  const none=block('none',entry('author','a','Alice'),entry('author','b','Bob'));
  const noAffiliations=buildMetadataAuthblk([none],render);assert.match(noAffiliations.setup,/\\author\{Alice\\and\nBob\}/);assert.doesNotMatch(noAffiliations.setup,/\\affil/);
  const mixed=block('mixed',entry('author','a','Alice',{affiliationIds:['lab']}),entry('author','b','Bob'),entry('affiliation','lab','Institute'));
  const withAffiliation=buildMetadataAuthblk([mixed],render);assert.match(withAffiliation.setup,/\\author\[1\]\{Alice\}/);assert.match(withAffiliation.setup,/\\author\[ \]\{Bob\}/);assert.doesNotMatch(withAffiliation.setup,/\\author\[\]\{Bob/);
});

test('more than nine notes use native titling bracketed numeric marks for the whole group',()=>{
  const notes=Array.from({length:10},(_,i)=>entry('note','n'+i,'Note '+i));
  const metadata=block('many',entry('author','a','Alice',{noteIds:notes.map(note=>note.id)}),entry('author','b','Bob',{noteIds:['n0','n9']}),...notes);
  const output=buildMetadataAuthblk([metadata],render);
  assert.equal(output.packages,'\\usepackage{titling}\n\\usepackage[noblocks]{authblk}\n');
  assert.match(output.setup,/\\thanksmarkseries\{arabic\}/);assert.match(output.setup,/\\thanksheadextra\{\[\}\{\]\}/);assert.match(output.setup,/\\thanksfootextra\{\[\}\{\]\}/);
  assert.match(output.setup,/Bob\\protect\\footnotemark\[1\]\\thanksgap\{1em\}\\protect\\footnotemark\[10\]/);assert.equal((output.setup.match(/\\thanks\{/g)||[]).length,10);
});

test('several metadata blocks retain one title while keeping duplicate title content at its original position',()=>{
  const first=block('first',entry('title','t1','First title'),entry('author','a1','Alice',{affiliationIds:['lab1'],noteIds:['note1']}),entry('affiliation','lab1','Institute A'),entry('note','note1','First note'),p('First block extra'));
  const second=block('second',entry('title','t2','Second title',{noteIds:['note2']}),entry('author','a2','Bob',{affiliationIds:['lab2'],noteIds:['note2']}),entry('affiliation','lab2','Institute B'),entry('note','note2','Second note'),p('Second block extra'));
  const output=buildMetadataAuthblk([first,second],render);
  assert.match(output.setup,/\\title\{First title\}/);assert.doesNotMatch(output.setup,/Second title/);assert.match(output.setup,/Alice\\thanks\{First note\}/);assert.match(output.setup,/Bob\\thanks\{Second note\}/);
  assert.match(output.setup,/\\affil\[2\]\{Institute B\}/);assert.match(output.setup,/\\author\[2\]\{Bob/);
  assert.equal([...output.bodyByBlock.values()].join('').split('\\maketitle').length-1,1);assert.equal(output.bodyByBlock.get(second),'Second title\n\nSecond block extra\n\n');
  assert.equal(second.children[0].role,'title','export repairs a copy and never changes the source document');
});

test('free-only metadata does not introduce native title commands or discard any content',()=>{
  const metadata=block('free',p('Original free title'),entry('text','text','Contributions'),entry('note','note','Unreferenced note'),entry('affiliation','lab','Institute without authors'));
  const output=buildMetadataAuthblk([metadata],render);assert.equal(output.packages,'');assert.equal(output.setup,'');assert.equal(output.bodyByBlock.get(metadata),'Institute without authors\n\nUnreferenced note\n\nOriginal free title\n\nContributions\n\n');
});

test('broken, cross-block, wrong-role and ambiguous relations fail accurately rather than pointing elsewhere',()=>{
  assert.throws(()=>buildMetadataAuthblk([block('m',entry('author','a','A',{noteIds:['missing']}))],render),/Missing metadata note reference: missing/);
  assert.throws(()=>buildMetadataAuthblk([block('m',entry('author','a','A',{affiliationIds:['note']}),entry('note','note','Not an affiliation'))],render),/Missing metadata affiliation reference: note/);
  assert.throws(()=>buildMetadataAuthblk([block('one',entry('author','a','A',{noteIds:['other']})),block('two',entry('note','other','Other block note'))],render),/Missing metadata note reference: other/);
  assert.throws(()=>buildMetadataAuthblk([block('m',entry('author','a','A'),entry('note','same','N1'),entry('note','same','N2'))],render),/Duplicate metadata entry ID: same/);
});

test('switching roles preserves dormant association fields without activating or validating them',()=>{
  const metadata=block('m',entry('title','title','Title'),entry('text','was-author','Descriptive prose',{affiliationIds:['missing-affiliation'],noteIds:['missing-note']}));
  const output=buildMetadataAuthblk([metadata],render);assert.equal(output.bodyByBlock.get(metadata),'\\maketitle\n\nDescriptive prose\n\n');assert.doesNotMatch(output.setup,/\\thanks\{|\\affil\[/);
});

test('active references to empty affiliations and notes report unfinished targets instead of dropping markers',()=>{
  assert.throws(()=>buildMetadataAuthblk([block('m',entry('author','author','Alice',{affiliationIds:['empty']}),entry('affiliation','empty','   '))],render),/Empty metadata affiliation reference: empty/);
  assert.throws(()=>buildMetadataAuthblk([block('m',entry('title','title','A title',{noteIds:['empty']}),entry('note','empty',''))],render),/Empty metadata note reference: empty/);
  const emptyOwner=block('m',entry('author','author','',{affiliationIds:['missing'],noteIds:['missing']}));
  assert.doesNotThrow(()=>buildMetadataAuthblk([emptyOwner],render),'an unfinished blank author does not activate its associations');
});

test('native titling mark gaps prevent zero-width title and unaffiliated author notes from overlapping',()=>{
  const metadata=block('m',entry('title','title','Title',{noteIds:['one','two']}),entry('author','alice','Alice',{noteIds:['one','two']}),entry('note','one','First note'),entry('note','two','Second note'));
  const output=buildMetadataAuthblk([metadata],render);assert.match(output.packages,/\\usepackage\{titling\}/);
  assert.match(output.setup,/\\title\{Title\\thanks\{First note\}\\thanksgap\{1em\}\\thanks\{Second note\}\}/);
  assert.match(output.setup,/Alice\\protect\\footnotemark\[1\]\\thanksgap\{1em\}\\protect\\footnotemark\[2\]/);
});

test('author reordering updates native first-use thanks and shared markers without changing note IDs or residual body order',()=>{
  const title=entry('title','title','Paper',{noteIds:['funding']}),alice=entry('author','alice','Alice',{affiliationIds:['lab'],noteIds:['alice-note','shared']}),bob=entry('author','bob','Bob',{affiliationIds:['lab'],noteIds:['shared','bob-note']}),free=p('Free paragraph between authors');
  const metadata=block('m',title,alice,free,bob,entry('affiliation','lab','Institute A'),entry('note','shared','Shared contribution'),entry('note','alice-note','Alice note'),entry('note','bob-note','Bob note'),entry('note','funding','Funding'),entry('note','unused','Unreferenced note'),p('Last free paragraph'));
  const before=JSON.stringify(metadata),first=buildMetadataAuthblk([metadata],render),reordered={...metadata,children:[title,bob,free,alice,...metadata.children.slice(4)]},second=buildMetadataAuthblk([reordered],render);
  assert.match(first.setup,/Alice\\thanks\{Alice note\}\\thanks\{Shared contribution\}/);assert.match(first.setup,/Bob\\protect\\footnotemark\[3\]\\thanks\{Bob note\}/);
  assert.match(second.setup,/Bob\\thanks\{Shared contribution\}\\thanks\{Bob note\}/);assert.match(second.setup,/Alice\\protect\\footnotemark\[2\]\\thanks\{Alice note\}/,'displayed note markers use their derived numeric order while stored noteIds remain unchanged');
  assert.ok(second.setup.indexOf('\\author[1]{Bob')<second.setup.indexOf('\\author[1]{Alice'));
  assert.equal((second.setup.match(/Shared contribution/g)||[]).length,1);assert.equal(first.bodyByBlock.get(metadata),second.bodyByBlock.get(reordered));
  assert.equal(second.bodyByBlock.get(reordered),'\\maketitle\n\nUnreferenced note\n\nFree paragraph between authors\n\nLast free paragraph\n\n');
  assert.deepEqual(alice.noteIds,['alice-note','shared']);assert.deepEqual(bob.noteIds,['shared','bob-note']);assert.equal(JSON.stringify(metadata),before);
});

test('affiliation reorder derives ascending native markers while retaining every original association ID',()=>{
  const alice=entry('author','alice','Alice',{affiliationIds:['lab2','lab1'],noteIds:['shared']}),bob=entry('author','bob','Bob',{affiliationIds:['lab1'],noteIds:['shared']}),lab1=entry('affiliation','lab1','Institute A'),lab2=entry('affiliation','lab2','Institute B'),free=p('Free content stays between affiliation entries'),note=entry('note','shared','Shared contribution');
  const metadata=block('m',alice,bob,lab1,free,lab2,note),before=JSON.stringify(metadata),first=buildMetadataAuthblk([metadata],render);
  const reordered={...metadata,children:[alice,bob,lab2,free,lab1,note]},second=buildMetadataAuthblk([reordered],render);
  assert.match(first.setup,/\\author\[1,2\]\{Alice/,'marker order follows displayed affiliation numbers, rather than the stored ID array');
  assert.match(second.setup,/\\author\[1,2\]\{Alice/);assert.match(first.setup,/\\author\[1\]\{Bob/);assert.match(second.setup,/\\author\[2\]\{Bob/);
  assert.match(first.setup,/\\affil\[1\]\{Institute A\}[\s\S]*\\affil\[2\]\{Institute B\}/);assert.match(second.setup,/\\affil\[1\]\{Institute B\}[\s\S]*\\affil\[2\]\{Institute A\}/);
  assert.equal(first.bodyByBlock.get(metadata),second.bodyByBlock.get(reordered));assert.equal(reordered.children[3],free);assert.equal(reordered.children[5],note);
  assert.deepEqual(alice.affiliationIds,['lab2','lab1']);assert.deepEqual(bob.affiliationIds,['lab1']);assert.equal(JSON.stringify(metadata),before);
});

test('an affiliation after notes exports in the native affiliation group and keeps shared refs plus free text',()=>{
  const title=entry('title','title','Paper'),alice=entry('author','alice','Alice',{affiliationIds:['aff3','aff1'],noteIds:['shared']}),bob=entry('author','bob','Bob',{affiliationIds:['aff2','aff3'],noteIds:['shared']}),aff1=entry('affiliation','aff1','Institute 1'),aff2=entry('affiliation','aff2','Institute 2'),aff3=entry('affiliation','aff3','Institute 3'),note=entry('note','shared','Shared contribution'),unused=entry('note','unused','An unreferenced explanation'),textEntry=entry('text','text','First free text'),free=p('Second free paragraph');
  const metadata=block('m',title,alice,bob,aff1,aff2,note,textEntry,aff3,unused,free),before=JSON.stringify(metadata),output=buildMetadataAuthblk([metadata],render);
  assert.match(output.setup,/\\author\[1,3\]\{Alice/);assert.match(output.setup,/\\author\[2,3\]\{Bob\\protect\\footnotemark\[1\]/);
  assert.match(output.setup,/\\affil\[1\]\{Institute 1\}[\s\S]*\\affil\[2\]\{Institute 2\}[\s\S]*\\affil\[3\]\{Institute 3\}/);
  assert.equal((output.setup.match(/Shared contribution/g)||[]).length,1);assert.equal(output.bodyByBlock.get(metadata),'\\maketitle\n\nAn unreferenced explanation\n\nFirst free text\n\nSecond free paragraph\n\n');
  assert.deepEqual(alice.affiliationIds,['aff3','aff1']);assert.deepEqual(bob.affiliationIds,['aff2','aff3']);assert.equal(JSON.stringify(metadata),before);
});

test('metadata-to-body boundary ends the final free-text paragraph in the complete native export',()=>{
  const nativeSource=buildSync({entryPoints:['src/latex-document.ts'],bundle:true,write:false,platform:'node',format:'cjs',target:'es2022'}).outputFiles[0].text;
  const native={exports:{}};new Function('module','exports','require',nativeSource)(native,native.exports,require);
  const metadata=block('paper',entry('title','title','Paper'),entry('author','alice','Alice',{noteIds:['shared']}),entry('author','bob','Bob',{noteIds:['shared']}),entry('note','shared','Equal contribution'),entry('text','orcid','Nancy Makri — ORCID: 0000-0002-3310-7328'));
  const abstract={type:'p',children:[{text:'ABSTRACT: ',bold:true},{text:'Body abstract.'}]};
  for(const source of [metadata,block('free-only',entry('text','orcid','Nancy Makri — ORCID: 0000-0002-3310-7328'))]){
    const latex=native.exports.latexDocument([source,abstract],[],'simple');
    assert.match(latex,/Nancy Makri — ORCID: 0000-0002-3310-7328\n\n\\textbf\{ABSTRACT: \}Body abstract\./,'a newline alone must not merge metadata and body into one TeX paragraph');
    if(source===metadata){
      assert.equal((latex.match(/\\maketitle/g)||[]).length,1);
      assert.match(latex,/Alice\\thanks\{Equal contribution\}/);
      assert.match(latex,/Bob\\protect\\footnotemark\[1\]/);
    }
  }
});
