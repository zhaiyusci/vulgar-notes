const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');

function load(code,name){const compiled=new Module(path.resolve(name),module);compiled.paths=module.paths;compiled._compile(code,path.resolve(name));return compiled.exports;}
const api=build({entryPoints:['src/document-outline.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).then(result=>load(result.outputFiles[0].text,'.outline-unit-test.cjs'));
const heading=(level,text,extra={})=>({type:'h'+level,...extra,children:typeof text==='string'?[{text}]:text});

test('contents cover all six heading levels and derive hierarchy and numbers without editing nodes',async()=>{
  const {documentOutline}=await api;
  const value=[heading(1,'First'),...Array.from({length:5},(_,index)=>heading(index+2,'Level '+(index+2))),heading(2,'Next section'),heading(1,'Second')];
  const before=JSON.stringify(value),items=documentOutline(value);
  assert.deepEqual(items.map(item=>item.depth),[1,2,3,4,5,6,2,1]);
  assert.deepEqual(items.map(item=>item.number),['1','1.1','1.1.1','1.1.1.1','1.1.1.1.1','1.1.1.1.1.1','1.2','2']);
  assert.equal(items[0].node,value[0]);assert.deepEqual(items[5].path,[5]);
  assert.equal(JSON.stringify(value),before,'TOC generation never persists text, IDs or numbering');
});

test('renaming, reordering and removing headings immediately produce new contents and numbering',async()=>{
  const {documentOutline}=await api;
  const first=heading(1,'First'),sub=heading(2,'Child'),second=heading(1,'Second');
  const value=[first,sub,second];assert.deepEqual(documentOutline(value).map(item=>item.number),['1','1.1','2']);
  second.children[0].text='Renamed';value.unshift(value.pop());
  assert.deepEqual(documentOutline(value).map(item=>[item.title,item.number]),[['Renamed','1'],['First','2'],['Child','2.1']]);
  value.splice(1,1);
  assert.deepEqual(documentOutline(value).map(item=>[item.title,item.number]),[['Renamed','1'],['Child','1.1']]);
});

test('nested sections, duplicate IDs and missing IDs get distinct navigation targets',async()=>{
  const {documentOutline,outlineHeadingAnchor}=await api;
  const value=[heading(1,'Same',{id:'duplicate'}),{type:'column_group',children:[{type:'column',children:[heading(2,'Same',{id:'duplicate'})]}]},heading(1,'Same')];
  const items=documentOutline(value);
  assert.deepEqual(items.map(item=>item.path),[[0],[1,0,0],[2]]);
  assert.deepEqual(items.map(item=>item.anchor),['vn-heading-0','vn-heading-1-0-0','vn-heading-2']);
  assert.equal(new Set(items.map(item=>item.anchor)).size,3);
  for(const item of items)assert.equal(item.anchor,outlineHeadingAnchor(item.path));
});

test('empty titles are omitted, formula titles are preserved and generated or note contents are excluded',async()=>{
  const {documentOutline}=await api;
  const value=[heading(1,'  \n '),heading(1,[{text:'Energy '},{type:'inline_equation',texExpression:'E=mc^2',children:[{text:''}]},{type:'tex_label',texLabel:'sec:energy',children:[{text:''}]}]),
    {type:'toc',children:[heading(1,'Old cached contents')]},{type:'footnoteDefinition',children:[heading(1,'Note heading')]},heading(6,'Deep')];
  const items=documentOutline(value);
  assert.deepEqual(items.map(item=>item.title),['Energy E=mc^2','Deep']);
  assert.deepEqual(items.map(item=>item.number),['2','2.0.0.0.0.1']);
  assert.equal(items.some(item=>item.title.includes('sec:energy')),false);
});

test('Markdown contents use current unique anchors, all levels and escaped link text',async()=>{
  const {tocMarkdown,documentOutline}=await api;
  const value=[{type:'toc',children:[{text:''}]},heading(1,'A [link](x) *bold* _x_ `code` <script> & | \\'),heading(6,'深层')];
  const result=tocMarkdown(value);
  assert.match(result,/- \[1 A \\\[link\\\]\(x\) \\\*bold\\\* \\_x\\_ \\`code\\` &lt;script&gt; &amp; \\\| \\\\\]\(#vn-heading-1\)/);
  assert.ok(result.split('\n')[1].startsWith('          - [1.0.0.0.0.1 深层]'));
  const links=[...result.matchAll(/\]\(#([^)]*)\)/g)].map(match=>match[1]);
  assert.deepEqual(links,documentOutline(value).map(item=>item.anchor));
  assert.equal(tocMarkdown([]),'');
});

test('rendered contents update and navigate to the correct heading after document changes',async t=>{
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  Object.defineProperty(window.Range.prototype,'getBoundingClientRect',{value:undefined,configurable:true});
  const globals=['window','document','navigator','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','DOMRect','NodeFilter','ShadowRoot'];
  const previous=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of globals)Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  globalThis.getComputedStyle=window.getComputedStyle.bind(window);globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
  const scrolls=[];window.HTMLElement.prototype.scrollIntoView=function(){scrolls.push(this);};
  const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {Plate,PlateContent,createPlateEditor,ParagraphPlugin} from 'platejs/react';import {H1Plugin,H2Plugin,H6Plugin} from '@platejs/basic-nodes/react';import {TocKit} from './src/components/editor/plugins/toc-kit';export function mount(container,value){const editor=createPlateEditor({plugins:[ParagraphPlugin,H1Plugin,H2Plugin,H6Plugin,...TocKit],value});const root=createRoot(container);flushSync(()=>root.render(<Plate editor={editor}><PlateContent /></Plate>));return {editor,unmount(){root.unmount();}};}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'outline-i18n',setup(builder){builder.onResolve({filter:/^@\/i18n$/},()=>({path:'i18n',namespace:'outline-test'}));builder.onLoad({filter:/.*/,namespace:'outline-test'},()=>({contents:'export const t=value=>value;'}));}}]});
  const {mount}=load(result.outputFiles[0].text,'.outline-ui-test.cjs');
  const container=document.createElement('div');document.body.append(container);
  const view=mount(container,[{type:'toc',children:[{text:''}]},heading(1,'First'),heading(2,'Subsection'),heading(6,'Deep')]);
  const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
  t.after(async()=>{view.unmount();await window.happyDOM.abort();for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  await tick();
  const links=()=>[...container.querySelectorAll('.document-toc-link')];
  assert.deepEqual(links().map(button=>button.textContent),['1First','1.1Subsection','1.1.0.0.0.1Deep']);
  links()[1].click();await tick();
  assert.deepEqual(view.editor.selection.anchor.path,[2,0]);assert.equal(scrolls.at(-1),view.editor.api.toDOMNode(view.editor.children[2]));
  view.editor.tf.insertText('New ',{at:{path:[2,0],offset:0}});await tick();
  assert.equal(links()[1].textContent,'1.1New Subsection');
  view.editor.tf.moveNodes({at:[3],to:[1]});await tick();
  assert.deepEqual(links().map(button=>button.textContent),['0.0.0.0.0.1Deep','1First','1.1New Subsection']);
  links()[0].click();await tick();assert.deepEqual(view.editor.selection.anchor.path,[1,0]);
  view.editor.tf.removeNodes({at:[1]});await tick();
  assert.deepEqual(links().map(button=>button.textContent),['1First','1.1New Subsection']);
  assert.deepEqual(view.editor.children[0].children,[{text:''}],'generated contents never replace the persisted empty TOC child');
  view.editor.tf.removeNodes({at:[2]});view.editor.tf.removeNodes({at:[1]});await tick();
  assert.equal(links().length,0);assert.match(container.textContent,/Add headings to display the table of contents\./);
});
