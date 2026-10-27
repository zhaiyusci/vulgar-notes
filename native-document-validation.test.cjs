const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const vm=require('node:vm');
const compiled=buildSync({entryPoints:['src/plate-document.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const moduleApi={exports:{}};
vm.runInNewContext(compiled,{module:moduleApi,exports:moduleApi.exports,console,crypto:globalThis.crypto,URL,TextEncoder,TextDecoder,localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null}});
const api=moduleApi.exports;
const envelope=value=>JSON.stringify({version:1,value});
const text=text=>({text});
const node=(type,props={},children=[text('')])=>({type,...props,children});
const p=(...children)=>node('p',{},children);
function rejects(value,code='invalid-document'){
 const source=typeof value==='string'?value:JSON.stringify(value);
 assert.throws(()=>api.parseDocumentEnvelope(source),error=>error.name==='DocumentFormatError'&&error.code===code&&error.cause===undefined);
}

test('malformed JSON and unrelated JSON return stable format errors without exposing file content',()=>{
 const secret='DO_NOT_INCLUDE_PRIVATE_FILE_CONTENT';
 for(const source of [`{"${secret}":`,secret,'[']){
  assert.throws(()=>api.parseDocumentEnvelope(source),error=>{
   assert.equal(error.name,'DocumentFormatError');assert.equal(error.code,'invalid-json');assert.doesNotMatch(String(error),new RegExp(secret));assert.equal(error.cause,undefined);return true;
  });
 }
 for(const value of [null,[],{},42,{version:1,value:[]},{version:2,value:[p(text('valid text'))]},{version:1,value:[text('a root text node')]}])rejects(value);
});

test('known render failures are rejected before a document can be opened',()=>{
 const malformed=[
  p(node('a',{url:{bad:true}},[text('Link')])),
  p(node('date',{date:{bad:true}})),
  p(node('date',{rawDate:['bad']})),
  p(node('mention',{value:{bad:true}})),
  node('code_block',{lang:{bad:true}},[node('code_line',{},[text('code')])]),
  node('callout',{icon:{bad:true}},[p(text('Callout'))]),
  node('placeholder',{mediaType:'unsupported-widget'}),
  node('table',{colSizes:'not an array'},[node('tr',{},[node('td',{},[p(text('Cell'))])])]),
  node('code_drawing',{data:{code:{bad:true}}}),
  node('excalidraw',{data:{elements:{bad:true}}}),
 ];
 for(const malformedNode of malformed)rejects({version:1,value:[malformedNode]});
});

test('node shape, roots, text marks and malformed known field types cannot pass validation',()=>{
 for(const value of [
  [{type:'p',text:'mixed root',children:[text('child')]}],
  [p({text:'mixed child',children:[text('child')]})],
  [p({text:'mixed child',type:'p'})],
  [p({text:12})], [p(null)], [p([])], [{type:'p',children:[]}], [{type:'',children:[text('')]}],
  [p({text:'word',bold:'true'})], [p({text:'word',fontFamily:{bad:true}})],
  [node('p',{id:2},[text('word')])], [node('p',{lineHeight:[]},[text('word')])],
  [node('p',{indent:'2'},[text('word')])], [node('p',{listStyleType:{}},[text('word')])],
  [p(node('a',{url:5}))], [p(node('a',{url:'https://example.org',target:{}}))],
  [p(node('date',{date:20261027}))], [p(node('mention',{value:['Not text']}))],
  [node('img',{url:{}})], [node('video',{url:3})], [node('file',{url:'file.pdf',name:{}})],
  [node('img',{url:'image.png',caption:{text:'not an array'}})],
  [node('img',{url:'image.png',caption:[{text:'mixed caption',type:'p'}]})],
  [node('column',{width:{}})], [node('column_group',{layout:['50%']},[node('column',{width:'100%'},[p(text(''))])])],
  [node('td',{borders:{top:{color:{}}}},[p(text('Cell'))])],
  [node('td',{attributes:{colspan:2}},[p(text('Cell'))])],
  [p(node('footnoteReference',{identifier:{}}))],
  [p(node('inline_equation',{texExpression:{}}))], [p(node('inline_equation',{snapshot:{}}))],
  [p(node('inline_equation',{display:'true'}))], [p(node('inline_equation',{numbered:1}))],
  [node('code_drawing',{data:[]})], [node('code_drawing',{data:{drawingMode:2}})],
  [node('excalidraw',{data:{state:{viewBackgroundColor:{}}}})],
 ])rejects({version:1,value});
});

test('valid complete rich-text data and unrelated custom metadata round trip intact',()=>{
 const value=[
  node('h1',{id:'heading',texLabel:'sec:one'},[text('Heading')]),
  node('p',{align:'justify',lineHeight:1.5,indent:1,listStyleType:'decimal',listStart:2,checked:false,metadata:{retained:true}},[
   {text:'Text ',bold:true,italic:false,fontSize:16,fontFamily:'Georgia',fontWeight:600,color:'#123456',backgroundColor:'transparent'},
   node('a',{url:'https://example.org',target:'_blank'},[text('link')]),
   node('date',{date:'2026-10-27',rawDate:'October 27'}),node('mention',{value:'Local writer'}),
   node('footnoteReference',{identifier:'note-1'}),node('inline_equation',{texExpression:'x^2',display:false,numbered:true}),
  ]),
  node('code_block',{lang:'typescript'},[node('code_line',{},[{text:'let x=1;',className:'token keyword'}])]),
  node('callout',{icon:'💡',backgroundColor:'#fef3c7',variant:'note'},[p(text('A callout'))]),
  node('table',{colSizes:[140,0],marginLeft:0},[node('tr',{size:44},[
   node('th',{colSpan:1,rowSpan:1,background:'#fff',borders:{top:{color:'#000',size:1,style:'solid'}},attributes:{colspan:'1'}},[p(text('Header'))]),
   node('td',{},[p(text('Cell'))]),
  ])]),
  node('column_group',{layout:[50,50]},[node('column',{width:'50%'},[p(text('Left'))]),node('column',{width:'50%'},[p(text('Right'))])]),
  node('img',{url:'data:image/png;base64,AA==',name:'image.png',width:320,initialHeight:200,caption:[{text:'Caption',italic:true}],isUpload:false}),
  node('audio',{url:'https://example.org/a.mp3'}),node('video',{url:'https://example.org/v.mp4'}),node('file',{url:'https://example.org/f.pdf',name:'Paper.pdf'}),
  node('placeholder',{mediaType:'img'}),node('date'),
  node('code_drawing',{data:{code:'flowchart LR\nA-->B',drawingType:'Mermaid',drawingMode:'Both',futureSetting:{retained:true}}}),
  node('excalidraw',{data:{elements:[],state:{viewBackgroundColor:'#fff',gridSize:null},extra:{retained:true}}}),
  node('footnoteDefinition',{identifier:'note-1'},[p(text('Note'))]),
  node('future_custom_widget',{value:{custom:true},data:{fields:[1,2]},code:'A custom code field',color:{customColor:true},unrelatedMetadata:{version:3}},[p(text('Custom text'))]),
 ];
 const source=envelope(value),parsed=api.parseDocumentEnvelope(source);
 assert.deepEqual(JSON.parse(JSON.stringify(parsed.value)),value);
 assert.equal(JSON.stringify(api.parseDocumentFile(source)),JSON.stringify(value));
});

test('existing structural math snapshots and snapshot-only legacy formulas remain readable',()=>{
 const {EditorModel}=require('./editor-model.js');const model=new EditorModel();
 const value=[p(node('inline_equation',{snapshot:model.snapshot(),texExpression:model.exportLatex(),id:'math-snapshot'})),p(node('equation',{snapshot:model.snapshot(),numbered:false}))];
 assert.equal(JSON.stringify(api.parseDocumentFile(envelope(value))),JSON.stringify(value));
 rejects({version:1,value:[p(node('inline_equation',{snapshot:'not a math snapshot'}))]});
});

test('bibliography validation failures also use the same public format error',()=>{
 rejects({version:1,value:[p(text('Text'))],bibliographyLibraries:[{id:'bad',name:'private.bib',source:'@article{PRIVATE_BIBTEX_INVALID,title='}]});
 rejects({version:1,value:[p(text('Text'))],bibliographyStyle:'unknown-style'});
});
