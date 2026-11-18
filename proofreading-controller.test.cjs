const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
let api,window,directory,restoreGlobals;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){for(let i=0;i<300;i++){if(predicate())return;await wait(5);}throw Error('Timed out: '+label);}
const p=(id,...children)=>({id,type:'p',children:children.length?children:[{text:'teh example'}]});
const correction=(text,original='teh',replacement='the')=>({start:text.indexOf(original),end:text.indexOf(original)+original.length,original,replacements:[replacement],message:'Spelling',kind:'spelling'});
const paragraphText=f=>api.projectProofreadingText(f.editor,f.editor.children[0],[0]).text;
async function currentMarks(f){
  await until(()=>{
    const rows=f.controller.getSnapshot().issues,projection=api.projectProofreadingText(f.editor,f.editor.children[0],[0]);
    return f.marks.size===rows.length&&rows.every(row=>JSON.stringify(f.marks.get(row.id)?.range)===JSON.stringify(api.proofreadingRange(projection,row.start,row.end)));
  },'all retained underlines mapped to their current source ranges');
  const text=paragraphText(f);for(const row of f.controller.getSnapshot().issues)assert.equal(text.slice(row.start,row.end),row.original);
}
async function currentDocumentMarks(f){
  await until(()=>{
    const rows=f.controller.getSnapshot().issues;
    return f.marks.size===rows.length&&rows.every(row=>{
      const mark=f.marks.get(row.id),index=mark?.range.anchor.path[0],node=index===undefined?undefined:f.editor.children[index];if(!node)return false;
      const projection=api.projectProofreadingText(f.editor,node,[index]);
      return projection.text.slice(row.start,row.end)===row.original&&JSON.stringify(mark.range)===JSON.stringify(api.proofreadingRange(projection,row.start,row.end));
    });
  },'retained underlines reassigned to the correct current paragraphs');
}
function deleteFlat(f,start,end){f.editor.tf.select({anchor:{path:[0,0],offset:start},focus:{path:[0,0],offset:end}});f.editor.tf.delete();}
const threeIssues=text=>[
  {...correction(text,'speling','spelling'),message:'First spelling issue'},
  {...correction(text,'are','is'),kind:'grammar',message:'Subject–verb agreement'},
  {...correction(text,'seperate','separate'),message:'Last spelling issue'},
];

test.before(async()=>{
  const {Window}=await import('happy-dom');window=new Window({url:'http://localhost/'});
  const names=['window','document','navigator','localStorage','sessionStorage','location','Node','Element','HTMLElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','CompositionEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','Selection','CSS'];
  const descriptors=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?window:window[name]});
  restoreGlobals=()=>{for(const [name,descriptor] of descriptors)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];};
  directory=fs.mkdtempSync(path.resolve('diagnostics','proofreading-controller-test-'));
  await require('esbuild').build({stdin:{contents:`export * from './src/proofreading-controller';export * from './src/proofreading-settings';export {ProofreadingServiceError} from './src/proofreading-provider';export {checkLanguageTool} from './src/languagetool-provider';export {createPlateEditor,createPlatePlugin,ParagraphPlugin} from 'platejs/react';export {NodeApi} from 'platejs';`,resolveDir:__dirname,loader:'ts'},bundle:true,platform:'browser',format:'esm',splitting:true,outdir:directory,outExtension:{'.js':'.mjs'},entryNames:'entry',conditions:['production'],define:{'process.env.NODE_ENV':'"production"'}});
  api=await import(pathToFileURL(path.join(directory,'entry.mjs')).href);
});
test.after(async()=>{await window?.happyDOM.close();restoreGlobals?.();if(directory)fs.rmSync(directory,{recursive:true,force:true});});

function fixture(value=[p('one')],options={}){
  assert.equal(api.saveProofreadingSettings({enabled:options.enabled!==false,endpoint:'http://localhost:1234/v1',apiKey:'',model:'synthetic-test-model',rememberKey:false}),true);
  const Atom=api.createPlatePlugin({key:'test_math_atom',node:{isElement:true,isInline:true,isVoid:true}});
  const editor=api.createPlateEditor({plugins:[api.ParagraphPlugin,Atom],value:structuredClone(value),nodeId:options.nodeId??false});
  // No React surface is mounted: focus is outside this controller test's
  // content/operation contract. All selection and history transforms stay real.
  editor.tf.focus=()=>{};
  const mount=window.document.createElement('div');window.document.body.append(mount);
  const marks=new Map(),paintCalls=[];
  const highlights={set(id,range,kind){marks.set(id,{range:structuredClone(range),kind});paintCalls.push({id,range:structuredClone(range)});},remove(id){marks.delete(id);},clear(){marks.clear();},destroy(){marks.clear();}};
  const calls=[];
  const check=(text,connection,signal)=>new Promise((resolve,reject)=>{calls.push({text,connection,signal,resolve,reject});});
  let readOnly=false;
  const controller=new api.ProofreadingController(editor,mount,()=>readOnly,{check,highlights});
  const operations=[];const originalOnChange=editor.onChange.bind(editor);
  editor.onChange=event=>{const pending=editor.operations.slice();operations.push(...pending);originalOnChange(event);if(options.notify!==false)controller.changed(pending);};
  editor.tf.select({path:[0,0],offset:0});
  return {editor,controller,calls,mount,marks,paintCalls,operations,highlights,setReadOnly:value=>{readOnly=value;},close(){controller.destroy();mount.remove();}};
}

test('projection maps marked leaves and protects inline mathematical atoms and code',()=>{
  const f=fixture([p('p',{text:'A ',bold:true},{text:'te',italic:true},{text:'h '},{id:'math',type:'test_math_atom',snapshot:{formula:'x^2'},children:[{text:''}]},{text:'code',code:true},{text:' end'})]);
  try{
    const projection=api.projectProofreadingText(f.editor,f.editor.children[0],[0]);
    assert.equal(projection.text,'A teh \uFFFC\uFFFC end');
    assert.deepEqual(api.proofreadingRange(projection,2,5),{anchor:{path:[0,1],offset:0},focus:{path:[0,2],offset:1}});
    assert.equal(api.proofreadingRange(projection,4,9),undefined);
    assert.equal(api.proofreadingRange(projection,6,7),undefined);
  }finally{f.close();}
});

