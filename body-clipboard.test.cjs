const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');

test('body clipboard uses actual Slate fragment transforms without Markdown reinterpretation',async t=>{
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><html><body></body></html>');
  for(const key of ['window','document','navigator','sessionStorage','localStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  globalThis.getComputedStyle=window.getComputedStyle.bind(window);globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
  const result=await build({stdin:{contents:`export {PlateMathHost} from './src/plate-host';export {EditorModel} from './src/editor-model';export {importMath} from './src/tex-import';export {formulaNode} from './src/plate-document';export * from './src/native-clipboard';export {parseBibLibrary,parseBibLibraries} from './src/bibtex';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'clipboard-test-kit',setup(builder){builder.onLoad({filter:/components[\\/]editor[\\/]editor-kit\.tsx$/},()=>({contents:`
import {ParagraphPlugin} from 'platejs/react';import {TrailingBlockPlugin} from 'platejs';
import {BoldPlugin,ItalicPlugin} from '@platejs/basic-nodes/react';import {LinkPlugin} from '@platejs/link/react';
import {MathKit} from './plugins/math-kit';import {MarkdownKit} from './plugins/markdown-kit';import {ReferenceKit} from './plugins/reference-kit';import {FootnoteKit} from './plugins/footnote-kit';
export const EditorKit=[ParagraphPlugin,BoldPlugin,ItalicPlugin,LinkPlugin,...MathKit,...ReferenceKit,TrailingBlockPlugin,...MarkdownKit,...FootnoteKit];`,loader:'tsx',resolveDir:path.resolve('src/components/editor')}));}}]});
  const compiled=new Module(path.resolve('.body-clipboard-test.cjs'),module);compiled.paths=module.paths;compiled._compile(result.outputFiles[0].text,path.resolve('.body-clipboard-test.cjs'));
  const api=compiled.exports,tick=()=>new Promise(resolve=>setTimeout(resolve,10));
  const p=text=>({type:'p',children:[{text}]}),textOf=node=>typeof node.text==='string'?node.text:(node.children??[]).map(textOf).join('');
  const nodes=(value,type)=>value.flatMap(node=>[...(node.type===type?[node]:[]),...nodes(node.children??[],type)]);
  const flow=(value=[p('')],libraries=[])=>{sessionStorage.clear();localStorage.clear();const mount=document.createElement('div');document.body.append(mount);const host=new api.PlateMathHost(mount,new api.EditorModel(),{activate(){},leave(){},change(){}});host.openDocument(JSON.stringify({version:1,value,...(libraries.length?{bibliographyLibraries:libraries}:{})}));return host;};
  const data=initial=>{const values=new Map(Object.entries(initial??{}));return {getData:type=>values.get(type)??'',setData:(type,value)=>values.set(type,value),files:[],types:[...values.keys()]};};
  const selectAll=host=>host.editor.tf.select(host.editor.api.range([]));

  await t.test('plain body paste keeps LaTeX, Markdown and MDX verbatim; undo is one operation',async()=>{
    const host=flow([p('before ')]),editor=host.editor;
    const source=String.raw`\frac{a}{b} **bold** # heading <Thing x={1}> $x^2+y$ /insert`;
    editor.tf.select(editor.api.end([]));editor.insertData(data({'text/plain':source}));await tick();
    assert.equal(editor.api.string([]),'before '+source);assert.equal(nodes(editor.children,'inline_equation').length,0);assert.equal(nodes(editor.children,'code_block').length,0);
    assert.equal(editor.children[0].children.some(node=>node.bold),false);
    editor.tf.undo();await tick();assert.equal(editor.api.string([]),'before ');editor.tf.redo();await tick();assert.equal(editor.api.string([]),'before '+source);
    host.destroy();
  });
  await t.test('selected rich prose and nested formula copy through real legacy Slate clipboard methods',async()=>{
    const model=api.importMath(String.raw`\frac{a}{\sqrt{x}}`);assert.ok(model);
    const formula=api.formulaNode(model),source=flow([{type:'p',children:[{text:'not copied '},{text:'selected',bold:true},{text:' '},formula,{text:' suffix'}]},p('private second paragraph')]);
    await tick();
    source.editor.tf.select({anchor:{path:[0,1],offset:0},focus:{path:[0,4],offset:0}});
    source.mounts.get(formula.id).append(document.createElement('mjx-container'));
    const clipboard=data();source.editor.setFragmentData(clipboard,'copy');
    assert.equal(clipboard.getData('text/plain'),'selected '+String.raw`\(\frac{a}{\sqrt{x}}\)`);
    assert.doesNotMatch(clipboard.getData('text/html'),/mjx-container|data-slate|private second|not copied/);
    const captured=JSON.parse(clipboard.getData(api.nativeClipboardMime));assert.equal(captured.kind,'document');assert.equal(captured.value.length,1);
    const target=flow([p('A B')]);target.editor.tf.select({path:[0,0],offset:2});target.editor.insertData(clipboard);await tick();
    const pasted=nodes(target.editor.children,'inline_equation');assert.equal(pasted.length,1);assert.notEqual(pasted[0].id,formula.id);
    assert.equal(pasted[0].texExpression,formula.texExpression);assert.equal(JSON.parse(pasted[0].snapshot).root.items[0].type,'frac');
    assert.ok(target.editor.children[0].children.some(node=>node.text==='selected'&&node.bold));assert.match(textOf(target.editor.children[0]),/^A selected B$/);
    target.editor.tf.undo();await tick();assert.equal(target.editor.api.string([]),'A B');assert.equal(nodes(target.editor.children,'inline_equation').length,0);
    target.editor.tf.redo();await tick();assert.equal(nodes(target.editor.children,'inline_equation').length,1);
    source.destroy();target.destroy();
  });
  await t.test('HTML marker preserves native structure when a browser strips custom MIME',async()=>{
    const model=api.importMath('x^2+y'),node=api.formulaNode(model),source=flow([{type:'p',children:[{text:''},node,{text:''}]}]);selectAll(source);
    const original=data();source.editor.setFragmentData(original,'copy');
    const target=flow();target.editor.tf.select(target.editor.api.end([]));target.editor.insertData(data({'text/html':original.getData('text/html'),'text/plain':original.getData('text/plain')}));await tick();
    const pasted=nodes(target.editor.children,'inline_equation')[0];assert.ok(pasted.snapshot);assert.equal(pasted.texExpression,node.texExpression);source.destroy();target.destroy();
  });
  await t.test('external rich HTML preserves marks and explicit math annotations; unsupported TeX survives unchanged',async()=>{
    const host=flow(),editor=host.editor;editor.tf.select(editor.api.end([]));
    editor.insertData(data({'text/html':'<p><strong>Rich</strong> <em>text</em> <a href="https://example.org/">link</a> <math><semantics><mi>x</mi><annotation encoding="application/x-tex">\\futurecmd{a}{b}</annotation></semantics></math><script>BAD</script></p>','text/plain':'wrong fallback'}));await tick();
    assert.match(editor.api.string([]),/Rich text link/);assert.doesNotMatch(editor.api.string([]),/BAD|wrong fallback/);
    const leaves=editor.children[0].children;assert.ok(leaves.some(node=>node.text==='Rich'&&node.bold));assert.ok(leaves.some(node=>node.text==='text'&&node.italic));
    assert.equal(nodes(editor.children,'a')[0].url,'https://example.org/');const math=nodes(editor.children,'inline_equation')[0];assert.ok(math);assert.equal(math.texExpression,String.raw`\futurecmd{a}{b}`);
    editor.tf.undo();await tick();assert.equal(editor.api.string([]),'');host.destroy();
  });
  await t.test('malformed native clipboard is rejected atomically and falls back to literal plain text',async()=>{
    const host=flow([p('safe ')]),editor=host.editor;editor.tf.select(editor.api.end([]));
    editor.insertData(data({[api.nativeClipboardMime]:'{"version":1,"kind":"document","value":[{"type":"inline_equation","snapshot":"bad"}]}','text/html':'<p><b>stale HTML</b></p>','text/plain':String.raw`\frac{a}{b}`}));await tick();
    assert.equal(editor.api.string([]),String.raw`safe \frac{a}{b}`);assert.equal(nodes(editor.children,'inline_equation').length,0);assert.equal(host.getBibliographyLibraries().length,0);
    editor.tf.undo();await tick();assert.equal(editor.api.string([]),'safe ');host.destroy();
  });
  await t.test('opening source TeX and moving its caret preserve the original spelling until a content edit',async()=>{
    const source=String.raw`\{\varphi_\alpha\}`,host=flow([{type:'p',children:[{text:''},{type:'inline_equation',id:'source-spelling',texExpression:source,numbered:false,children:[{text:''}]},{text:''}]}]);await tick();
    const model=host.models.get('source-spelling');assert.ok(model);
    assert.equal(nodes(host.editor.children,'inline_equation')[0].texExpression,source);
    model.setCursor(model.root.id,model.root.items.length);host.persist();
    assert.equal(nodes(host.editor.children,'inline_equation')[0].texExpression,source,'saving only a caret change is not a TeX conversion');
    model.insert('+z');host.syncMath();assert.equal(nodes(host.editor.children,'inline_equation')[0].texExpression,model.exportLatex());
    host.destroy();
  });
  await t.test('copying citations carries only cited records and merges them without writing the full source cache',async()=>{
    const library={id:'source-library',name:'Test',source:'@article{kept,title={Kept},author={A, B},year={2020}}\n@article{uncopied,title={Private},year={2021}}'};
    const source=flow([{type:'p',children:[{text:'Citation '},{type:'tex_reference',id:'citation',command:'cite',keys:['kept'],children:[{text:''}]},{text:''}]}],[library]);
    selectAll(source);const clipboard=data();source.editor.setFragmentData(clipboard,'copy');const captured=JSON.parse(clipboard.getData(api.nativeClipboardMime));
    assert.equal(captured.bibliographyLibraries.length,1);assert.match(captured.bibliographyLibraries[0].source,/kept/);assert.doesNotMatch(captured.bibliographyLibraries[0].source,/uncopied|Private/);
    const target=flow();const cacheKey='vulgar-notes-bibliography-library-catalog-v1',cacheBefore=localStorage.getItem(cacheKey);target.editor.tf.select(target.editor.api.end([]));target.editor.insertData(clipboard);await tick();
    const saved=JSON.parse(target.serializeDocument());assert.equal(saved.bibliographyLibraries.length,1);assert.match(saved.bibliographyLibraries[0].source,/kept/);assert.doesNotMatch(saved.bibliographyLibraries[0].source,/uncopied/);assert.equal(localStorage.getItem(cacheKey),cacheBefore);
    target.editor.tf.undo();await tick();assert.equal(JSON.parse(target.serializeDocument()).bibliographyLibraries,undefined);target.editor.tf.redo();await tick();assert.equal(JSON.parse(target.serializeDocument()).bibliographyLibraries.length,1);
    source.destroy();target.destroy();
  });
  await t.test('math fragment pasted into prose preserves its native snapshot without converting to LaTeX',async()=>{
    const model=api.importMath(String.raw`\frac{a}{\sqrt{x}}`);const clipboard=data();
    api.writeNativeClipboard(clipboard,{version:1,kind:'math',snapshot:model.snapshot()});
    const target=flow([p('before after')]);target.editor.tf.select({path:[0,0],offset:7});target.editor.insertData(clipboard);await tick();
    const pasted=nodes(target.editor.children,'inline_equation')[0];assert.ok(pasted);assert.equal(JSON.stringify(JSON.parse(pasted.snapshot).root),JSON.stringify(JSON.parse(model.snapshot()).root));assert.equal(textOf(target.editor.children[0]),'before after');target.destroy();
  });
  await t.test('copying a target and its reference within one document remaps both; reference-only keeps original target',async()=>{
    const math=api.formulaNode(api.importMath('x^2'));math.texLabel='eq:test';
    const reference={type:'tex_reference',id:'original-ref',command:'eqref',keys:['eq:test'],children:[{text:''}]};
    const host=flow([{type:'p',children:[{text:''},math,{text:' see '},reference,{text:''}]}]);await tick();selectAll(host);const clipboard=data();host.editor.setFragmentData(clipboard,'copy');
    host.editor.tf.select(host.editor.api.end([]));host.editor.insertData(clipboard);await tick();
    const formulas=nodes(host.editor.children,'inline_equation'),references=nodes(host.editor.children,'tex_reference');assert.equal(formulas.length,2);assert.notEqual(formulas[1].id,formulas[0].id);assert.notEqual(formulas[1].texLabel,formulas[0].texLabel);assert.deepEqual(references[1].keys,[formulas[1].texLabel]);
    const originalPath=host.editor.api.findPath(references[0]);host.editor.tf.select(host.editor.api.range(originalPath));const referenceOnly=data();host.editor.setFragmentData(referenceOnly,'copy');host.editor.tf.select(host.editor.api.end([]));host.editor.insertData(referenceOnly);await tick();
    assert.deepEqual(nodes(host.editor.children,'tex_reference').at(-1).keys,['eq:test']);host.destroy();
  });
  await t.test('cross-document endnote reference copies its definition and nested citation in one undo batch',async()=>{
    const library={id:'note-library',name:'Notes',source:'@article{nested,title={Nested citation},year={2022}}'};
    const note={type:'footnoteDefinition',id:'note-definition',identifier:'note-a',children:[{type:'p',children:[{text:'Note text '},{type:'tex_reference',id:'nested-ref',command:'cite',keys:['nested'],children:[{text:''}]},{text:''}]}]};
    const source=flow([{type:'p',children:[{text:'Body '},{type:'footnoteReference',id:'note-ref',identifier:'note-a',children:[{text:''}]},{text:''}]},note],[library]);await tick();
    source.editor.tf.select(source.editor.api.range([0]));const clipboard=data();source.editor.setFragmentData(clipboard,'copy');
    const native=JSON.parse(clipboard.getData(api.nativeClipboardMime));assert.equal(native.value.length,1);assert.equal(native.endnoteDefinitions.length,1);
    const target=flow([p('Target ')]);target.editor.tf.select(target.editor.api.end([]));target.editor.insertData(clipboard);await tick();
    const definitions=nodes(target.editor.children,'footnoteDefinition'),references=nodes(target.editor.children,'footnoteReference');assert.equal(definitions.length,1);assert.equal(references.length,1);assert.equal(references[0].identifier,definitions[0].identifier);assert.match(textOf(definitions[0]),/Note text/);assert.equal(JSON.parse(target.serializeDocument()).bibliographyLibraries.length,1);
    target.editor.tf.undo();await tick();assert.equal(target.editor.api.string([]),'Target ');assert.equal(nodes(target.editor.children,'footnoteDefinition').length,0);assert.equal(JSON.parse(target.serializeDocument()).bibliographyLibraries,undefined);
    target.editor.tf.redo();await tick();assert.equal(nodes(target.editor.children,'footnoteDefinition').length,1);
    source.editor.tf.select(source.editor.api.end([0]));source.editor.insertData(clipboard);await tick();assert.equal(nodes(source.editor.children,'footnoteDefinition').length,1,'pasting the reference back reuses its existing local definition');
    source.destroy();target.destroy();
  });
  await t.test('actual editor cut event writes native data and removes the selected object in a separate undo batch',async()=>{
    const math=api.formulaNode(api.importMath('x^2')),host=flow([{type:'p',children:[{text:'keep '},math,{text:' tail'}]}]);await tick();
    host.editor.tf.select(host.editor.api.end([]));host.editor.tf.insertText(' edited');await tick();
    host.editor.tf.select({anchor:{path:[0,0],offset:5},focus:{path:[0,2],offset:0}});
    const clipboard=new window.DataTransfer(),event=new window.ClipboardEvent('cut',{bubbles:true,cancelable:true,clipboardData:clipboard});
    host.mount.querySelector('[data-slate-editor]').dispatchEvent(event);await tick();
    assert.equal(event.defaultPrevented,true);assert.ok(clipboard.getData(api.nativeClipboardMime));assert.equal(nodes(host.editor.children,'inline_equation').length,0);assert.equal(host.editor.api.string([]),'keep  tail edited');
    host.editor.tf.undo();await tick();assert.equal(nodes(host.editor.children,'inline_equation').length,1);assert.match(host.editor.api.string([]),/edited$/,'undo cut does not also undo the earlier edit');host.destroy();
  });
  await t.test('cross-document bibliography key conflicts preserve both records and redirect only pasted citations',async()=>{
    const citation=id=>({type:'tex_reference',id,command:'cite',keys:['same'],children:[{text:''}]}),library=(id,title)=>({id,name:id,source:'@article{same,title={'+title+'},year={2020}}'});
    const source=flow([{type:'p',children:[{text:'Source '},citation('source-ref'),{text:''}]}],[library('source','Source record')]);selectAll(source);const clipboard=data();source.editor.setFragmentData(clipboard,'copy');
    const target=flow([{type:'p',children:[{text:'Target '},citation('target-ref'),{text:''}]}],[library('target','Target record')]);target.editor.tf.select(target.editor.api.end([]));target.editor.insertData(clipboard);await tick();
    const refs=nodes(target.editor.children,'tex_reference');assert.equal(refs[0].keys[0],'same');assert.notEqual(refs[1].keys[0],'same');
    const saved=JSON.parse(target.serializeDocument()),entries=api.parseBibLibraries(saved.bibliographyLibraries);assert.equal(entries.length,2);assert.equal(entries.find(entry=>entry.key==='same').title,'Target record');assert.equal(entries.find(entry=>entry.key===refs[1].keys[0]).title,'Source record');source.destroy();target.destroy();
  });
  await t.test('unsafe bibliography macro merge leaves content, libraries and undo history unchanged',async()=>{
    const sourceLibrary={id:'macros',name:'Macros',source:'@preamble{"\\newcommand{\\example}{Example}"}\n@article{new,title={New},year={2020}}'};
    const source=flow([{type:'p',children:[{text:'Pasted '},{type:'tex_reference',id:'macro-ref',command:'cite',keys:['new'],children:[{text:''}]},{text:''}]}],[sourceLibrary]);selectAll(source);const clipboard=data();source.editor.setFragmentData(clipboard,'copy');assert.ok(clipboard.getData(api.nativeClipboardMime));
    const target=flow([p('Unchanged')],[{id:'existing',name:'Existing',source:'@article{old,title={Old},year={2019}}'}]);target.editor.tf.select(target.editor.api.end([]));const before=target.serializeDocument(),history=target.editor.history.undos.length,libraries=JSON.stringify(target.getBibliographyLibraries());
    assert.doesNotThrow(()=>target.editor.insertData(clipboard));await tick();assert.equal(target.serializeDocument(),before);assert.equal(JSON.stringify(target.getBibliographyLibraries()),libraries);assert.equal(target.editor.history.undos.length,history);source.destroy();target.destroy();
  });
  await t.test('cut never removes content if writing clipboard data fails',async()=>{
    const math=api.formulaNode(api.importMath('x^2')),host=flow([{type:'p',children:[{text:'keep '},math,{text:' tail'}]}]);await tick();selectAll(host);
    const clipboard=new window.DataTransfer();clipboard.setData=()=>{throw Error('Clipboard unavailable');};
    const before=host.serializeDocument(),event=new window.ClipboardEvent('cut',{bubbles:true,cancelable:true,clipboardData:clipboard});host.mount.querySelector('[data-slate-editor]').dispatchEvent(event);await tick();
    assert.equal(event.defaultPrevented,true);assert.equal(host.serializeDocument(),before);assert.equal(nodes(host.editor.children,'inline_equation').length,1);host.destroy();
  });
});
