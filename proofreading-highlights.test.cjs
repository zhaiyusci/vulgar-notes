const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const output=buildSync({entryPoints:['src/proofreading-highlights.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const compiled={exports:{}};new Function('module','exports',output)(compiled,compiled.exports);
const {ProofreadingHighlights}=compiled.exports;
const slateRange=(start=0,end=7)=>({anchor:{path:[0,0],offset:start},focus:{path:[0,0],offset:end}});

async function fixture(supported=true){
  const {Window}=await import('happy-dom');const window=new Window(),doc=window.document;
  const mount=doc.createElement('div'),span=doc.createElement('span'),text=doc.createTextNode('Speling sample');span.append(text);mount.append(span);doc.body.append(mount);
  class StaticRangeMock {constructor(init){Object.assign(this,init);}}
  class HighlightMock extends Set {}
  const registry=new Map(),rect={left:10,right:80,top:20,bottom:36,width:70,height:16};
  const css=window.CSS;Object.defineProperty(css,'highlights',{value:supported?registry:undefined,configurable:true});
  Object.defineProperty(window,'CSS',{value:css,configurable:true});
  Object.defineProperty(window,'Highlight',{value:supported?HighlightMock:undefined,configurable:true});
  Object.defineProperty(window,'StaticRange',{value:supported?StaticRangeMock:undefined,configurable:true});
  const originalRange=doc.createRange.bind(doc);doc.createRange=()=>{const range=originalRange();range.getClientRects=()=>[rect];return range;};
  const editor={children:[{type:'p',children:[{text:text.data}]}],selection:null,api:{
    string:range=>{const [start,end]=[range.anchor.offset,range.focus.offset].sort((a,b)=>a-b);return editor.children[0].children[0].text.slice(start,end);},
    toDOMRange:range=>{const dom=doc.createRange(),[start,end]=[range.anchor.offset,range.focus.offset].sort((a,b)=>a-b);dom.setStart(text,start);dom.setEnd(text,end);return dom;},
    toSlateRange:range=>range.startContainer===text&&range.endContainer===text?slateRange(range.startOffset,range.endOffset):undefined,
  }};
  const context=(target=span,x=20,y=28,button=2)=>{const event=new window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:x,clientY:y,button});target.dispatchEvent(event);return event;};
  const keyboard=()=>span.dispatchEvent(new window.KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true}));
  const registeredRanges=()=>[...registry.values()].flatMap(highlight=>[...highlight]);
  return {window,doc,mount,span,text,editor,registry,rect,context,keyboard,StaticRangeMock,registeredRanges,close:()=>window.happyDOM.close()};
}

test('unsupported highlight APIs remain harmless and leave native menus alone',async()=>{
  const f=await fixture(false);let menus=0;
  try{
    const ink=new ProofreadingHighlights(f.editor,f.mount,()=>menus++);assert.equal(ink.available,false);
    assert.doesNotThrow(()=>{ink.set('one',slateRange(),'spelling');ink.remove('one');ink.clear();ink.destroy();ink.destroy();});
    assert.equal(f.context().defaultPrevented,false);assert.equal(menus,0);assert.equal(f.doc.head.querySelectorAll('style').length,0);
  }finally{await f.close();}
});

