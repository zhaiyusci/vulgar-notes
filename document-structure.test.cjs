const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const p=text=>({type:'p',children:[{text}]});
const metadata={title:'Title & 标题',authors:[{name:'Alice',affiliation:'A & B University',email:'a_b@example.org'},{name:'张三',affiliation:'研究所',email:'c@example.org'}]};

test('document structures persist, resolve and export through the real host',async t=>{
  const {Window}=await import('happy-dom');const window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><html><body></body></html>');
  for(const key of ['window','document','navigator','sessionStorage','localStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  globalThis.getComputedStyle=window.getComputedStyle.bind(window);globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
  const result=await build({stdin:{contents:`export {PlateMathHost} from './src/plate-host';export {EditorModel} from './src/editor-model';export {parseDocumentEnvelope} from './src/plate-document';export {createMetadataBlock,createMetadataEntry,metadataIndex} from './src/document-metadata';export {documentOutline} from './src/document-outline';export {latexDocument} from './src/latex-document';export {createFigure,createTableFloat,floatBody,floatCaption} from './src/document-floats';export {referenceTargets,resolveReference} from './src/references';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'structure-test-kit',setup(builder){builder.onLoad({filter:/components[\\/]editor[\\/]editor-kit\.tsx$/},()=>({contents:`
import React from 'react';
import {ParagraphPlugin,createPlatePlugin,PlateElement} from 'platejs/react';
import {TrailingBlockPlugin} from 'platejs';
import {ImagePlugin} from '@platejs/media/react';
import {TablePlugin,TableRowPlugin,TableCellPlugin,TableCellHeaderPlugin} from '@platejs/table/react';
import {MathKit} from './plugins/math-kit';import {MarkdownKit} from './plugins/markdown-kit';import {ReferenceKit} from './plugins/reference-kit';import {FootnoteKit} from './plugins/footnote-kit';import {FloatKit} from './plugins/float-kit';import {TocKit} from './plugins/toc-kit';import {MetadataKit} from './plugins/metadata-kit';
const component=tag=>props=><PlateElement {...props} as={tag}>{props.children}</PlateElement>;
export const EditorKit=[ParagraphPlugin,...Array.from({length:6},(_,i)=>createPlatePlugin({key:'h'+(i+1),node:{isElement:true,component:component('h'+(i+1))}})),ImagePlugin.withComponent(component('div')),TablePlugin.withComponent(component('table')),TableRowPlugin.withComponent(component('tr')),TableCellPlugin.withComponent(component('td')),TableCellHeaderPlugin.withComponent(component('th')),...MathKit,...ReferenceKit,...FloatKit,...TocKit,...MetadataKit,TrailingBlockPlugin,...MarkdownKit,...FootnoteKit];`,loader:'tsx',resolveDir:path.resolve('src/components/editor')}));}}]});
  const compiled=new Module(path.resolve('.document-structure-test.cjs'),module);compiled.paths=module.paths;compiled._compile(result.outputFiles[0].text,path.resolve('.document-structure-test.cjs'));
  const api=compiled.exports,tick=()=>new Promise(resolve=>setTimeout(resolve,15));
  const host=()=>{localStorage.clear();const mount=document.createElement('div');document.body.append(mount);return new api.PlateMathHost(mount,new api.EditorModel(),{activate(){},leave(){},change(){}});};

  const freeMetadata=()=>({...api.createMetadataBlock(),children:[
    {type:'h1',children:[{text:'Title & 标题',bold:true}]},
    {type:'p',children:[{text:'Alice',bold:true},{text:' and 张三'}]},
    p('A & B University / 研究所'),{...p('a_b@example.org; c@example.org'),align:'right'},
    {type:'p',children:[{text:'These authors contributed equally.',italic:true}]},
  ]});
  const entry=(role,id,children,links={})=>({...api.createMetadataEntry(role),id,...links,children});
  const semanticMetadata=()=>({...api.createMetadataBlock(),id:'metadata-semantic',children:[
    entry('title','title-main',[{type:'p',children:[{text:'A & B ',bold:true},{type:'inline_equation',texExpression:'x^2',numbered:false,children:[{text:''}]}]}],{noteIds:['note-funding']}),
    entry('author','author-alice',[p('Alice')],{affiliationIds:['aff-shared','aff-second'],noteIds:['note-equal','note-email']}),
    entry('author','author-zhang',[p('张三')],{affiliationIds:['aff-shared'],noteIds:['note-equal']}),
    entry('affiliation','aff-shared',[p('A & B University')]),
    entry('affiliation','aff-second',[p('研究所')]),
    entry('note','note-funding',[p('Supported by grant A_1.')]),
    entry('note','note-equal',[{type:'p',children:[{text:'These authors contributed equally.',italic:true}]}]),
    entry('note','note-email',[p('Correspondence: a_b@example.org')]),
    entry('text','text-extra',[{...p('A freely formatted extra line.'),align:'right'}]),
  ]});
  const textOf=node=>typeof node.text==='string'?node.text:(node.children||[]).map(textOf).join('');

  await t.test('free metadata is editable rich text in the document and uses normal dirty state and undo',async()=>{
    const flow=host(),block=freeMetadata();
    flow.openDocument(JSON.stringify({version:1,value:[block,{type:'h1',texLabel:'sec:body',children:[{text:'Body section'}]},p('Body prose')]}));await tick();
    assert.equal(flow.hasUnsavedChanges(),false);
    const saved=flow.serializeDocument(),envelope=JSON.parse(saved),parsed=api.parseDocumentEnvelope(saved);
    assert.equal(envelope.metadata,undefined);assert.equal(parsed.metadata,undefined);
    assert.equal(envelope.value[0].type,'document_metadata');assert.equal(envelope.value[0].children[0].children[0].bold,true);
    assert.equal(envelope.value[0].children[3].align,'right');
    assert.equal(envelope.value[0].children[4].children[0].italic,true);
    assert.match(flow.mount.querySelector('[data-slate-editor]').textContent,/These authors contributed equally\./);
    assert.deepEqual(api.documentOutline(flow.editor.children).map(({title,number})=>({title,number})),[{title:'Body section',number:'1'}],'metadata headings are not body sections');
    assert.equal(api.referenceTargets(flow.editor.children).filter(target=>target.kind==='heading').length,1);
    flow.editor.tf.select({path:[0,4,0],offset:'These authors contributed equally.'.length});
    flow.editor.tf.withNewBatch(()=>flow.editor.tf.insertText(' Corresponding authors.'));await tick();
    assert.equal(flow.hasUnsavedChanges(),true);assert.match(flow.serializeDocument(),/Corresponding authors/);
    flow.editor.tf.undo();await tick();assert.equal(flow.serializeDocument(),saved);assert.equal(flow.hasUnsavedChanges(),false);
    flow.editor.tf.redo();await tick();assert.equal(flow.hasUnsavedChanges(),true);
    flow.openDocument(JSON.stringify({version:1,value:[p('Other document')]}));await tick();
    assert.equal(flow.editor.children.some(node=>node.type==='document_metadata'),false);
    assert.doesNotMatch(flow.mount.querySelector('[data-slate-editor]').textContent,/These authors contributed equally/);
    assert.equal(flow.hasUnsavedChanges(),false);assert.equal(JSON.parse(flow.serializeDocument()).metadata,undefined);flow.destroy();
  });

  await t.test('old title and author fields migrate once, preserve existing free metadata, and reopen clean',async()=>{
    const flow=host(),existing={...api.createMetadataBlock(),children:[p('These authors contributed equally.')]};
    const oldSource=JSON.stringify({version:1,value:[existing,p('Existing body')],metadata});
    const first=api.parseDocumentEnvelope(oldSource),again=api.parseDocumentEnvelope(oldSource);
    assert.deepEqual(first,again,'old file migration has a deterministic saved baseline');
    assert.equal(first.metadata,undefined);assert.equal(first.value.filter(node=>node.type==='document_metadata').length,2);
    flow.openDocument(oldSource);await tick();assert.equal(flow.hasUnsavedChanges(),false);
    const saved=flow.serializeDocument(),serialized=JSON.parse(saved),blocks=serialized.value.filter(node=>node.type==='document_metadata');
    assert.equal(serialized.metadata,undefined);assert.equal(blocks.length,2);
    const entries=blocks[0].children.filter(node=>node.type==='metadata_entry');
    assert.equal(entries.filter(node=>node.role==='title').length,1);assert.equal(textOf(entries.find(node=>node.role==='title')),metadata.title);
    assert.deepEqual(entries.filter(node=>node.role==='author').map(textOf),['Alice','张三']);
    const affiliations=entries.filter(node=>node.role==='affiliation'),notes=entries.filter(node=>node.role==='note');
    assert.deepEqual(affiliations.map(textOf),['A & B University','研究所']);assert.deepEqual(notes.map(textOf),['a_b@example.org','c@example.org']);
    for(const [index,author] of entries.filter(node=>node.role==='author').entries()){
      assert.deepEqual(author.affiliationIds,[affiliations[index].id]);assert.deepEqual(author.noteIds,[notes[index].id]);
    }
    assert.equal(blocks[1].children[0].children[0].text,'These authors contributed equally.');
    flow.openDocument(saved);await tick();assert.equal(flow.hasUnsavedChanges(),false);assert.equal(flow.serializeDocument(),saved);
    assert.equal(flow.editor.children.filter(node=>node.type==='document_metadata').length,2,'opening a migrated file does not add a duplicate block');flow.destroy();
  });

  await t.test('old documents with titles in multiple metadata blocks retain one semantic title without losing later rich content or notes',async()=>{
    const firstTitle=entry('title','title-first',[{type:'p',children:[{text:'Primary title',bold:true}]}],{noteIds:['note-first']}),secondTitle=entry('title','title-second',[{...p('Secondary title retained'),align:'right',children:[{text:'Secondary title retained',italic:true}]}],{noteIds:['note-second']});
    const firstNote=entry('note','note-first',[p('Funding for the primary title.')]),secondNote=entry('note','note-second',[{type:'p',children:[{text:'A retained note for the secondary title.',bold:true}]}]);
    const value=[{...api.createMetadataBlock(),id:'metadata-first',children:[firstTitle,firstNote]},p('Between the metadata blocks.'),{...api.createMetadataBlock(),id:'metadata-second',children:[secondTitle,secondNote]},{type:'h1',children:[{text:'Body section'}]},p('Body prose')];
    // This represents an already saved native file, including ordinary block IDs.
    const addIds=(nodes,parent='saved')=>nodes.forEach((node,index)=>{if(node.type&&!node.id)node.id=parent+'-'+index;if(node.children)addIds(node.children,parent+'-'+index);});addIds(value);
    const originalSource=JSON.stringify({version:1,value}),flow=host();flow.openDocument(originalSource);await tick();
    const opened=flow.editor.children,blocks=opened.filter(node=>node.type==='document_metadata');
    assert.equal(blocks[0].children.find(node=>node.id===firstTitle.id).role,'title');assert.equal(blocks[1].children.find(node=>node.id===secondTitle.id).role,'text');
    assert.deepEqual(blocks[0].children,[firstTitle,firstNote]);assert.deepEqual(blocks[1].children,[secondNote,{...secondTitle,role:'text'}],'the extra title role changes and stable metadata grouping puts notes before text; IDs, marks, paragraphs and noteIds stay intact');
    flow.markDocumentSaved(originalSource);assert.equal(flow.hasUnsavedChanges(),false,'the original old-file baseline compares against the same title normalization');
    const saved=flow.serializeDocument();flow.openDocument(saved);await tick();assert.equal(flow.serializeDocument(),saved);assert.equal(flow.hasUnsavedChanges(),false);
    const entries=flow.editor.children.filter(node=>node.type==='document_metadata').flatMap(node=>node.children);
    assert.equal(entries.filter(node=>node.role==='title').length,1);assert.equal(entries.filter(node=>node.id==='title-second').length,1);assert.equal(entries.filter(node=>node.role==='note').length,2);
    assert.deepEqual(api.documentOutline(flow.editor.children).map(item=>item.title),['Body section']);
    const markdown=flow.exportMarkdown();assert.match(markdown,/^# \*\*Primary title\*\*/m);assert.match(markdown,/_Secondary title retained_/);assert.doesNotMatch(markdown,/^#{1,6} .*Secondary title retained/m);
    assert.match(markdown,/Funding for the primary title\./);assert.match(markdown,/A retained note for the secondary title\./);
    const latex=api.latexDocument(api.parseDocumentEnvelope(saved).value,[],'simple');assert.equal((latex.match(/\\title\{/g)||[]).length,1);
    const titleStart=latex.indexOf('\\title{'),titleEnd=latex.indexOf('\\author',titleStart),titleCommand=latex.slice(titleStart,titleEnd);
    assert.match(titleCommand,/Primary title/);assert.doesNotMatch(titleCommand,/Secondary title retained/);
    const body=latex.slice(latex.indexOf('\\begin{document}'));assert.match(body,/Secondary title retained/);assert.match(body,/A retained note for the secondary title\./);assert.doesNotMatch(body,/\\section\{[^}]*Secondary title retained/);
    assert.equal(flow.serializeDocument(),saved,'export keeps the demoted entry and all note links intact');flow.destroy();
  });

  await t.test('scattered legacy metadata normalizes into stable role groups and real author/affiliation reordering retains links, history and current export numbers',async()=>{
    const alice=entry('author','author-group-alice',[{type:'p',children:[{text:'Alice',bold:true}]}],{affiliationIds:['aff-group-x','aff-group-y'],noteIds:['note-group-shared']}),zhang=entry('author','author-group-zhang',[{type:'p',children:[{text:'Zhang',italic:true}]}],{affiliationIds:['aff-group-x'],noteIds:['note-group-shared']}),bob=entry('author','author-group-bob',[p('Bob')],{affiliationIds:['aff-group-y'],noteIds:['note-group-bob']});
    const block={...api.createMetadataBlock(),id:'metadata-author-group',children:[
      entry('title','title-group',[p('A semantic title')]),entry('text','text-group-before',[p('Before the authors')]),alice,
      entry('affiliation','aff-group-x',[p('Institute X')]),entry('note','note-group-shared',[p('These authors contributed equally.')]),zhang,
      entry('text','text-group-between',[p('Keep this free paragraph')]),entry('affiliation','aff-group-y',[p('Institute Y')]),bob,
      entry('note','note-group-bob',[p('Bob correspondence note.')]),entry('text','text-group-after',[p('After the authors')]),
    ]};
    const value=[block,{type:'h1',children:[{text:'Body section'}]},p('Body prose')];
    const addIds=(nodes,parent='author-order-saved')=>nodes.forEach((node,index)=>{if(node.type&&!node.id)node.id=parent+'-'+index;if(node.children)addIds(node.children,parent+'-'+index);});addIds(value);
    const originalSource=JSON.stringify({version:1,value}),originalById=new Map(block.children.map(node=>[node.id,node]));
    const expectedIds=['title','author','affiliation','note','text'].flatMap(role=>block.children.filter(node=>node.role===role).map(node=>node.id));
    const flow=host();flow.openDocument(originalSource);await tick();
    const normalized=flow.editor.children[0];assert.deepEqual(normalized.children.slice(1,4).map(node=>node.id),[alice.id,zhang.id,bob.id]);
    assert.deepEqual(normalized.children.map(node=>node.id),expectedIds,'each role group is contiguous and preserves its original within-group order');
    for(const node of normalized.children)assert.deepEqual(node,originalById.get(node.id),'normalization moves the existing rich entry without rebuilding it');
    flow.markDocumentSaved(originalSource);assert.equal(flow.hasUnsavedChanges(),false);
    const saved=flow.serializeDocument();flow.openDocument(saved);await tick();assert.equal(flow.serializeDocument(),saved);assert.equal(flow.hasUnsavedChanges(),false);
    const indexOf=id=>flow.editor.children[0].children.findIndex(node=>node.id===id);
    flow.editor.tf.withNewBatch(()=>{
      flow.editor.tf.moveNodes({at:[0,indexOf(bob.id)],to:[0,indexOf(alice.id)]});
      flow.editor.tf.moveNodes({at:[0,indexOf('aff-group-y')],to:[0,indexOf('aff-group-x')]});
    });await tick();
    assert.equal(flow.hasUnsavedChanges(),true);assert.deepEqual(flow.editor.children[0].children.filter(node=>node.role==='author').map(node=>node.id),[bob.id,alice.id,zhang.id]);
    for(const node of flow.editor.children[0].children)assert.deepEqual(node,originalById.get(node.id),'reordering changes order, not IDs, marks or stored relation arrays');
    const after=flow.serializeDocument(),numbers=api.metadataIndex(flow.editor.children[0]);
    assert.equal(numbers.affiliationNumbers.get('aff-group-y'),1);assert.equal(numbers.affiliationNumbers.get('aff-group-x'),2);assert.equal(numbers.noteNumbers.get('note-group-bob'),1);assert.equal(numbers.noteNumbers.get('note-group-shared'),2);
    const markdown=flow.exportMarkdown();assert.ok(markdown.indexOf('Bob')<markdown.indexOf('**Alice**'));assert.ok(markdown.indexOf('**Alice**')<markdown.indexOf('_Zhang_'));
    const aliceMarkdown=markdown.slice(markdown.indexOf('**Alice**'),markdown.indexOf('_Zhang_'));
    assert.ok(aliceMarkdown.includes('[1](#vn-metadata-aff-group-y)'));assert.ok(aliceMarkdown.includes('[2](#vn-metadata-aff-group-x)'));
    assert.ok(aliceMarkdown.indexOf('[1](#vn-metadata-aff-group-y)')<aliceMarkdown.indexOf('[2](#vn-metadata-aff-group-x)'),'displayed affiliation marks follow current numbers, independently of stored ID-array order');
    const latex=api.latexDocument(api.parseDocumentEnvelope(after).value,[],'simple');
    assert.match(latex,/\\author\[1\]\{Bob/);assert.match(latex,/\\author\[1,2\]\{\\textbf\{Alice\}/);assert.match(latex,/\\author\[2\]\{\\emph\{Zhang\}/);
    assert.ok(latex.indexOf('\\author[1]{Bob')<latex.indexOf('\\author[1,2]{\\textbf{Alice}'));assert.ok(latex.indexOf('\\author[1,2]{\\textbf{Alice}')<latex.indexOf('\\author[2]{\\emph{Zhang}'));
    assert.match(latex,/\\affil\[1\]\{Institute Y\}/);assert.match(latex,/\\affil\[2\]\{Institute X\}/);assert.match(latex,/\\protect\\footnotemark\[2\]/);
    assert.equal(flow.serializeDocument(),after,'export preserves the reordered tree and stable ID relations');
    flow.editor.tf.undo();await tick();assert.equal(flow.serializeDocument(),saved);assert.equal(flow.hasUnsavedChanges(),false);
    flow.editor.tf.redo();await tick();assert.equal(flow.serializeDocument(),after);assert.equal(flow.hasUnsavedChanges(),true);
    flow.markDocumentSaved(after);flow.openDocument(after);await tick();assert.equal(flow.serializeDocument(),after);assert.equal(flow.hasUnsavedChanges(),false);flow.destroy();
  });

  await t.test('a third affiliation saved after notes moves before all notes in native data, real DOM and exports without changing any entry data',async()=>{
    const title=entry('title','layout-title',[p('Fixed metadata order')]),author=entry('author','layout-author',[{type:'p',children:[{text:'Layout Author',bold:true}]}],{affiliationIds:['layout-unit-c'],noteIds:['layout-note-shared','layout-note-email']});
    const a=entry('affiliation','layout-unit-a',[p('First institute')]),b=entry('affiliation','layout-unit-b',[{type:'p',children:[{text:'Second institute',italic:true}]}]),c=entry('affiliation','layout-unit-c',[p('Third institute')]);
    const firstNote=entry('note','layout-note-shared',[p('Equal contribution note.')]),lastNote=entry('note','layout-note-email',[p('Contact: layout@example.org')]);
    const intro=entry('text','layout-text-intro',[p('Free introduction retained.')]),free={...p('Free paragraph retained.'),id:'layout-free-paragraph',align:'right'},tail=entry('text','layout-text-tail',[p('Free tail retained.')]);
    const block={...api.createMetadataBlock(),id:'metadata-fixed-layout',children:[intro,title,author,a,firstNote,free,b,lastNote,c,tail]},value=[block,p('Body prose')];
    const addIds=(nodes,parent='layout-saved')=>nodes.forEach((node,index)=>{if(node.type&&!node.id)node.id=parent+'-'+index;if(node.children)addIds(node.children,parent+'-'+index);});addIds(value);
    const expected=[title,author,a,b,c,firstNote,lastNote,intro,free,tail],originalSource=JSON.stringify({version:1,value}),flow=host();
    flow.openDocument(originalSource);await tick();assert.deepEqual(flow.editor.children[0].children,expected,'only node order changes; content, IDs, marks, alignment and relation arrays are retained');
    flow.markDocumentSaved(originalSource);assert.equal(flow.hasUnsavedChanges(),false);
    const metadataDOM=flow.mount.querySelector('.document-metadata'),domEntries=[...metadataDOM.querySelectorAll('[data-metadata-entry-id]')];
    assert.deepEqual(domEntries.map(element=>element.getAttribute('data-metadata-entry-id')),expected.filter(node=>node.type==='metadata_entry').map(node=>node.id));
    assert.deepEqual(domEntries.map(element=>element.getAttribute('data-metadata-role')),['title','author','affiliation','affiliation','affiliation','note','note','text','text']);
    const freeDOM=flow.editor.api.toDOMNode(flow.editor.children[0].children.find(node=>node.id===free.id));
    assert.ok(metadataDOM.querySelector('[data-metadata-entry-id="layout-note-email"]').compareDocumentPosition(freeDOM)&Node.DOCUMENT_POSITION_FOLLOWING,'ordinary free text also follows the complete note group');
    const saved=flow.serializeDocument(),markdown=flow.exportMarkdown(),latex=api.latexDocument(api.parseDocumentEnvelope(saved).value,[],'simple');
    assert.ok(markdown.indexOf('First institute')<markdown.indexOf('Second institute'));assert.ok(markdown.indexOf('Second institute')<markdown.indexOf('Third institute'));assert.ok(markdown.indexOf('Third institute')<markdown.indexOf('Equal contribution note.'));assert.ok(markdown.indexOf('Contact: layout@example.org')<markdown.indexOf('Free introduction retained.'));
    assert.match(markdown,/\[3\]\(#vn-metadata-layout-unit-c\)/);
    assert.match(latex,/\\author\[3\]\{\\textbf\{Layout Author\}/);assert.match(latex,/\\affil\[1\]\{First institute\}/);assert.match(latex,/\\affil\[2\]\{\\emph\{Second institute\}\}/);assert.match(latex,/\\affil\[3\]\{Third institute\}/);
    assert.ok(latex.indexOf('\\affil[1]')<latex.indexOf('\\affil[2]'));assert.ok(latex.indexOf('\\affil[2]')<latex.indexOf('\\affil[3]'));
    assert.match(latex,/\\thanks\{Equal contribution note\.\}/);assert.match(latex,/Contact: layout@example\.org/);assert.match(latex,/Free paragraph retained\./);
    assert.equal(flow.serializeDocument(),saved);flow.openDocument(saved);await tick();assert.equal(flow.serializeDocument(),saved);assert.equal(flow.hasUnsavedChanges(),false);assert.equal(flow.exportMarkdown(),markdown);assert.equal(api.latexDocument(api.parseDocumentEnvelope(saved).value,[],'simple'),latex);flow.destroy();
  });

  await t.test('semantic metadata roles and shared affiliations/notes remain editable and survive native save, undo and reopen',async()=>{
    const initial=api.createMetadataBlock();assert.deepEqual(initial.children.map(node=>node.role),['title','author']);
    const flow=host();flow.openDocument(JSON.stringify({version:1,value:[semanticMetadata(),{type:'h1',children:[{text:'Body section'}]},p('Body prose')]}));await tick();
    const saved=flow.serializeDocument(),block=JSON.parse(saved).value[0];
    // Saving records the normalized editable math snapshots in this native file.
    flow.markDocumentSaved(saved);assert.equal(flow.hasUnsavedChanges(),false);
    assert.deepEqual(block.children.find(node=>node.id==='author-alice').affiliationIds,['aff-shared','aff-second']);
    assert.deepEqual(block.children.find(node=>node.id==='author-zhang').noteIds,['note-equal']);
    assert.equal(block.children.find(node=>node.id==='note-equal').children[0].children[0].italic,true);
    assert.deepEqual(api.documentOutline(flow.editor.children).map(({title,number})=>({title,number})),[{title:'Body section',number:'1'}]);
    const author=flow.mount.querySelector('[data-metadata-entry-id="author-alice"]');assert.ok(author);
    assert.equal(author.getAttribute('data-metadata-role'),'author');assert.match(author.querySelector('.metadata-entry-body').textContent,/Alice/);
    assert.equal(author.querySelector('.metadata-entry-body').closest('[contenteditable="false"]'),null,'the entry body stays ordinary editable Slate content');
    const index=flow.editor.children[0].children.findIndex(node=>node.id==='note-equal');
    flow.editor.tf.select({path:[0,index,0,0],offset:'These authors contributed equally.'.length});
    flow.editor.tf.withNewBatch(()=>flow.editor.tf.insertText(' Confirmed.'));await tick();assert.equal(flow.hasUnsavedChanges(),true);
    flow.editor.tf.undo();await tick();assert.equal(flow.serializeDocument(),saved);assert.equal(flow.hasUnsavedChanges(),false);
    flow.editor.tf.redo();await tick();assert.match(flow.serializeDocument(),/Confirmed/);
    flow.openDocument(saved);await tick();assert.equal(flow.serializeDocument(),saved);assert.equal(flow.hasUnsavedChanges(),false);
    const reopened=api.parseDocumentEnvelope(saved).value[0];assert.equal(reopened.children.find(node=>node.id==='author-zhang').noteIds[0],'note-equal');
    flow.destroy();
  });

  await t.test('semantic metadata exports native authblk title, authors, shared affiliations and reusable contribution notes',async()=>{
    const flow=host();flow.openDocument(JSON.stringify({version:1,value:[semanticMetadata(),{type:'h1',children:[{text:'Body section'}]},p('Body prose')]}));await tick();
    const saved=flow.serializeDocument(),value=api.parseDocumentEnvelope(saved).value;
    const latex=api.latexDocument(value,[],'simple');
    assert.match(latex,/\\usepackage(?:\[[^\]]*\])?\{authblk\}/);assert.match(latex,/\\title\{[\s\S]*A \\& B/);
    assert.match(latex,/\\author\[1,\s*2\]\{Alice/);assert.match(latex,/\\author\[1\]\{张三/);
    assert.match(latex,/\\affil\[1\]\{A \\& B University\}/);assert.match(latex,/\\affil\[2\]\{研究所\}/);
    assert.match(latex,/\\thanks\{/);assert.match(latex,/\\protect\\footnotemark(?:\[\d+\]|\{\d+\})/);
    assert.equal((latex.match(/These authors contributed equally\./g)||[]).length,1,'shared notes are emitted once and reused by the other author');
    assert.match(latex,/Supported by grant A\\_1\./);assert.match(latex,/Correspondence: a\\_b@example\.org/);assert.match(latex,/\\maketitle/);
    assert.match(latex,/A freely formatted extra line\./);assert.match(latex,/\\begin\{flushright\}/);
    assert.equal((latex.match(/\\section\{Body section\}/g)||[]).length,1);assert.doesNotMatch(latex,/\\section\{A \\& B/);
    const markdown=flow.exportMarkdown();for(const text of ['Alice','张三','A & B University','研究所','These authors contributed equally.','A freely formatted extra line.'])assert.ok(markdown.includes(text),text);
    assert.equal(flow.serializeDocument(),saved,'native and text exports leave semantic links and rich entry content unchanged');flow.destroy();
  });

  await t.test('invalid metadata and malformed grouped figures are rejected before replacing content',()=>{
    const flow=host();const before=flow.serializeDocument();
    for(const invalid of [null,{title:[],authors:[]},{title:'x',authors:[{name:'N',affiliation:{},email:'x'}]}]){
      assert.throws(()=>flow.openDocument(JSON.stringify({version:1,value:[p('Wrong')],metadata:invalid})),error=>error.name==='DocumentFormatError');
      assert.equal(flow.serializeDocument(),before);
    }
    assert.throws(()=>flow.openDocument(JSON.stringify({version:1,value:[{type:'document_metadata',id:'invalid',children:'not paragraphs'}]})),error=>error.name==='DocumentFormatError');
    assert.equal(flow.serializeDocument(),before);
    for(const invalidEntry of [
      {type:'metadata_entry',id:'invalid-role',role:'invented',children:[p('Keep current document')]},
      {...entry('author','invalid-links',[p('Name')]),affiliationIds:'not an array'},
      {...entry('title','invalid-notes',[p('Title')]),noteIds:[7]},
    ]){
      assert.throws(()=>flow.openDocument(JSON.stringify({version:1,value:[{...api.createMetadataBlock(),children:[invalidEntry]}]})),error=>error.name==='DocumentFormatError');
      assert.equal(flow.serializeDocument(),before);
    }
    const bad=api.createFigure(png);bad.children.pop();
    assert.throws(()=>flow.openDocument(JSON.stringify({version:1,value:[bad]})),error=>error.name==='DocumentFormatError');
    assert.equal(flow.serializeDocument(),before);flow.destroy();
  });

  await t.test('empty section titles still own their section number without a blank contents entry',()=>{
    const flow=host();flow.openDocument(JSON.stringify({version:1,value:[{type:'h1',texLabel:'sec:empty',children:[{text:''}]},p('Text'),{type:'p',children:[{type:'tex_label',texLabel:'loc:after-empty',children:[{text:''}]},{text:'After'}]}]}));
    const targets=api.referenceTargets(flow.editor.children);
    assert.equal(targets.find(target=>target.key==='sec:empty').number,'1');
    assert.equal(targets.find(target=>target.key==='loc:after-empty').number,'1');flow.destroy();
  });

  await t.test('contents, metadata and rich figure/table captions survive both real export paths',async()=>{
    const flow=host(),figure=api.createFigure(png,'A local plot'),table=api.createTableFloat(1,2);
    figure.texLabel='fig:plot';figure.children[1].children=[{text:'A & B ',bold:true},{type:'inline_equation',texExpression:'x^2',numbered:false,children:[{text:''}]}];
    table.texLabel='tab:values';api.floatBody(table).children[0].children[0].children=[p('A&B')];api.floatBody(table).children[0].children[1].children=[p('100%')];api.floatCaption(table).children=[{text:'Measured values'}];
    const headings=Array.from({length:6},(_,i)=>({type:'h'+(i+1),texLabel:'sec:level'+(i+1),children:[{text:'Level '+(i+1)}]}));
    flow.openDocument(JSON.stringify({version:1,value:[freeMetadata(),{type:'toc',children:[{text:''}]},...headings,figure,table,p('After')]}));await tick();
    const tableElement=flow.mount.querySelector('.document-float[data-float-kind="table"]');
    assert.ok(tableElement);assert.match(tableElement.querySelector('.document-float-caption').textContent,/^表1/);
    const tableChildren=tableElement.querySelector('.document-float-content').children;
    assert.equal(tableChildren[0].tagName.toLowerCase(),'figcaption');assert.equal(tableChildren[1].tagName.toLowerCase(),'table');
    const saved=flow.serializeDocument(),value=api.parseDocumentEnvelope(saved).value;
    assert.equal(value.find(n=>n.type==='float').children[1].children[0].bold,true);
    const targets=api.referenceTargets(value);
    assert.equal(targets.find(x=>x.key==='fig:plot').number,'1');assert.equal(targets.find(x=>x.key==='tab:values').number,'1');
    assert.equal(targets.find(x=>x.key==='sec:level6').number,'1.1.1.1.1.1');
    assert.equal(api.resolveReference(value,{type:'tex_reference',command:'ref',keys:['fig:plot'],children:[{text:''}]}).text,'1');
    const markdown=flow.exportMarkdown();
    assert.doesNotMatch(markdown,/^---\ntitle: |^authors: /m);assert.match(markdown,/Title & 标题/);assert.match(markdown,/Alice/);assert.match(markdown,/张三/);assert.match(markdown,/These authors contributed equally\./);
    const firstHeading=api.documentOutline(value)[0];assert.equal(firstHeading.title,'Level 1');assert.equal(firstHeading.number,'1');
    assert.ok(markdown.includes('[1 Level 1](#'+firstHeading.anchor+')'));assert.ok(markdown.includes('<a id="'+firstHeading.anchor+'"></a>'));
    assert.doesNotMatch(markdown,/vn-heading-0-0/,'metadata title has no body-outline anchor');
    assert.match(markdown,/<figure data-float-kind="figure"/);assert.match(markdown,/\*\*A & B/);assert.match(markdown,/\$x\^2\$/,'unedited caption math retains its original TeX');assert.match(markdown,/Measured values/);assert.match(markdown,/A\\?&B/);
    assert.doesNotMatch(markdown,/<toc\s*\/>/);
    const latex=api.latexDocument(value,[],'simple');
    assert.doesNotMatch(latex,/\\title\{|\\author\{|\\maketitle/);assert.match(latex,/\\tableofcontents/);
    const documentBody=latex.slice(latex.indexOf('\\begin{document}'));
    const metadataTex=documentBody.slice(0,documentBody.indexOf('\\tableofcontents'));
    assert.ok(metadataTex.includes('Title'),'free metadata remains before the body contents');
    assert.match(metadataTex,/Title \\& 标题/);assert.match(metadataTex,/Alice/);assert.match(metadataTex,/张三/);assert.match(metadataTex,/These authors contributed equally\./);
    assert.match(metadataTex,/\\begin\{flushright\}[\s\S]*a\\_b@example\.org; c@example\.org[\s\S]*\\end\{flushright\}/);
    assert.doesNotMatch(metadataTex,/\\begin\{center\}/,'the metadata container does not force alignment');
    assert.doesNotMatch(metadataTex,/\\(?:section|subsection|subsubsection|paragraph|subparagraph|subsubparagraph)\{/);assert.doesNotMatch(metadataTex,/\\addcontentsline/);
    assert.match(latex,/\\subsubparagraph\{Level 6\}\\label\{sec:level6\}/);
    assert.match(latex,/\\captionof\{figure\}\{\\textbf\{A \\& B \}\\\(\{x\}\^\{2\}\\\)\}\\label\{fig:plot\}/);
    assert.match(latex,/\\captionof\{table\}\{Measured values\}\\label\{tab:values\}/);
    assert.ok(latex.indexOf('\\captionof{table}{Measured values}')<latex.indexOf('\\begin{tabular}'));
    assert.match(latex,/A\\&B & 100\\%/);assert.match(latex,/\\includegraphics/);assert.match(latex,/filecontents\*/);
    assert.doesNotMatch(latex,/\\begin\{(?:figure|table)\}|\[htbp\]/);
    assert.equal(flow.serializeDocument(),saved,'export never rewrites document metadata, captions or node structure');
    const first=flow.editor.children.findIndex(n=>n.type==='h1');flow.editor.tf.select(flow.editor.api.range([first]));flow.editor.tf.insertText('Renamed');await tick();
    assert.match(flow.exportMarkdown(),/\[1 Renamed\]/);flow.destroy();
  });
  await window.happyDOM.close();
});
