const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');
const {EditorModel}=require('./editor-model');

test('an unexpected editor render failure preserves recovery and notifies application chrome',async t=>{
 const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/'});
 for(const key of ['innerWidth','innerHeight','window','document','navigator','sessionStorage','localStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
 globalThis.getComputedStyle=window.getComputedStyle.bind(window);globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
 const output=await build({entryPoints:['src/plate-host.tsx'],bundle:true,platform:'node',format:'cjs',write:false,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'render-failure-kit',setup(b){
  b.onLoad({filter:/components[\\/]editor[\\/]editor-kit\.tsx$/},()=>({contents:`import {ParagraphPlugin,createPlatePlugin} from 'platejs/react';export const EditorKit=[ParagraphPlugin,createPlatePlugin({key:'crashing_node',node:{isElement:true,component(){throw Error('Synthetic editor render failure');}}})];`,loader:'tsx'}));
 }}]});
 const compiled=new Module(path.resolve('.render-recovery-test.cjs'),module);compiled.paths=module.paths;compiled._compile(output.outputFiles[0].text,path.resolve('.render-recovery-test.cjs'));
 const {PlateMathHost}=compiled.exports,mount=document.createElement('div');document.body.append(mount);
 const original=JSON.stringify({version:1,value:[{type:'p',children:[{text:'Original file bytes'}]}]});localStorage.setItem('original-file-test',original);
 const failures=[];window.addEventListener('vulgar-document-render-error',event=>failures.push(event.detail));
 const host=new PlateMathHost(mount,new EditorModel(),{activate(){},leave(){},change(){}});
 t.after(async()=>{host.destroy();await window.happyDOM.abort();});
 host.editor.tf.setValue([{type:'crashing_node',children:[{text:'Unsaved text to preserve'}]}]);
 await new Promise(resolve=>setTimeout(resolve,40));
 assert.equal(failures.length,1);assert.match(failures[0].error,/Synthetic editor render failure/);
 assert.match(localStorage.getItem('math-plate-document-v1-render-recovery'),/Unsaved text to preserve/);
 assert.equal(localStorage.getItem('original-file-test'),original,'render failure must never overwrite a file or its saved original');
});
