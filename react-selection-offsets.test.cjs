const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {build,buildSync}=require('esbuild');
const {patchReactDOMSelection,reactDOMSelectionPlugin,auditedVersion}=require('./scripts/react-dom-selection.cjs');
const reactPath=path.join(path.dirname(require.resolve('react-dom/package.json')),'cjs/react-dom-client.production.js');
const source=fs.readFileSync(reactPath,'utf8');
const capture=source.indexOf('function commitBeforeMutationEffects(');
const begin=source.indexOf('          var length = 0,',capture);
const end=source.indexOf('\n        } else JSCompiler_temp = null;',begin);
assert.ok(capture>=0&&begin>capture&&end>begin);
const originalOffsets=new Function('root','JSCompiler_temp','anchorOffset','focusNode','selection',source.slice(begin,end)+'\nreturn JSCompiler_temp;');
const helperBundle=buildSync({entryPoints:['src/lib/native-selection-offsets.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const helperModule={exports:{}};new Function('module','exports',helperBundle)(helperModule,helperModule.exports);
const {nativeSelectionOffsets:offsets}=helperModule.exports;
async function fixture(){const {Window}=await import('happy-dom');const window=new Window();const root=window.document.createElement('div');root.contentEditable='true';window.document.body.append(root);return {window,root,doc:window.document};}
const compare=(root,a,ao,f,fo)=>assert.deepEqual(offsets(root,a,ao,f,fo)??originalOffsets(root,a,ao,f,fo),originalOffsets(root,a,ao,f,fo));

test('audited patch preserves the complete original code and rejects unaudited upgrades',()=>{
  const patched=patchReactDOMSelection(source,auditedVersion);
  const restored=patched.replace(/\nvar vulgarNativeSelectionOffsets = require\([^\n]+\)\.nativeSelectionOffsets;/,'')
    .replace(/          var vulgarNativeOffsets = vulgarNativeSelectionOffsets\([^\n]+\);\n          if \(vulgarNativeOffsets !== null\) \{\n            JSCompiler_temp = vulgarNativeOffsets;\n            break a;\n          \}\n/,'');
  assert.equal(restored,source,'strict mode, native controls, original fallback and all other React behavior remain byte-identical');
  assert.throws(()=>patchReactDOMSelection(source,'next-react-version'),/requires a new audit/);
  assert.throws(()=>patchReactDOMSelection(source+'\n',auditedVersion),/requires a new audit/);
});

test('the production esbuild plugin resolves the typed helper without changing installed React',async()=>{
  const result=await build({stdin:{contents:"export {createRoot} from 'react-dom/client';",resolveDir:__dirname},bundle:true,platform:'browser',format:'esm',conditions:['production'],define:{'process.env.NODE_ENV':'"production"'},plugins:[reactDOMSelectionPlugin()],write:false});
  assert.match(result.outputFiles[0].text,/function nativeSelectionOffsets/);
  assert.match(result.outputFiles[0].text,/vulgarNativeOffsets/);
  assert.equal(fs.readFileSync(reactPath,'utf8'),source);
});

test('native offsets match React for every pair of text/element/comment boundaries without changing selection',async()=>{
  const {window,root,doc}=await fixture();
  try{
    root.innerHTML='<span>甲a😀</span><br><span></span><b>𝛼β<span>Ω</span></b><span hidden>hidden</span><span contenteditable="false">atomic</span><img><div>line<br>末</div>';
    root.insertBefore(doc.createComment('note'),root.children[3]);root.append(doc.createTextNode(''));
    const points=[];
    function visit(node){const count=[3,8].includes(node.nodeType)?node.length:node.childNodes.length;for(let offset=0;offset<=count;offset++)points.push([node,offset]);for(const child of node.childNodes)visit(child);}
    visit(root);
    const selection=window.getSelection();selection.setBaseAndExtent(root.lastElementChild.lastChild,1,root.firstChild.firstChild,1);
    const saved=[selection.anchorNode,selection.anchorOffset,selection.focusNode,selection.focusOffset];
    for(const [a,ao] of points)for(const [f,fo] of points)compare(root,a,ao,f,fo);
    assert.deepEqual([selection.anchorNode,selection.anchorOffset,selection.focusNode,selection.focusOffset],saved);
    assert.ok(points.length**2>4000);
    const outside=doc.createTextNode('outside');doc.body.append(outside);
    assert.equal(offsets(root,outside,1,root,0),null);compare(root,outside,1,root,0);
    assert.equal(offsets(root,root.firstChild.firstChild,999,root,0),null,'invalid native boundary falls back');
  }finally{await window.happyDOM.close();}
});

test('deep CJK and supplementary characters retain UTF-16 offsets and backward direction',async()=>{
  const {window,root,doc}=await fixture();
  try{
    root.append(doc.createTextNode('prefix😀'));let cursor=root;
    for(let i=0;i<100;i++){const next=doc.createElement('span');cursor.append(next);cursor=next;}
    cursor.append(doc.createTextNode('嵌套𝛼終'));root.append(doc.createTextNode('suffix'));
    assert.deepEqual(offsets(root,root.firstChild,6,cursor.firstChild,4),{start:6,end:12});
    assert.deepEqual(offsets(root,cursor.firstChild,4,root.firstChild,6),{start:12,end:6});
    assert.deepEqual(offsets(root,cursor.firstChild,3,cursor.firstChild,3),{start:11,end:11});
  }finally{await window.happyDOM.close();}
});

test('CDATA cache detects same-task direct/nested insertion and stays conservative after removal',async()=>{
  const {window,root,doc}=await fixture();
  // HappyDOM has no CDATASection implementation. Its TreeWalker uses the
  // public nodeType, so a Text node with nodeType 4 exercises the same guard
  // and real MutationObserver delivery. Actual XML/HTML CDATA is additionally
  // verified in the Chromium diagnostic matrix.
  const cdata=()=>{const node=doc.createTextNode('CDATA😀');Object.defineProperty(node,'nodeType',{get:()=>4});return node;};
  try{
    for(const nested of [false,true]){
      const host=doc.createElement('div');root.append(host);const text=doc.createTextNode('text');host.append(text);
      assert.deepEqual(offsets(host,text,1,text,2),{start:1,end:2});
      let added=cdata();if(nested){const wrapper=doc.createElement('span');wrapper.append(added);added=wrapper;}
      host.insertBefore(added,text);
      assert.equal(offsets(host,text,1,text,2),null,'takeRecords must detect insertion before observer callback');
      compare(host,text,1,text,2);added.remove();assert.equal(offsets(host,text,1,text,2),null,'removal cannot accidentally re-enable native offsets');
    }
    const callbackHost=doc.createElement('div'),text=doc.createTextNode('text');root.append(callbackHost);callbackHost.append(text);
    assert.deepEqual(offsets(callbackHost,text,1,text,2),{start:1,end:2});callbackHost.prepend(cdata());
    await new Promise(resolve=>window.setTimeout(resolve,0));
    assert.equal(offsets(callbackHost,text,1,text,2),null,'observer callback must remember records it already drained');
    const initial=doc.createElement('div');root.append(initial);initial.append(cdata(),doc.createTextNode('z'));
    assert.equal(offsets(initial,initial.lastChild,1,initial.lastChild,1),null);
  }finally{await window.happyDOM.close();}
});

test('ordinary text edits do not repeat a full-root CDATA scan and collapsed offsets stringify only once',async()=>{
  const {window,root,doc}=await fixture();let rootScans=0,strings=0;
  try{
    const walker=doc.createTreeWalker.bind(doc);doc.createTreeWalker=(node,...args)=>{if(node===root)rootScans++;return walker(node,...args);};
    const range=doc.createRange.bind(doc);doc.createRange=()=>{const value=range(),string=value.toString.bind(value);value.toString=()=>{strings++;return string();};return value;};
    const text=doc.createTextNode('ab');root.append(text);
    for(let i=0;i<10;i++){text.data+='x';assert.deepEqual(offsets(root,text,1,text,1),{start:1,end:1});}
    root.append(doc.createTextNode('new text'));assert.deepEqual(offsets(root,text,1,text,1),{start:1,end:1});
    const span=doc.createElement('span');span.textContent='ordinary subtree';root.append(span);assert.deepEqual(offsets(root,text,1,text,1),{start:1,end:1});
    assert.equal(rootScans,1);assert.equal(strings,12);
    doc.createRange=()=>{throw Error('detached or unavailable DOM API');};assert.equal(offsets(root,text,1,text,1),null);
  }finally{await window.happyDOM.close();}
});