test('editing aborts the paragraph request and invalidates late results without automatically checking again',async()=>{
  const f=fixture();
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'first request');
    f.editor.tf.insertText('!',{at:{path:[0,0],offset:f.editor.children[0].children[0].text.length}});
    await wait(20);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.calls.length,1);
    f.editor.tf.insertText('?',{at:{path:[0,0],offset:f.editor.children[0].children[0].text.length}});await wait(20);
    f.calls[0].resolve([correction(f.calls[0].text)]);await wait(20);
    assert.equal(f.controller.getSnapshot().issues.length,0);assert.equal(f.controller.getSnapshot().checking,false);assert.equal(f.calls.length,1);
    f.controller.checkCurrent();await until(()=>f.calls.length===2,'explicit updated-paragraph check');
    f.calls[1].resolve([]);await until(()=>f.controller.getSnapshot().checked===1,'new result');
    assert.equal(f.marks.size,0);assert.equal(f.editor.children[0].children[0].text,'teh example!?');
  }finally{f.close();}
});

test('stop, reset, destruction and read-only guards cannot apply a stale response or edit document content',async()=>{
  const f=fixture(),before=structuredClone(f.editor.children);
  try{
    for(const action of ['stop','reset']){
      f.controller.checkCurrent();const count=f.calls.length;await until(()=>f.calls.length>count,action+' request');const current=f.calls.at(-1);
      f.controller[action]();assert.equal(current.signal.aborted,true);current.resolve([correction(current.text)]);await wait(20);
      assert.equal(f.controller.getSnapshot().issues.length,0);assert.equal(f.marks.size,0);assert.deepEqual(f.editor.children,before);
    }
    f.setReadOnly(true);assert.equal(f.controller.checkCurrent(),false);f.controller.checkDocument();await wait(10);assert.deepEqual(f.editor.children,before);
    f.setReadOnly(false);f.controller.checkCurrent();const count=f.calls.length;await until(()=>f.calls.length>count,'request before destruction');const current=f.calls.at(-1);
    f.controller.destroy();current.resolve([correction(current.text)]);await wait(20);assert.equal(f.marks.size,0);assert.deepEqual(f.editor.children,before);
  }finally{f.close();}
});

test('typing inspects only the edited ancestor path in 4000 paragraphs and requires an explicit check',async()=>{
  const f=fixture(Array.from({length:4000},(_,i)=>p('paragraph-'+i,{text:'Text '+i})),{notify:false});
  try{
    await wait(0);f.operations.length=0;
    f.editor.tf.insertText('!',{at:{path:[2000,0],offset:9}});await wait(0);
    const operations=f.operations.slice(),children=f.editor.children;assert.ok(operations.some(operation=>operation.type==='insert_text'));
    let unrelatedReads=0;
    f.editor.children=new Proxy(children,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key)&&key!=='2000')unrelatedReads++;return Reflect.get(target,key,receiver);}});
    try{f.controller.changed(operations);assert.equal(unrelatedReads,0,'ordinary typing must not visit other document blocks');}
    finally{f.editor.children=children;}
    await wait(20);assert.equal(f.calls.length,0);assert.equal(f.controller.getSnapshot().pending,0);
    f.editor.tf.select({path:[2000,0],offset:0});f.controller.checkCurrent();
    await until(()=>f.calls.length===1,'explicit selected paragraph');assert.equal(f.calls[0].text,'Text 2000!');f.calls[0].resolve([]);
    await until(()=>f.controller.getSnapshot().checked===1,'only changed paragraph checked');assert.equal(f.calls.length,1);
    f.operations.length=0;f.editor.tf.insertText('?',{at:{path:[2000,0],offset:10}});await wait(0);
    const checkedChildren=f.editor.children;unrelatedReads=0;
    f.editor.children=new Proxy(checkedChildren,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key)&&key!=='2000')unrelatedReads++;return Reflect.get(target,key,receiver);}});
    try{f.controller.changed(f.operations);assert.equal(unrelatedReads,0,'reconciling an existing checked record must still avoid unrelated paragraphs');}
    finally{f.editor.children=checkedChildren;}
    await wait(20);assert.equal(f.calls.length,1);assert.equal(f.controller.getSnapshot().pending,0);
  }finally{f.close();}
});

test('accepting a correction across formatted leaves preserves surrounding marks, math structure, and undo/redo',async()=>{
  const math={id:'math',type:'test_math_atom',snapshot:{root:{kind:'power',base:'x',exponent:'2'}},children:[{text:''}]};
  const f=fixture([p('one',{text:'Prefix '},{text:'t',bold:true},{text:'eh',italic:true},{text:' and '},math,{text:' tail',underline:true}),p('two',{text:'Untouched',bold:true})]);
  try{
    const before=structuredClone(f.editor.children),other=f.editor.children[1];
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'formatted paragraph');f.calls[0].resolve([correction(f.calls[0].text)]);
    await until(()=>f.controller.getSnapshot().issues.length===1&&f.marks.size===1,'underline');const id=f.controller.getSnapshot().issues[0].id;
    assert.equal(f.controller.apply(id,'invented'),false);f.setReadOnly(true);assert.equal(f.controller.apply(id,'the'),false);f.setReadOnly(false);
    assert.equal(f.controller.apply(id,'the'),true);await wait(0);
    assert.equal(api.projectProofreadingText(f.editor,f.editor.children[0],[0]).text,'Prefix the and \uFFFC tail');
    assert.deepEqual(f.editor.children[0].children.find(node=>node.type==='test_math_atom'),math);assert.equal(f.editor.children[1],other);
    assert.equal(f.editor.children[0].children.find(node=>node.text===' tail').underline,true);
    assert.equal(f.editor.children[0].children.find(node=>node.text==='t').bold,true,'the unchanged prefix keeps its mark');
    assert.equal(f.editor.children[0].children.find(node=>node.text==='he').italic,true,'the changed suffix uses its own leaf formatting');
    const corrected=structuredClone(f.editor.children);f.editor.tf.undo();await wait(0);assert.deepEqual(f.editor.children,before);
    f.editor.tf.redo();await wait(0);assert.deepEqual(f.editor.children,corrected);
    await wait(20);assert.equal(f.calls.length,1,'accepting, undoing and redoing a correction must not send further requests');
  }finally{f.close();}
});