test('each instance owns static ranges, distinct styles and only its own registry entries',async()=>{
  const f=await fixture();
  try{
    const foreign=new Set();f.registry.set('unrelated-feature',foreign);
    const first=new ProofreadingHighlights(f.editor,f.mount,()=>{}),second=new ProofreadingHighlights(f.editor,f.mount,()=>{});
    assert.equal(first.available,true);assert.equal(second.available,true);assert.equal(f.registry.size,5);
    first.set('spelling',slateRange(),'spelling');second.set('grammar',slateRange(8,14),'grammar');
    assert.equal(f.registeredRanges().length,2);
    for(const range of f.registeredRanges())assert.ok(range instanceof f.StaticRangeMock,'registered highlights must never retain the temporary live DOM Range');
    const styles=[...f.doc.head.querySelectorAll('style')];assert.equal(styles.length,2);
    for(const style of styles){assert.match(style.textContent,/underline wavy #d93025/);assert.match(style.textContent,/underline wavy #1a73e8/);assert.doesNotMatch(style.textContent,/background/);}
    assert.equal(f.mount.querySelectorAll('span').length,1,'ink must not wrap or replace editor text');
    first.remove('spelling');assert.equal(f.registeredRanges().length,1);
    first.set('spelling',slateRange(),'spelling');first.clear();assert.equal(f.registeredRanges().length,1);
    first.set('spelling',slateRange(),'spelling');first.destroy();first.destroy();
    assert.equal(f.registry.size,3);assert.equal(f.registeredRanges().length,1);assert.equal(f.doc.head.querySelectorAll('style').length,1);
    second.destroy();assert.deepEqual([...f.registry.keys()],['unrelated-feature']);assert.equal(f.registry.get('unrelated-feature'),foreign);assert.equal(f.doc.head.querySelectorAll('style').length,0);
    first.set('after-destroy',slateRange(),'grammar');assert.equal(f.registeredRanges().length,0);
  }finally{await f.close();}
});

test('only an issue with a real rectangle under the pointer intercepts context menus',async()=>{
  const f=await fixture(),opened=[];let bubbled=0;
  const ink=new ProofreadingHighlights(f.editor,f.mount,(...args)=>opened.push(args));
  try{
    f.doc.body.addEventListener('contextmenu',()=>bubbled++);ink.set('typo',slateRange(),'spelling');
    assert.equal(f.context(f.span,200,28).defaultPrevented,false,'nearby blank space must not hit the nearest caret');assert.equal(bubbled,1);
    assert.equal(f.context().defaultPrevented,true);assert.deepEqual(opened,[['typo',20,28]]);assert.equal(bubbled,1,'issue hits stop the ordinary block-menu listener');
    const math=f.doc.createElement('span');math.className='math-mount-wrapper';f.mount.append(math);
    assert.equal(f.context(math).defaultPrevented,false,'formula context menus must remain independent');
    ink.remove('typo');assert.equal(f.context().defaultPrevented,false);assert.equal(opened.length,1);
  }finally{ink.destroy();await f.close();}
});

test('stale Slate identities, stale rendered text and conversion failures never leave clickable ink',async()=>{
  const f=await fixture();let opened=0;const ink=new ProofreadingHighlights(f.editor,f.mount,()=>opened++);
  try{
    ink.set('typo',slateRange(),'spelling');
    f.editor.children=[{type:'p',children:[{text:'Speling sample'}]}];
    assert.equal(f.context().defaultPrevented,false);assert.equal(f.registeredRanges().length,0,'an immutable leaf replacement invalidates an old range');
    ink.set('typo',slateRange(),'spelling');assert.equal(f.registeredRanges().length,1);
    f.text.data='Changed sample';assert.equal(f.context().defaultPrevented,false);assert.equal(f.registeredRanges().length,0,'an old rendering must not be matched to new Slate offsets');
    ink.set('typo',slateRange(),'spelling');assert.equal(f.registeredRanges().length,0,'set also rejects rendering that differs from the Slate text');
    f.text.data='Speling sample';ink.set('typo',slateRange(),'spelling');
    f.editor.api.toDOMRange=()=>{throw Error('pending render');};assert.doesNotThrow(()=>ink.set('typo',slateRange(),'grammar'));assert.equal(f.registeredRanges().length,0);
    assert.equal(f.context().defaultPrevented,false);assert.equal(opened,0);
  }finally{ink.destroy();await f.close();}
});

test('keyboard context menus use the current selection and do not steal text-input menus',async()=>{
  const f=await fixture(),opened=[],ink=new ProofreadingHighlights(f.editor,f.mount,(...args)=>opened.push(args));
  try{
    ink.set('typo',slateRange(7,0),'spelling');f.editor.selection=slateRange(3,3);f.keyboard();
    assert.equal(f.context(f.span,0,0,0).defaultPrevented,true);assert.deepEqual(opened,[['typo',10,36]]);
    f.editor.selection=slateRange(12,12);f.keyboard();assert.equal(f.context(f.span,0,0,0).defaultPrevented,false);
    f.editor.selection=slateRange(3,3);const input=f.doc.createElement('textarea');f.mount.append(input);f.keyboard();
    assert.equal(f.context(input,0,0,0).defaultPrevented,false);assert.equal(opened.length,1);
  }finally{ink.destroy();await f.close();}
});
