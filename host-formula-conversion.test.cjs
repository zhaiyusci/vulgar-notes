const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');

test('loaded source formulas become editable without changing their original TeX or saved state',async t=>{
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><html><body></body></html>');
  for(const key of ['window','document','navigator','sessionStorage','localStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  globalThis.getComputedStyle=window.getComputedStyle.bind(window);globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
  const result=await build({stdin:{contents:`export {PlateMathHost} from './src/plate-host';export {EditorModel} from './src/editor-model';export {convertMath,conversionStats} from './src/tex-convert';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'conversion-host-test-kit',setup(builder){
    builder.onLoad({filter:/components[\\/]editor[\\/]editor-kit\.tsx$/},()=>({contents:`import {ParagraphPlugin} from 'platejs/react';import {TrailingBlockPlugin} from 'platejs';import {LinkPlugin} from '@platejs/link/react';import {MathKit} from './plugins/math-kit';import {MarkdownKit} from './plugins/markdown-kit';import {ReferenceKit} from './plugins/reference-kit';import {FootnoteKit} from './plugins/footnote-kit';export const EditorKit=[ParagraphPlugin,LinkPlugin,...MathKit,...ReferenceKit,TrailingBlockPlugin,...MarkdownKit,...FootnoteKit];`,loader:'tsx',resolveDir:path.resolve('src/components/editor')}));
    builder.onLoad({filter:/src[\\/]tex-convert\.ts$/},args=>{
      const source=fs.readFileSync(args.path,'utf8'),instrumented=source.replace(/export function convertMath\(source\s*:\s*string\)\s*:\s*EditorModel\s*\{/,'export const conversionStats={calls:0}; export function convertMath(source:string):EditorModel { conversionStats.calls++;');
      assert.notEqual(instrumented,source,'instrument the actual parser boundary to detect repeated whole-formula work');return {contents:instrumented,loader:'ts',resolveDir:path.dirname(args.path)};
    });
  }}]});
  const compiled=new Module(path.resolve('.host-formula-conversion-test.cjs'),module);compiled.paths=module.paths;compiled._compile(result.outputFiles[0].text,path.resolve('.host-formula-conversion-test.cjs'));
  const api=compiled.exports,tick=()=>new Promise(resolve=>setTimeout(resolve,10));
  const p=children=>({type:'p',id:'block-'+(children.find(node=>node.type==='inline_equation')?.id??'body'),children}),math=(id,source,extra={})=>({type:'inline_equation',id,texExpression:source,numbered:true,...extra,children:[{text:''}]}),source=value=>JSON.stringify({version:1,value});
  const allMath=nodes=>nodes.flatMap(node=>[...(['equation','inline_equation'].includes(node.type)?[node]:[]),...allMath(node.children??[])]);
  const host=initial=>{
    sessionStorage.clear();localStorage.clear();if(initial)localStorage.setItem('math-plate-document-v1',initial);
    const mount=document.createElement('div');document.body.append(mount);return new api.PlateMathHost(mount,new api.EditorModel(),{activate(){},leave(){},change(){}});
  };
  const rawModel=tex=>{const model=new api.EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);model.insertSourceTex(tex);return model;};
  const firstDifference=(left,right,path='')=>{
    if(path.endsWith('.snapshot')&&typeof left==='string'&&typeof right==='string'){left=JSON.parse(left).root;right=JSON.parse(right).root;}
    if(left===right)return null;
    if(!left||!right||typeof left!=='object'||typeof right!=='object')return {path,left:typeof left==='string'?left.slice(0,100):left,right:typeof right==='string'?right.slice(0,100):right};
    for(const key of new Set([...Object.keys(left),...Object.keys(right)])){const found=firstDifference(left[key],right[key],path+'.'+key);if(found)return found;}return null;
  };

  await t.test('snapshotless unsupported commands receive a source-preserving editable model on open',async()=>{
    const tex=String.raw`\futurecmd[opt]{a}{b}+x`,original=source([p([{text:'Before '},math('source-only',tex),{text:' after'}])]),flow=host();flow.openDocument(original);await tick();
    const node=allMath(flow.editor.children)[0],entry=flow.entries()[0];assert.ok(node.snapshot);assert.ok(entry);assert.equal(node.texExpression,tex);assert.equal(entry.model.exportLatex(),tex);
    assert.equal(flow.hasUnsavedChanges(),false);flow.markDocumentSaved(original);assert.equal(flow.hasUnsavedChanges(),false,'adding a derived editing tree does not modify the saved original');
    entry.model.setCursor(entry.model.root.id,entry.model.root.items.length);entry.model.replaceInput(entry.model.cursor.offset,entry.model.cursor.offset,'+z');flow.syncMath();await tick();assert.equal(flow.hasUnsavedChanges(),true);assert.match(allMath(flow.editor.children)[0].texExpression,/\+z$/);flow.destroy();
  });
  await t.test('source-tex inside an existing snapshot retries conversion at load while keeping its surrounding native structure',async()=>{
    const raw=String.raw`\frac{a}{\sqrt{x}}`,model=rawModel(raw);model.setCursor(model.root.id,0);model.replaceInput(0,0,'b+');model.setCursor(model.root.items[2].regions[0].id,3);
    const original=source([p([{text:''},math('old-raw',String.raw`b+\frac{a}{\sqrt{x}}`,{snapshot:model.snapshot()}),{text:''}])]),flow=host();flow.openDocument(original);await tick();
    const loaded=flow.entries()[0].model;assert.equal(loaded.root.items[0],'b');assert.equal(loaded.root.items[1],'+');assert.equal(loaded.root.items[2].type,'frac');assert.equal(loaded.root.items[2].regions[1].items[0].type,'sqrt');
    assert.equal(allMath(flow.editor.children)[0].texExpression,String.raw`b+\frac{a}{\sqrt{x}}`);flow.markDocumentSaved(original);assert.equal(flow.hasUnsavedChanges(),false);assert.doesNotThrow(()=>loaded.current);flow.destroy();
  });
  await t.test('source conversion is bounded to loading, not retried on each caret or body update',async()=>{
    const original=source([p([{text:'Body '},math('source-cache',String.raw`\futurecmd{x}`),{text:''}])]),flow=host();flow.openDocument(original);await tick();const entry=flow.entries()[0];assert.ok(entry);
    const calls=api.conversionStats.calls;
    for(let index=0;index<5;index++){entry.model.setCursor(entry.model.root.id,index%2);flow.persist();flow.editor.tf.select(flow.editor.api.end([]));flow.editor.tf.insertText('.');await tick();}
    assert.equal(api.conversionStats.calls,calls,'unchanged formulas do not call the parser again');flow.destroy();
  });
  await t.test('an unknown raw component with no conversion progress retains IDs, cursor and source',async()=>{
    const tex=String.raw`\futurecmd[opt]{x}`,model=rawModel(tex);model.setCursor(model.root.items[0].regions[0].id,4);const snapshot=model.snapshot(),original=source([p([{text:''},math('opaque-no-progress',tex,{snapshot}),{text:''}])]),flow=host();flow.openDocument(original);await tick();
    assert.equal(allMath(flow.editor.children)[0].snapshot,snapshot);assert.deepEqual(flow.entries()[0].model.cursor,model.cursor);flow.markDocumentSaved(original);assert.equal(flow.hasUnsavedChanges(),false);flow.destroy();
  });
  await t.test('upgrading a raw component leaves adjacent already edited native nodes unchanged',async()=>{
    const model=api.convertMath('b^2'),native=JSON.parse(JSON.stringify(model.root.items[0])),raw=rawModel(String.raw`\frac{a}{b}`);
    model.setCursor(model.root.id,model.root.items.length);model.replaceFragment(['+',...raw.root.items]);const original=source([p([{text:''},math('preserve-adjacent',String.raw`b^2+\frac{a}{b}`,{snapshot:model.snapshot()}),{text:''}])]),flow=host();flow.openDocument(original);await tick();
    const items=flow.entries()[0].model.root.items;assert.deepEqual(items[0],native);assert.equal(items[1],'+');assert.equal(items[2].type,'frac');assert.equal(flow.entries()[0].model.undoStack.length,0,'a representation upgrade is not a user math edit');flow.destroy();
  });
  await t.test('recovered edits retain their dirty state when the old saved baseline is normalized',async()=>{
    const original=source([p([{text:'Saved '},math('recovery-source',String.raw`\futurecmd{x}`),{text:''}])]),recovered=source([p([{text:'Unsaved body '},math('recovery-source',String.raw`\futurecmd{x}`),{text:''}])]);
    const flow=host(recovered);flow.markDocumentSaved(original);await tick();assert.equal(flow.entries().length,1);assert.equal(flow.hasUnsavedChanges(),true);assert.match(flow.editor.api.string([]),/Unsaved body/);flow.destroy();
  });
  await t.test('editing existing LaTeX retains the live model, exact source, formula identity and document undo',async()=>{
    const old=String.raw`\frac{a}{b}`,original=source([p([{text:''},math('edit-source',old,{display:true,texLabel:'eq:source'}),{text:''}])]),flow=host();flow.openDocument(original);await tick();const entry=flow.entries()[0],model=entry.model;
    assert.equal(flow.getFormulaSource(entry.element),old);const replacement=String.raw`\dfrac {x}{\futurecmd{y}}`;
    flow.replaceFormulaSource(entry.element,replacement);await tick();const node=allMath(flow.editor.children)[0];assert.equal(flow.entries()[0].model,model);assert.equal(node.id,'edit-source');assert.equal(node.texLabel,'eq:source');assert.equal(node.display,true);assert.equal(node.texExpression,replacement);assert.equal(flow.getFormulaSource(flow.entries()[0].element),replacement);assert.equal(flow.hasUnsavedChanges(),true);
    flow.persist();await tick();assert.equal(allMath(flow.editor.children)[0].texExpression,replacement,'saving a newly parsed representation must not canonicalize its source');
    flow.editor.tf.undo();await tick();assert.equal(flow.getFormulaSource(flow.entries()[0].element),old);assert.equal(flow.hasUnsavedChanges(),false);flow.editor.tf.redo();await tick();assert.equal(flow.getFormulaSource(flow.entries()[0].element),replacement);flow.destroy();
  });
  await t.test('source replacement participates in the existing model undo and redo history',async()=>{
    const original=source([p([{text:''},math('source-model-history','x^2'),{text:''}])]),flow=host();flow.openDocument(original);await tick();const entry=flow.entries()[0],model=entry.model,before=model.exportLatex();
    flow.replaceFormulaSource(entry.element,String.raw`\frac{a}{b}`);assert.equal(flow.entries()[0].model,model);const after=model.exportLatex();assert.notEqual(after,before);
    model.undo();flow.syncMath();await tick();assert.equal(model.exportLatex(),before);model.redo();flow.syncMath();await tick();assert.equal(model.exportLatex(),after);flow.destroy();
  });
  await t.test('confirming unchanged formula source is not an edit',async()=>{
    const tex=String.raw`\frac {a}{b}`,flow=host();flow.openDocument(source([p([{text:''},math('source-no-edit',tex),{text:''}])]));await tick();const entry=flow.entries()[0],before=flow.serializeDocument(),history=flow.editor.history.undos.length;
    flow.replaceFormulaSource(entry.element,flow.getFormulaSource(entry.element));await tick();assert.equal(flow.serializeDocument(),before);assert.equal(flow.editor.history.undos.length,history);assert.equal(flow.entries()[0].model,entry.model);assert.equal(flow.hasUnsavedChanges(),false);flow.destroy();
  });
  await t.test('a large mixed legacy document opens every formula as editable and preserves source strings',async()=>{
    const samples=[String.raw`\sigma_{\alpha}`,String.raw`\boldsymbol{\sigma}_\alpha`,String.raw`\textnormal{--}`,String.raw`\frac{\sqrt{x+1}}{a+\frac{b}{c}}`,String.raw`\operatorname{Tr}_b A`,String.raw`\futurecmd{x}`];
    const value=Array.from({length:104},(_,index)=>{
      const tex=samples[index%samples.length],extra={display:index<10,...(index<73?{snapshot:rawModel(tex).snapshot()}: {})};
      return p([{text:'Formula '+(index+1)+': '},math('mixed-formula-'+index,tex,extra),{text:'.'}]);
    });
    const original=source(value),input=JSON.parse(original),before=allMath(input.value),flow=host();flow.openDocument(original);await tick();
    const after=allMath(flow.editor.children);assert.ok(before.length>100);assert.equal(after.length,before.length);assert.equal(flow.entries().length,before.length);assert.ok(after.every(node=>typeof node.snapshot==='string'));
    assert.deepEqual(after.map(node=>node.texExpression),before.map(node=>node.texExpression));assert.equal(after.filter(node=>node.display||node.type==='equation').length,10);assert.equal(flow.hasUnsavedChanges(),false);
    flow.markDocumentSaved(original);assert.equal(flow.hasUnsavedChanges(),false,JSON.stringify(firstDifference(JSON.parse(flow.savedDocument),JSON.parse(flow.serializeDocument()))));const reopened=flow.serializeDocument();flow.openDocument(reopened);await tick();assert.equal(flow.entries().length,before.length);assert.equal(flow.hasUnsavedChanges(),false);flow.destroy();
  });
});