async function languageToolResult(text,matches){
  const previous=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(JSON.stringify({matches}),{status:200,headers:{'Content-Type':'application/json'}});
    return await api.checkLanguageTool(text,{...api.readProofreadingSettings(),provider:'languagetool'},new AbortController().signal);
  }finally{globalThis.fetch=previous;}
}
const ltMatch=(text,original,replacement,message,kind='grammar')=>({offset:text.indexOf(original),length:original.length,message,replacements:[{value:replacement}],rule:{issueType:kind,id:message}});

test('a LanguageTool punctuation insertion preserves the anchor formatting and an overlapping untouched spelling suggestion',async()=>{
  const f=fixture([p('one',{text:'t',bold:true},{text:'eh',italic:true},{text:' world.'})]);
  try{
    const before=structuredClone(f.editor.children);f.controller.checkCurrent();await until(()=>f.calls.length===1,'punctuation check');
    const text=f.calls[0].text;f.calls[0].resolve(await languageToolResult(text,[ltMatch(text,'teh','the','Spelling','misspelling'),
      {offset:3,length:0,message:'Missing comma',replacements:[{value:','}],rule:{issueType:'grammar',id:'COMMA'}}]));
    await until(()=>f.controller.getSnapshot().issues.length===2,'punctuation and spelling diagnostics');
    const spelling=f.controller.getSnapshot().issues.find(row=>row.kind==='spelling'),comma=f.controller.getSnapshot().issues.find(row=>row.message==='Missing comma');
    assert.equal(comma.original,'teh');assert.deepEqual(comma.replacements,['teh,']);f.operations.length=0;
    assert.equal(f.controller.apply(comma.id,'teh,'),true);await wait(0);
    assert.equal(paragraphText(f),'teh, world.');assert.deepEqual(f.editor.children[0].children,[{text:'t',bold:true},{text:'eh,',italic:true},{text:' world.'}]);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.id),[spelling.id]);await currentMarks(f);
    assert.equal(f.operations.some(operation=>operation.type==='remove_text'),false,'a zero-length correction never deletes the visible anchor');
    assert.deepEqual(f.operations.filter(operation=>operation.type==='insert_text').map(operation=>operation.text),[',']);
    f.editor.tf.undo();await wait(0);assert.deepEqual(f.editor.children,before);assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.id),[spelling.id]);await currentMarks(f);
    f.editor.tf.redo();await wait(0);assert.equal(paragraphText(f),'teh, world.');assert.equal(f.calls.length,1);
  }finally{f.close();}
});

test('minimal corrections support a pure deletion and preserve identical marked prefixes and suffixes',async()=>{
  const f=fixture([p('one',{text:'keep',bold:true},{text:' extra',italic:true},{text:' tail',underline:true},{text:' seperate'})]);
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'deletion check');const text=f.calls[0].text;
    f.calls[0].resolve([correction(text,'keep extra tail','keep tail'),correction(text,'seperate','')]);
    await until(()=>f.controller.getSnapshot().issues.length===2,'deletion suggestions');
    const first=f.controller.getSnapshot().issues[0];assert.equal(f.controller.apply(first.id,'keep tail'),true);await wait(0);
    assert.equal(paragraphText(f),'keep tail seperate');assert.deepEqual(f.editor.children[0].children.slice(0,3),[{text:'keep',bold:true},{text:' ',italic:true},{text:'tail',underline:true}]);
    await currentMarks(f);const last=f.controller.getSnapshot().issues[0];assert.equal(f.controller.apply(last.id,''),true);await wait(0);
    assert.equal(paragraphText(f),'keep tail ');assert.equal(f.controller.getSnapshot().issues.length,0);assert.equal(f.calls.length,1);
  }finally{f.close();}
});

test('minimal correction boundaries never split UTF-16 pairs or combining and joined graphemes',async()=>{
  for(const [original,replacement] of [['😀','😁'],['e\u0301','e\u0300'],['👩‍🔬','👨‍🔬']]){
    const f=fixture([p('one',{text:'A',bold:true},{text:original,italic:true},{text:'Z',underline:true})]);
    try{
      const before=structuredClone(f.editor.children);f.controller.checkCurrent();await until(()=>f.calls.length===1,'grapheme check');
      f.calls[0].resolve([correction(f.calls[0].text,'A'+original+'Z','A'+replacement+'Z')]);await until(()=>f.controller.getSnapshot().issues.length===1,'grapheme suggestion');f.operations.length=0;
      assert.equal(f.controller.apply(f.controller.getSnapshot().issues[0].id,'A'+replacement+'Z'),true);await wait(0);
      assert.deepEqual(f.editor.children[0].children,[{text:'A',bold:true},{text:replacement,italic:true},{text:'Z',underline:true}]);
      assert.deepEqual(f.operations.filter(operation=>operation.type==='remove_text').map(operation=>operation.text),[original]);
      assert.deepEqual(f.operations.filter(operation=>operation.type==='insert_text').map(operation=>operation.text),[replacement]);
      f.editor.tf.undo();await wait(0);assert.deepEqual(f.editor.children,before);assert.equal(f.calls.length,1);
    }finally{f.close();}
  }
});

test('editing a LanguageTool sentence invalidates its other grammar advice but preserves spelling and grammar in another sentence',async()=>{
  const math={id:'math',type:'test_math_atom',snapshot:{formula:'x'},children:[{text:''}]};
  const f=fixture([p('one',{text:'This '},math,{text:' are speling. Those is right.'})]);
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'sentence-context check');const text=f.calls[0].text;
    f.calls[0].resolve(await languageToolResult(text,[ltMatch(text,'This','These','This agreement'),ltMatch(text,'are','is','Verb agreement'),
      ltMatch(text,'speling','spelling','Spelling','misspelling'),{...ltMatch(text,'is','are','Other sentence'),offset:text.lastIndexOf(' is ')+1}]));
    await until(()=>f.controller.getSnapshot().issues.length===4,'all sentence-context suggestions including formula context');
    const rows=f.controller.getSnapshot().issues,thisRow=rows.find(row=>row.message==='This agreement'),verb=rows.find(row=>row.message==='Verb agreement'),other=rows.find(row=>row.message==='Other sentence');
    assert.ok(thisRow.context.original.includes('\uFFFC'),'a protected formula may appear inside a read-only grammar dependency');
    assert.equal(f.controller.apply(verb.id,'is'),true);await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.message),['Spelling','Other sentence']);assert.equal(f.controller.apply(thisRow.id,'These'),false);await currentMarks(f);
    assert.deepEqual(f.editor.children[0].children.find(node=>node.type==='test_math_atom'),math);
    let moved=f.controller.getSnapshot().issues.find(row=>row.id===other.id);assert.equal(moved.context.start,other.context.start-1);assert.equal(moved.context.original,other.context.original);
    f.editor.tf.insertText('Note. ',{at:{path:[0,0],offset:0}});await wait(0);moved=f.controller.getSnapshot().issues.find(row=>row.id===other.id);
    assert.equal(moved.context.start,other.context.start+5);assert.equal(moved.context.original,other.context.original);await currentMarks(f);
    assert.equal(f.controller.apply(other.id,'are'),true);await wait(0);assert.match(paragraphText(f),/Those are right\.$/);assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.message),['Spelling']);assert.equal(f.calls.length,1);
  }finally{f.close();}
});

test('accepting one of three same-paragraph suggestions shifts and preserves the other spelling and grammar suggestions',async()=>{
  const f=fixture([p('one',{text:'A speling example are clear with a seperate note.'})]);
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'three-issue check');f.calls[0].resolve(threeIssues(f.calls[0].text));
    await until(()=>f.controller.getSnapshot().issues.length===3,'three initial issues');await currentMarks(f);
    const first=f.controller.getSnapshot().issues.find(row=>row.original==='speling');
    assert.equal(f.controller.apply(first.id,'spelling'),true);await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['are','seperate']);await currentMarks(f);
    assert.equal(paragraphText(f),'A spelling example are clear with a seperate note.');
    const grammar=f.controller.getSnapshot().issues.find(row=>row.original==='are');
    assert.equal(grammar.start,paragraphText(f).indexOf('are'));assert.equal(f.controller.apply(grammar.id,'is'),true);await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['seperate']);await currentMarks(f);
    const last=f.controller.getSnapshot().issues[0];assert.equal(last.start,paragraphText(f).indexOf('seperate'));assert.equal(f.controller.apply(last.id,'separate'),true);await wait(20);
    assert.equal(paragraphText(f),'A spelling example is clear with a separate note.');assert.equal(f.controller.getSnapshot().issues.length,0);assert.equal(f.marks.size,0);assert.equal(f.calls.length,1);
  }finally{f.close();}
});

test('manual insertion and deletion preserve disjoint suggestions and invalidate only the overlapping issue',async()=>{
  const f=fixture([p('one',{text:'Lead speling are seperate ending.'})]);
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'manual-edit issue check');f.calls[0].resolve(threeIssues(f.calls[0].text));
    await until(()=>f.controller.getSnapshot().issues.length===3,'manual-edit initial issues');const originalStarts=f.controller.getSnapshot().issues.map(row=>row.start);
    f.editor.tf.insertText('New ',{at:{path:[0,0],offset:0}});await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.start),originalStarts.map(start=>start+4));await currentMarks(f);
    const startsBeforeTailDelete=f.controller.getSnapshot().issues.map(row=>row.start),tailStart=paragraphText(f).indexOf(' ending.');
    deleteFlat(f,tailStart,paragraphText(f).length);await wait(0);assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.start),startsBeforeTailDelete);await currentMarks(f);
    const first=paragraphText(f).indexOf('speling');deleteFlat(f,first,first+'speling '.length);await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['are','seperate']);await currentMarks(f);
    const grammar=paragraphText(f).indexOf('are');f.editor.tf.insertText('X',{at:{path:[0,0],offset:grammar+1}});await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['seperate']);await currentMarks(f);
    const last=f.controller.getSnapshot().issues[0];assert.equal(last.start,paragraphText(f).indexOf('seperate'));assert.equal(f.controller.apply(last.id,'separate'),true);await wait(20);
    assert.equal(f.calls.length,1);assert.equal(f.controller.getSnapshot().issues.length,0);assert.equal(paragraphText(f),'New Lead aXre separate');
  }finally{f.close();}
});

test('an invalidated repeated word never migrates to a different occurrence with identical text',async()=>{
  const f=fixture([p('one',{text:'teh middle teh suffix teh'})]);
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'repeated-word check');const text=f.calls[0].text;
    const starts=[0,text.indexOf('teh',3),text.lastIndexOf('teh')];
    f.calls[0].resolve(starts.map((start,index)=>({...correction(text),start,end:start+3,message:['first','middle','last'][index]})));
    await until(()=>f.controller.getSnapshot().issues.length===3,'repeated-word results');const firstId=f.controller.getSnapshot().issues[0].id;
    deleteFlat(f,0,4);await wait(0);assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.message),['middle','last']);assert.equal(f.controller.apply(firstId,'the'),false);await currentMarks(f);
    const middle=paragraphText(f).indexOf('teh');f.editor.tf.insertText('X',{at:{path:[0,0],offset:middle+1}});await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.message),['last']);await currentMarks(f);
    f.editor.tf.insertText('teh ',{at:{path:[0,0],offset:0}});await wait(0);
    const last=f.controller.getSnapshot().issues[0];assert.equal(last.message,'last');assert.equal(last.start,paragraphText(f).lastIndexOf('teh'));await currentMarks(f);
    assert.equal(f.controller.apply(last.id,'the'),true);await wait(20);assert.equal(paragraphText(f),'teh middle tXeh suffix the');assert.equal(f.calls.length,1);
  }finally{f.close();}
});

test('remaining suggestions survive a length-changing formatted correction around a formula and its undo/redo',async()=>{
  const math={id:'math',type:'test_math_atom',snapshot:{root:{kind:'power',base:'x',exponent:'2'}},children:[{text:''}]};
  const f=fixture([p('one',{text:'Prefix '},{text:'spe',bold:true},{text:'ling are ',italic:true},math,{text:' and seperate tail',underline:true}),p('two',{text:'Untouched',bold:true})]);
  try{
    const before=structuredClone(f.editor.children),other=f.editor.children[1];
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'formatted multi-issue check');f.calls[0].resolve(threeIssues(f.calls[0].text));
    await until(()=>f.controller.getSnapshot().issues.length===3,'formatted multi-issue result');await currentMarks(f);
    const first=f.controller.getSnapshot().issues.find(row=>row.original==='speling');assert.equal(f.controller.apply(first.id,'spelling'),true);await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['are','seperate']);await currentMarks(f);
    assert.deepEqual(f.editor.children[0].children.find(node=>node.type==='test_math_atom'),math);assert.equal(f.editor.children[1],other);
    assert.equal(f.editor.children[0].children.find(node=>node.text==='spe').bold,true);
    assert.equal(f.editor.children[0].children.find(node=>node.text?.includes('lling')).italic,true);
    assert.equal(f.editor.children[0].children.find(node=>node.text?.includes('are')).italic,true);
    assert.equal(f.editor.children[0].children.find(node=>node.text?.includes('seperate')).underline,true);
    const corrected=structuredClone(f.editor.children);
    f.editor.tf.undo();await wait(0);assert.deepEqual(f.editor.children,before);
    assert.deepEqual(f.controller.getSnapshot().issues.filter(row=>['are','seperate'].includes(row.original)).map(row=>row.original),['are','seperate']);await currentMarks(f);
    f.editor.tf.redo();await wait(0);assert.deepEqual(f.editor.children,corrected);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['are','seperate']);await currentMarks(f);
    const grammar=f.controller.getSnapshot().issues.find(row=>row.original==='are');assert.equal(f.controller.apply(grammar.id,'is'),true);await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['seperate']);await currentMarks(f);
    assert.equal(paragraphText(f),'Prefix spelling is \uFFFC and seperate tail');assert.deepEqual(f.editor.children[0].children.find(node=>node.type==='test_math_atom'),math);
    assert.equal(f.editor.children[1],other);assert.equal(f.calls.length,1);
  }finally{f.close();}
});

test('adding whitespace at a word boundary keeps its suggestion but extending the word invalidates it',async()=>{
  const f=fixture([p('one',{text:'teh and speling'})]);
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'word-boundary check');const text=f.calls[0].text;
    f.calls[0].resolve([correction(text),correction(text,'speling','spelling')]);await until(()=>f.controller.getSnapshot().issues.length===2,'word-boundary results');
    f.editor.tf.insertText(' ',{at:{path:[0,0],offset:3}});await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['teh','speling']);await currentMarks(f);
    f.editor.tf.insertText('s',{at:{path:[0,0],offset:3}});await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['speling']);await currentMarks(f);
    assert.equal(paragraphText(f),'tehs  and speling');assert.equal(f.calls.length,1);
  }finally{f.close();}
});

test('splitting moves wholly contained issues to their paragraphs and drops a crossing issue; merging keeps the survivors',async()=>{
  const text='speling before bridge after seperate';
  const f=fixture([p('one',{text})],{nodeId:true});
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'split/merge issue check');
    const crossing={...correction(text,'before bridge after','before bridge and after'),kind:'grammar',message:'Crossing issue'};
    f.calls[0].resolve([correction(text,'speling','spelling'),crossing,correction(text,'seperate','separate')]);
    await until(()=>f.controller.getSnapshot().issues.length===3,'split/merge results');const crossingId=f.controller.getSnapshot().issues.find(row=>row.message==='Crossing issue').id;
    const leftId=f.controller.getSnapshot().issues.find(row=>row.original==='speling').id,rightId=f.controller.getSnapshot().issues.find(row=>row.original==='seperate').id;
    const offset=text.indexOf('bridge')+3;
    f.editor.tf.splitNodes({at:{path:[0,0],offset},match:node=>node.type==='p'});await wait(0);
    assert.equal(f.editor.children.length,2);assert.notEqual(f.editor.children[0].id,f.editor.children[1].id);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original).sort(),['seperate','speling']);assert.equal(f.controller.apply(crossingId,crossing.replacements[0]),false);
    await currentDocumentMarks(f);
    const left=f.controller.getSnapshot().issues.find(row=>row.original==='speling'),right=f.controller.getSnapshot().issues.find(row=>row.original==='seperate');
    assert.equal(left.id,leftId);assert.equal(right.id,rightId);
    assert.equal(f.marks.get(left.id).range.anchor.path[0],0);assert.equal(f.marks.get(right.id).range.anchor.path[0],1);
    f.editor.tf.mergeNodes({at:[1]});await wait(0);assert.equal(f.editor.children.length,1);assert.equal(paragraphText(f),text);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original).sort(),['seperate','speling']);await currentDocumentMarks(f);
    assert.equal(f.controller.getSnapshot().issues.find(row=>row.original==='speling').id,leftId);assert.equal(f.controller.getSnapshot().issues.find(row=>row.original==='seperate').id,rightId);
    const last=f.controller.getSnapshot().issues.find(row=>row.original==='seperate');assert.equal(f.controller.apply(last.id,'separate'),true);await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['speling']);await currentMarks(f);assert.equal(f.calls.length,1);
  }finally{f.close();}
});

test('merging independently checked paragraphs combines their remaining suggestions without another request',async()=>{
  const f=fixture([p('one',{text:'speling one '}),p('two',{text:'seperate two'})]);
  try{
    f.controller.checkDocument();await until(()=>f.calls.length===1,'first paragraph check');f.calls[0].resolve([correction(f.calls[0].text,'speling','spelling')]);
    await until(()=>f.calls.length===2,'second paragraph check');f.calls[1].resolve([correction(f.calls[1].text,'seperate','separate')]);
    await until(()=>f.controller.getSnapshot().issues.length===2,'two independent checked results');await currentDocumentMarks(f);
    f.editor.tf.mergeNodes({at:[1]});await wait(0);assert.equal(paragraphText(f),'speling one seperate two');
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['speling','seperate']);await currentDocumentMarks(f);
    const first=f.controller.getSnapshot().issues.find(row=>row.original==='speling');assert.equal(f.controller.apply(first.id,'spelling'),true);await wait(0);
    assert.deepEqual(f.controller.getSnapshot().issues.map(row=>row.original),['seperate']);await currentMarks(f);assert.equal(f.calls.length,2);
  }finally{f.close();}
});

test('a new check after splitting cannot reuse the ID of a suggestion retained in the other paragraph',async()=>{
  const f=fixture([p('one',{text:'teh seperate'})],{nodeId:true});
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'initial right-side-only check');
    f.calls[0].resolve([correction(f.calls[0].text,'seperate','separate')]);
    await until(()=>f.controller.getSnapshot().issues.length===1&&f.marks.size===1,'initial right-side suggestion');
    const retainedId=f.controller.getSnapshot().issues[0].id;
    f.editor.tf.splitNodes({at:{path:[0,0],offset:4},match:node=>node.type==='p'});await wait(0);await currentDocumentMarks(f);
    assert.equal(f.controller.getSnapshot().issues[0].id,retainedId);assert.equal(f.marks.get(retainedId).range.anchor.path[0],1);
    f.editor.tf.select({path:[0,0],offset:0});f.controller.checkCurrent();await until(()=>f.calls.length===2,'explicit left-side check');
    assert.equal(f.calls[1].text,'teh ');f.calls[1].resolve([correction(f.calls[1].text)]);
    await until(()=>f.controller.getSnapshot().issues.length===2,'both independently checked suggestions');
    const left=f.controller.getSnapshot().issues.find(row=>row.original==='teh'),right=f.controller.getSnapshot().issues.find(row=>row.original==='seperate');
    assert.notEqual(left.id,right.id);assert.equal(right.id,retainedId);await currentDocumentMarks(f);
    assert.equal(f.marks.size,2);assert.equal(f.marks.get(left.id).range.anchor.path[0],0);assert.equal(f.marks.get(right.id).range.anchor.path[0],1);
    assert.equal(f.controller.apply(left.id,'the'),true);await wait(0);
    assert.equal(f.editor.children[0].children[0].text,'the ');assert.equal(f.editor.children[1].children[0].text,'seperate');
    assert.equal(f.controller.apply(right.id,'separate'),true);await wait(20);
    assert.equal(f.editor.children[1].children[0].text,'separate');assert.equal(f.controller.getSnapshot().issues.length,0);assert.equal(f.marks.size,0);assert.equal(f.calls.length,2);
  }finally{f.close();}
});

test('inserting before ID-less paragraphs preserves all original queued checks without checking the inserted paragraph',async()=>{
  const paragraph=text=>({type:'p',children:[{text}]});
  const f=fixture(['First teh','Second teh','Third teh'].map(paragraph),{nodeId:false});
  try{
    assert.ok(f.editor.children.every(node=>node.id===undefined));
    f.controller.checkDocument();await until(()=>f.calls.length===1,'first ID-less paragraph in flight');assert.equal(f.calls[0].text,'First teh');
    f.editor.tf.insertNodes(paragraph('Inserted teh'),{at:[0]});await wait(20);
    assert.ok(f.editor.children.every(node=>node.id===undefined));assert.equal(f.calls[0].signal.aborted,false);assert.equal(f.calls.length,1);
    f.calls[0].resolve([correction(f.calls[0].text)]);await until(()=>f.calls.length===2,'second original ID-less paragraph');
    assert.equal(f.calls[1].text,'Second teh');f.calls[1].resolve([correction(f.calls[1].text)]);
    await until(()=>f.calls.length===3,'third original ID-less paragraph');assert.equal(f.calls[2].text,'Third teh');f.calls[2].resolve([correction(f.calls[2].text)]);
    await until(()=>f.controller.getSnapshot().checked===3&&!f.controller.getSnapshot().checking,'all original ID-less paragraphs completed');await currentDocumentMarks(f);
    assert.equal(f.controller.getSnapshot().pending,0);assert.equal(f.controller.getSnapshot().issues.length,3);assert.equal(f.marks.size,3);
    assert.deepEqual([...f.marks.values()].map(mark=>mark.range.anchor.path[0]).sort(),[1,2,3]);
    await wait(20);assert.deepEqual(f.calls.map(call=>call.text),['First teh','Second teh','Third teh']);assert.equal(f.editor.children[0].children[0].text,'Inserted teh');
  }finally{f.close();}
});

test('a manual recheck after formatting reuses cached text without a second request',async()=>{
  const f=fixture();
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'initial check');f.calls[0].resolve([correction(f.calls[0].text)]);
    await until(()=>f.controller.getSnapshot().checked===1&&f.marks.size===1,'initial results');
    f.editor.tf.setNodes({bold:true},{at:[0,0]});await wait(30);
    assert.equal(f.calls.length,1);f.controller.checkCurrent();await until(()=>f.controller.getSnapshot().checked===1&&f.marks.size===1,'cached explicit recheck');
    assert.equal(f.calls.length,1);assert.equal(f.controller.getSnapshot().checked,1);assert.equal(f.controller.getSnapshot().issues.length,1);
    assert.equal(f.marks.size,1);assert.deepEqual([...f.marks.values()][0].range,{anchor:{path:[0,0],offset:0},focus:{path:[0,0],offset:3}});
  }finally{f.close();}
});

test('moving a checked paragraph relocates its underline without dropping suggestions or requesting unchanged neighbors',async()=>{
  const f=fixture([p('one'),p('two',{text:'Second paragraph'}),p('three',{text:'Third paragraph'})]);
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'initial moved paragraph check');f.calls[0].resolve([correction(f.calls[0].text)]);
    await until(()=>f.marks.size===1,'initial moved paragraph mark');const id=f.controller.getSnapshot().issues[0].id;
    f.editor.tf.moveNodes({at:[0],to:[2]});await wait(40);
    assert.equal(f.editor.children[2].id,'one');assert.equal(f.controller.getSnapshot().issues.length,1);
    assert.equal(f.controller.getSnapshot().issues[0].id,id);
    assert.deepEqual(f.marks.get(id)?.range,{anchor:{path:[2,0],offset:0},focus:{path:[2,0],offset:3}});
    assert.equal(f.calls.length,1,'moving unchanged paragraphs should not queue a neighbor at the old index');
    assert.equal(f.controller.apply(id,'the'),true);await wait(0);
    assert.equal(f.editor.children[2].children[0].text,'the example');assert.equal(f.editor.children[0].children[0].text,'Second paragraph');
  }finally{f.close();}
});

test('deleting a whole paragraph does not send its untouched successor for checking',async()=>{
  const f=fixture([p('one'),p('two',{text:'Remove me'}),p('three',{text:'Untouched successor'})]);
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'initial check before deletion');f.calls[0].resolve([correction(f.calls[0].text)]);
    await until(()=>f.marks.size===1,'initial check before deletion mark');
    f.editor.tf.removeNodes({at:[1]});await wait(40);
    assert.equal(f.calls.length,1);assert.equal(f.editor.children[1].children[0].text,'Untouched successor');assert.equal(f.controller.getSnapshot().issues.length,1);
  }finally{f.close();}
});

test('merging paragraphs invalidates results but only a manual recheck sends the combined text',async()=>{
  const f=fixture([p('one'),p('two',{text:' more'}),p('three',{text:'Untouched successor'})]);
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'initial check before merge');f.calls[0].resolve([]);
    await until(()=>f.controller.getSnapshot().checked===1,'initial checked state before merge');
    f.editor.tf.mergeNodes({at:[1]});await wait(30);assert.equal(f.calls.length,1);
    f.editor.tf.select({path:[0,0],offset:0});f.controller.checkCurrent();await until(()=>f.calls.length>=2,'explicit merged-text check');
    assert.equal(f.calls[1].text,'teh example more');f.calls[1].resolve([]);await wait(30);
    assert.equal(f.calls.length,2);assert.equal(f.editor.children[1].children[0].text,'Untouched successor');
  }finally{f.close();}
});

test('composition alone neither cancels nor duplicates an already explicitly started request',async()=>{
  const f=fixture();
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'pre-composition request');
    f.mount.dispatchEvent(new window.CompositionEvent('compositionstart',{bubbles:true}));assert.equal(f.calls[0].signal.aborted,false);
    f.calls[0].resolve([correction(f.calls[0].text)]);await wait(20);assert.equal(f.calls.length,1);assert.equal(f.marks.size,0);
    f.mount.dispatchEvent(new window.CompositionEvent('compositionend',{bubbles:true}));
    await until(()=>f.marks.size===1,'deferred underline');assert.equal(f.calls.length,1);assert.equal(f.editor.children[0].children[0].text,'teh example');
  }finally{f.close();}
});

test('an explicit manual queue waits for composition to end without creating additional requests',async()=>{
  const f=fixture();
  try{
    f.mount.dispatchEvent(new window.CompositionEvent('compositionstart',{bubbles:true}));f.controller.checkDocument();await wait(20);
    assert.equal(f.calls.length,0);assert.equal(f.controller.getSnapshot().pending,1);
    f.mount.dispatchEvent(new window.CompositionEvent('compositionend',{bubbles:true}));await until(()=>f.calls.length===1,'queued manual check after composition');
    f.calls[0].resolve([]);await until(()=>f.controller.getSnapshot().checked===1,'queued manual check complete');
    await wait(20);assert.equal(f.calls.length,1);
  }finally{f.close();}
});

test('manual document checking skips edited queued and active paragraphs while continuing untouched queued paragraphs',async()=>{
  const f=fixture([p('one'),p('two',{text:'Second paragraph'}),p('three',{text:'Third paragraph'})]);
  try{
    f.controller.checkDocument();await until(()=>f.calls.length===1,'first manually queued paragraph');
    f.editor.tf.insertText('!',{at:{path:[1,0],offset:16}});f.editor.tf.insertText('!',{at:{path:[0,0],offset:11}});
    await until(()=>f.calls.length===2,'untouched manually queued paragraph');
    assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.calls[1].text,'Third paragraph');
    f.calls[0].resolve([correction(f.calls[0].text)]);f.calls[1].resolve([]);await until(()=>!f.controller.getSnapshot().checking,'remaining manual queue complete');
    await wait(20);assert.equal(f.calls.length,2);assert.equal(f.controller.getSnapshot().pending,0);assert.equal(f.controller.getSnapshot().issues.length,0);
  }finally{f.close();}
});

test('typing, pasting, settings, reset and IME never request proofreading even after the former debounce interval',async()=>{
  const f=fixture();
  try{
    f.editor.tf.insertText(' first',{at:{path:[0,0],offset:11}});await wait(0);
    f.editor.tf.insertText(' second',{at:{path:[0,0],offset:17}});await wait(0);
    f.editor.tf.insertNodes(p('pasted',{text:'Pasted sample'}),{at:[1]});await wait(0);
    assert.equal(api.saveProofreadingSettings({enabled:true,endpoint:'http://localhost:1234/v1',apiKey:'',model:'changed-model',rememberKey:false}),true);
    f.controller.reset();f.mount.dispatchEvent(new window.CompositionEvent('compositionstart',{bubbles:true}));
    f.editor.tf.insertText('中文',{at:{path:[0,0],offset:0}});await wait(0);f.mount.dispatchEvent(new window.CompositionEvent('compositionend',{bubbles:true}));
    await wait(1600);assert.equal(f.calls.length,0);assert.equal(f.marks.size,0);assert.equal(f.controller.getSnapshot().pending,0);
  }finally{f.close();}
});

test('failed or stopped manual checks do not retry on subsequent edits',async()=>{
  const f=fixture();
  try{
    f.controller.checkCurrent();await until(()=>f.calls.length===1,'failing manual request');f.calls[0].reject(Error('Synthetic service failure'));
    await until(()=>!!f.controller.getSnapshot().error,'failure shown');f.editor.tf.insertText('!',{at:{path:[0,0],offset:11}});await wait(20);
    assert.equal(f.calls.length,1);f.controller.checkCurrent();await until(()=>f.calls.length===2,'explicit request after failure');
    f.controller.stop();assert.equal(f.calls[1].signal.aborted,true);f.calls[1].resolve([]);
    f.editor.tf.insertText('?',{at:{path:[0,0],offset:12}});await wait(30);assert.equal(f.calls.length,2);assert.equal(f.controller.getSnapshot().pending,0);
  }finally{f.close();}
});

test('service errors show localized status and details without retrying the failed request or remaining document queue',async()=>{
  const f=fixture([p('one'),p('two',{text:'Second paragraph'}),p('three',{text:'Third paragraph'})]);
  try{
    f.controller.checkDocument();await until(()=>f.calls.length===1,'first document paragraph');f.calls[0].resolve([]);
    await until(()=>f.calls.length===2,'second document paragraph');
    f.calls[1].reject(new api.ProofreadingServiceError(402,'Insufficient Balance'));
    await until(()=>!f.controller.getSnapshot().checking,'HTTP error complete');
    assert.equal(f.controller.getSnapshot().error,'校对服务要求付费或账户余额不足（HTTP 402）。\n服务返回：Insufficient Balance');
    assert.equal(f.controller.getSnapshot().checked,1,'earlier successful paragraphs retain their checked state');
    assert.equal(f.controller.getSnapshot().pending,0,'a failed request stops the remaining manually requested queue');
    await wait(30);assert.equal(f.calls.length,2,'the service error must not cause an automatic retry');
    f.editor.tf.insertText('!',{at:{path:[1,0],offset:16}});await wait(30);assert.equal(f.calls.length,2,'editing after failure must not retry');
    assert.equal(f.controller.getSnapshot().error,'校对服务要求付费或账户余额不足（HTTP 402）。\n服务返回：Insufficient Balance');
  }finally{f.close();}
});

test('all supported HTTP categories and unknown status codes remain visible in localized controller errors',async()=>{
  const f=fixture();
  const cases=[
    [400,'校对服务拒绝了请求（HTTP 400）。'],
    [401,'校对服务拒绝了 API 密钥（HTTP 401）。'],
    [402,'校对服务要求付费或账户余额不足（HTTP 402）。'],
    [403,'校对服务拒绝访问（HTTP 403）。'],
    [404,'校对服务找不到此接口或模型（HTTP 404）。'],
    [408,'校对服务接收请求时超时（HTTP 408）。'],
    [413,'校对请求超过了服务允许的大小（HTTP 413）。'],
    [422,'校对服务拒绝了请求中的参数（HTTP 422）。'],
    [429,'校对服务的请求次数超限（HTTP 429）。'],
    [500,'校对服务发生内部错误（HTTP 500）。'],
    [502,'校对服务网关返回了无效响应（HTTP 502）。'],
    [503,'校对服务暂时不可用（HTTP 503）。'],
    [504,'校对服务网关超时（HTTP 504）。'],
    [418,'校对服务返回了 HTTP 错误。 (HTTP 418)'],
  ];
  try{
    for(const [status,expected] of cases){
      const count=f.calls.length;assert.equal(f.controller.checkCurrent(),true);
      await until(()=>f.calls.length===count+1,'explicit HTTP '+status+' check');
      f.calls.at(-1).reject(new api.ProofreadingServiceError(status));
      await until(()=>!f.controller.getSnapshot().checking,'HTTP '+status+' error');
      assert.equal(f.controller.getSnapshot().error,expected);assert.equal(f.controller.getSnapshot().pending,0);
    }
    assert.equal(f.calls.length,cases.length);
    f.controller.checkCurrent();await until(()=>f.calls.length===cases.length+1,'ordinary error');
    f.calls.at(-1).reject(new Error('Synthetic service failure'));
    await until(()=>!f.controller.getSnapshot().checking,'ordinary error complete');
    assert.equal(f.controller.getSnapshot().error,'Synthetic service failure','non-service errors retain the existing display path');
  }finally{f.close();}
});

test('disabled settings make manual checks inert',async()=>{
  const f=fixture(undefined,{enabled:false});
  try{
    assert.equal(f.controller.getSnapshot().enabled,false);assert.equal(f.controller.checkCurrent(),false);f.controller.checkDocument();
    f.editor.tf.insertText('!',{at:{path:[0,0],offset:11}});await wait(20);
    assert.equal(f.calls.length,0);assert.equal(f.marks.size,0);assert.equal(f.controller.getSnapshot().pending,0);
  }finally{f.close();}
});
