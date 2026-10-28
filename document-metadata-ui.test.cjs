// SPDX-License-Identifier: GPL-3.0-or-later
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');

test('structured metadata edits stay in place in the real Plate editor',async t=>{
  const {Window}=await import('happy-dom');
  const window=new Window({url:'http://localhost/'});
  window.localStorage.setItem('editor.locale','en');
  const keys=['localStorage','window','document','navigator','Node','NodeFilter','Text','Document','ShadowRoot','Element','HTMLElement','SVGElement','HTMLCollection','NodeList','MutationObserver','ResizeObserver','DOMRect','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','PointerEvent','KeyboardEvent','CustomEvent','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'];
  const previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of keys)Object.defineProperty(globalThis,key,{
    configurable:true,
    value:key==='window'?window:['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key)?window[key].bind(window):window[key],
  });
  const style=window.document.createElement('style');style.textContent=require('node:fs').readFileSync('src/components/ui/metadata-node.css','utf8');window.document.head.append(style);
  const views=new Set();
  t.after(async()=>{
    for(const view of views)view.unmount();
    await window.happyDOM.abort();
    for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  });
  const compiled={exports:{}};
  const source=buildSync({
    stdin:{resolveDir:process.cwd(),sourcefile:'metadata-ui-test.tsx',loader:'tsx',contents:`
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {createPlateEditor,ParagraphPlugin,Plate,PlateContent} from 'platejs/react';
      import {LinkPlugin} from '@platejs/link/react';
      import {MetadataKit} from './src/components/editor/plugins/metadata-kit';
      import {MetadataToolbarButton} from './src/components/ui/metadata-toolbar-button';
      import {Toolbar} from './src/components/ui/toolbar';
      import {TooltipProvider} from './src/components/ui/tooltip';
      import {HostContext} from './src/plate-math-element';
      import {createMetadataBlock,createMetadataEntry} from './src/document-metadata';
      export {createMetadataBlock,createMetadataEntry,flushSync};
      export function createEditor(value){
        return createPlateEditor({plugins:[ParagraphPlugin,LinkPlugin,...MetadataKit],value});
      }
      export function mount(container,value,readOnly=false){
        const editor=createEditor(value),root=createRoot(container);let prepared=0;
        const host={readOnly,prepareTextInsertion(){prepared++;}};
        flushSync(()=>root.render(<HostContext.Provider value={host}><TooltipProvider>
          <Plate editor={editor} readOnly={readOnly}>
            <Toolbar><MetadataToolbarButton /></Toolbar>
            <PlateContent scrollSelectionIntoView={()=>{}} />
          </Plate>
        </TooltipProvider></HostContext.Provider>));
        return {editor,prepareCount:()=>prepared,unmount:()=>flushSync(()=>root.unmount())};
      }
    `},
    bundle:true,write:false,platform:'node',format:'cjs',target:'es2022',packages:'external',
  }).outputFiles[0].text;
  new Function('require','module','exports',source)(require,compiled,compiled.exports);
  const api=compiled.exports;
  const paragraph=text=>({type:'p',children:[{text}]}),plain=node=>typeof node.text==='string'?node.text:(node.children||[]).map(plain).join('');
  const tick=()=>new Promise(resolve=>setTimeout(resolve,50));
  const mount=(value,readOnly=false)=>{
    const container=document.createElement('div');document.body.append(container);
    const view=api.mount(container,value,readOnly);views.add(view);
    return {...view,container,close(){view.unmount();views.delete(view);container.remove();}};
  };
  const click=async(view,label)=>{
    const button=view.container.querySelector('button[aria-label="'+label+'"]');
    assert.ok(button,'the '+label+' action is available');
    api.flushSync(()=>button.click());await tick();
  };
  const entry=(role,text,extra={})=>({...api.createMetadataEntry(role),children:[paragraph(text)],...extra});
  const titles=editor=>editor.children.filter(node=>node.type==='document_metadata').flatMap(node=>node.children).filter(node=>node.type==='metadata_entry'&&node.role==='title');
  const entryElement=(view,id)=>view.container.querySelector('[data-metadata-entry-id="'+id+'"]');
  const openMenu=async button=>{
    assert.ok(button,'the metadata menu trigger exists');
    api.flushSync(()=>button.dispatchEvent(new window.PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,buttons:1,pointerType:'mouse'})));
    await tick();
  };
  const chooseMenu=async selector=>{
    const item=document.querySelector(selector);assert.ok(item,'the metadata menu action exists: '+selector);
    api.flushSync(()=>item.click());await tick();
  };
  const toggleAssociation=async(id,kind)=>{
    const input=document.querySelector('input[data-metadata-target-id="'+id+'"][data-metadata-association="'+kind+'"]');
    assert.ok(input,'the association checkbox exists');api.flushSync(()=>input.click());await tick();
  };

  await t.test('new metadata starts with separate title and author containers; Enter and ordinary text stay in the current entry',()=>{
    const editor=api.createEditor([api.createMetadataBlock(),paragraph('Body')]);
    assert.deepEqual(editor.children[0].children.map(node=>[node.type,node.role]),[['metadata_entry','title'],['metadata_entry','author']]);
    editor.tf.select({path:[0,0,0,0],offset:0});
    editor.tf.insertText('Title');editor.tf.insertBreak();editor.tf.insertText('Another title line');
    editor.tf.insertBreak();editor.tf.insertBreak();
    assert.equal(editor.children[0].type,'document_metadata');
    assert.deepEqual(editor.children[0].children[0].children.map(plain),['Title','Another title line','','']);
    assert.deepEqual(editor.selection.anchor.path.slice(0,2),[0,0],'Enter does not create another author or leave the current entry');
    assert.equal(plain(editor.children[0].children[1]),'');
    assert.equal(plain(editor.children[1]),'Body');
    const pasted=api.createEditor([{type:'document_metadata',id:'mixed',children:[
      {text:'A',bold:true},{type:'a',url:'https://example.test',children:[{text:'link'}]},{text:'B'},
      paragraph('C'),{text:'D',italic:true},
    ]},paragraph('After')]);
    pasted.tf.normalize({force:true});
    const blocks=pasted.children[0].children;
    assert.deepEqual(blocks.map(node=>node.type),['p','p','p']);
    assert.deepEqual(blocks.map(plain),['AlinkB','C','D']);
    assert.equal(blocks[0].children[0].bold,true);assert.equal(blocks[2].children[0].italic,true);
    assert.equal(blocks[0].children[1].url,'https://example.test');
    assert.equal(plain(pasted.children[1]),'After');
  });

  await t.test('boundary deletion preserves separate entries while paragraphs inside one entry merge normally and undo',()=>{
    const first=entry('author','Alice'),second=entry('affiliation','Institute');
    const editor=api.createEditor([{...api.createMetadataBlock(),children:[first,second]},paragraph('Body')]);
    const before=JSON.stringify(editor.children);
    editor.tf.select({path:[0,1,0,0],offset:0});editor.tf.deleteBackward('character');
    assert.equal(JSON.stringify(editor.children),before,'Backspace cannot merge an affiliation into an author');
    editor.tf.select({path:[0,0,0,0],offset:5});editor.tf.deleteForward('character');
    assert.equal(JSON.stringify(editor.children),before,'Delete cannot merge the following entry');
    editor.tf.select({path:[1,0],offset:0});editor.tf.deleteBackward('character');
    assert.equal(JSON.stringify(editor.children),before,'the adjacent body paragraph cannot consume metadata');
    editor.tf.select({path:[0,0,0,0],offset:5});
    editor.tf.withNewBatch(()=>{editor.tf.insertBreak();editor.tf.insertText('Smith');});
    editor.tf.select({path:[0,0,1,0],offset:0});
    editor.tf.withNewBatch(()=>editor.tf.deleteBackward('character'));
    assert.equal(plain(editor.children[0].children[0]),'AliceSmith');
    assert.equal(editor.children[0].children.length,2);
    editor.tf.undo();assert.deepEqual(editor.children[0].children[0].children.map(plain),['Alice','Smith']);
    const beforeRangeDeletion=JSON.stringify(editor.children);
    editor.tf.select({anchor:{path:[0,0,0,0],offset:2},focus:{path:[0,1,0,0],offset:3}});
    editor.tf.deleteFragment();
    assert.notEqual(JSON.stringify(editor.children),beforeRangeDeletion,'an explicitly selected range can delete across entries');
    assert.equal(editor.api.isCollapsed(),true);
  });

  await t.test('the toolbar creates one editable block and revisits it without replacing content',async()=>{
    const view=mount([paragraph('Existing body')]);
    await click(view,'Metadata');
    assert.equal(view.editor.children.length,2);assert.equal(view.editor.children[0].type,'document_metadata');
    assert.equal(plain(view.editor.children[1]),'Existing body');
    assert.deepEqual(view.editor.selection.anchor.path,[0,0,0,0]);
    api.flushSync(()=>{
      view.editor.tf.insertText('A free-form title');view.editor.tf.insertBreak();
      view.editor.tf.insertText('Alice and Bob contributed equally.');
    });
    await tick();
    const before=JSON.stringify(view.editor.children[0]);
    api.flushSync(()=>view.editor.tf.select(view.editor.api.start([1])));
    await click(view,'Metadata');
    assert.equal(view.editor.children.filter(node=>node.type==='document_metadata').length,1);
    assert.equal(JSON.stringify(view.editor.children[0]),before,'revisiting does not replace metadata or its formatting');
    assert.deepEqual(view.editor.selection.anchor.path,[0,0,0,0]);
    assert.equal(view.prepareCount(),2,'each toolbar action first hands focus back from the math editor');
    assert.match(view.container.querySelector('.document-metadata-body').textContent,/contributed equally/);
    view.close();
  });

  await t.test('the add menu locates the existing document title; other title conversions stay disabled until it is removed',async()=>{
    const title=entry('title','The document title'),author=entry('author','Alice');
    const other=entry('author','Bob'),old=paragraph('A free paragraph');
    const view=mount([{...api.createMetadataBlock(),children:[title,author]},paragraph('Body'),{...api.createMetadataBlock(),children:[other,old]}]);
    const addButtons=()=>view.container.querySelectorAll('.metadata-add-button');
    api.flushSync(()=>view.editor.tf.select({path:[2,0,0,0],offset:2}));await tick();
    const before=JSON.stringify(view.editor.children);
    await openMenu(addButtons()[1]);await chooseMenu('[data-metadata-add-role="title"]');
    assert.equal(JSON.stringify(view.editor.children),before,'Add Title revisits the existing title instead of creating another');
    assert.deepEqual(view.editor.selection.anchor.path,[0,0,0,0],'closing the menu does not restore the old author cursor');
    await openMenu(entryElement(view,other.id).querySelector('.metadata-role-button'));
    const disabledRole=document.querySelector('[data-metadata-set-role="title"]');
    assert.equal(disabledRole.getAttribute('aria-disabled'),'true');
    api.flushSync(()=>disabledRole.click());await tick();assert.equal(titles(view.editor).length,1);
    await openMenu(entryElement(view,other.id).querySelector('.metadata-role-button'));
    api.flushSync(()=>view.editor.tf.select({path:[2,1,0],offset:2}));await tick();
    await openMenu(addButtons()[1]);
    const disabledConversion=document.querySelector('[data-metadata-convert-role="title"]');
    assert.equal(disabledConversion.getAttribute('aria-disabled'),'true');
    api.flushSync(()=>disabledConversion.click());await tick();assert.equal(view.editor.children[2].children[1].type,'p');
    await openMenu(addButtons()[1]);
    await openMenu(entryElement(view,title.id).querySelector('.metadata-role-button'));
    const deletion=[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent==='Delete entry');
    assert.ok(deletion);api.flushSync(()=>deletion.click());await tick();
    assert.equal(titles(view.editor).length,0,'removing a title does not invent a replacement');
    await openMenu(addButtons()[0]);await chooseMenu('[data-metadata-add-role="title"]');
    assert.equal(titles(view.editor).length,1);const replacement=titles(view.editor)[0];
    assert.notEqual(replacement.id,title.id);assert.deepEqual(view.editor.selection.anchor.path,[0,0,0,0]);
    await openMenu(entryElement(view,replacement.id).querySelector('.metadata-role-button'));await chooseMenu('[data-metadata-set-role="text"]');
    assert.equal(titles(view.editor).length,0);
    await openMenu(entryElement(view,other.id).querySelector('.metadata-role-button'));
    assert.equal(document.querySelector('[data-metadata-set-role="title"]').getAttribute('aria-disabled'),null);
    await chooseMenu('[data-metadata-set-role="title"]');assert.equal(titles(view.editor)[0].id,other.id);
    await openMenu(entryElement(view,other.id).querySelector('.metadata-role-button'));await chooseMenu('[data-metadata-set-role="author"]');
    api.flushSync(()=>view.editor.tf.select({path:[2,1,0],offset:2}));await tick();
    await openMenu(addButtons()[1]);assert.equal(document.querySelector('[data-metadata-convert-role="title"]').getAttribute('aria-disabled'),null);
    await chooseMenu('[data-metadata-convert-role="title"]');assert.equal(titles(view.editor).length,1);
    assert.equal(plain(titles(view.editor)[0]),'A free paragraph');
    view.close();
  });

  await t.test('normalization preserves later title content and dormant notes as text across blocks; pasting and undo remain atomic',()=>{
    const title=entry('title','First title'),later=entry('title','Later rich title',{noteIds:['shared-note']});
    later.children[0].children=[{text:'Later ',bold:true},{text:'rich title',italic:true}];
    const note=entry('note','Shared note body',{id:'shared-note'}),author=entry('author','Bob',{noteIds:[note.id]});
    const first={...api.createMetadataBlock(),children:[title]},second={...api.createMetadataBlock(),children:[later,note,author]};
    const loaded=api.createEditor(structuredClone([first,second]));loaded.tf.normalize({force:true});
    const row=(target,id)=>target.children.find(node=>node.id===id);
    assert.equal(titles(loaded).length,1);assert.equal(row(loaded.children[1],later.id).role,'text');
    assert.deepEqual(row(loaded.children[1],later.id).noteIds,[note.id]);
    assert.deepEqual(row(loaded.children[1],later.id).children[0].children,later.children[0].children);
    assert.deepEqual(loaded.children[1].children.map(node=>node.role),['author','note','text']);
    assert.equal(plain(row(loaded.children[1],note.id)),'Shared note body');assert.deepEqual(row(loaded.children[1],author.id).noteIds,[note.id]);
    const editor=api.createEditor([first,paragraph('Body')]),before=JSON.stringify(editor.children);
    editor.tf.withNewBatch(()=>editor.tf.insertNodes(second,{at:[2]}));
    assert.equal(titles(editor).length,1);assert.equal(row(editor.children[2],later.id).role,'text');
    assert.deepEqual(row(editor.children[2],later.id).noteIds,[note.id]);
    assert.deepEqual(row(editor.children[2],later.id).children[0].children,later.children[0].children);
    editor.tf.undo();assert.equal(JSON.stringify(editor.children),before,'one undo removes both the paste and its normalization');
    editor.tf.redo();assert.equal(titles(editor).length,1);assert.equal(row(editor.children[2],later.id).role,'text');
    assert.equal(plain(row(editor.children[2],note.id)),'Shared note body');
  });

  await t.test('authors select multiple affiliations and a shared note; unresolved targets remain visible and edits undo',async()=>{
    const alice=entry('author','Alice',{affiliationIds:['missing-affiliation'],noteIds:['missing-note']});
    const bob=entry('author','Bob'),affilA=entry('affiliation','Institute A'),affilB=entry('affiliation','Laboratory B');
    const shared=entry('note','Both authors contributed equally.');
    const view=mount([{...api.createMetadataBlock(),children:[alice,bob,affilA,affilB,shared]},paragraph('Body')]);
    assert.equal(entryElement(view,alice.id).querySelector('.metadata-entry-markers').textContent,'??, ??');
    api.flushSync(()=>view.editor.tf.select({path:[0,0,0,0],offset:3}));
    await tick();
    api.flushSync(()=>entryElement(view,alice.id).querySelector('.metadata-links-button').click());await tick();
    await toggleAssociation(affilA.id,'affiliation');await toggleAssociation(affilB.id,'affiliation');await toggleAssociation(shared.id,'note');
    assert.deepEqual(view.editor.children[0].children[0].affiliationIds,['missing-affiliation',affilA.id,affilB.id]);
    assert.deepEqual(view.editor.children[0].children[0].noteIds,['missing-note',shared.id]);
    assert.equal(entryElement(view,alice.id).querySelector('.metadata-entry-markers').textContent,'1, 2, ??, *, ??');
    api.flushSync(()=>entryElement(view,alice.id).querySelector('.metadata-links-button').click());await tick();
    assert.deepEqual(view.editor.selection.anchor,{path:[0,0,0,0],offset:3},'closing the associations restores the text cursor');
    api.flushSync(()=>entryElement(view,bob.id).querySelector('.metadata-links-button').click());await tick();
    await toggleAssociation(shared.id,'note');
    assert.equal(entryElement(view,bob.id).querySelector('.metadata-entry-markers').textContent,'*');
    assert.equal(entryElement(view,shared.id).querySelector('.metadata-entry-markers').textContent,'*');
    assert.equal(view.editor.children[0].children.filter(node=>node.id===shared.id).length,1,'sharing a note never duplicates its content');
    api.flushSync(()=>entryElement(view,bob.id).querySelector('.metadata-links-button').click());await tick();
    api.flushSync(()=>view.editor.tf.undo());await tick();
    assert.deepEqual(view.editor.children[0].children[1].noteIds||[],[],'the last association is one undoable change');
    assert.equal(plain(view.editor.children[0].children[4]),'Both authors contributed equally.');
    view.close();
  });

  await t.test('authors form one wrapping byline; author and affiliation handles reorder by pointer without changing associations and undo together',async()=>{
    const labA=entry('affiliation','Institute A'),labB=entry('affiliation','Laboratory B');
    const primary=entry('note','Primary email'),shared=entry('note','Shared contribution');
    primary.children[0].children=[{text:'Primary ',bold:true},{text:'email',italic:true}];
    const alice=entry('author','Alice',{affiliationIds:[labA.id,labB.id],noteIds:[primary.id]});
    const bob=entry('author','Bob',{affiliationIds:[labB.id],noteIds:[shared.id]});
    const charlie=entry('author','Charlie',{affiliationIds:[labA.id],noteIds:[shared.id]});
    const title=entry('title','Title'),free=paragraph('Other metadata stays in place');
    const view=mount([{...api.createMetadataBlock(),children:[title,alice,labA,primary,bob,labB,shared,charlie,free]},paragraph('Body')]);
    api.flushSync(()=>view.editor.tf.normalize({force:true}));await tick();
    const metadata=view.container.querySelector('.document-metadata'),flow=metadata.querySelector('.metadata-author-flow'),slate=view.container.querySelector('[data-slate-editor]');
    assert.equal(window.getComputedStyle(flow).display,'flex');assert.equal(window.getComputedStyle(flow).flexWrap,'wrap');
    assert.deepEqual(view.editor.children[0].children.slice(1,4).map(node=>node.id),[alice.id,bob.id,charlie.id],'scattered legacy authors become actual adjacent nodes');
    assert.deepEqual(view.editor.children[0].children.map(node=>node.role||'legacy'),['title','author','author','author','affiliation','affiliation','note','note','legacy'],'all structural groups are actual contiguous nodes before legacy text');
    assert.deepEqual(view.editor.children[0].children.find(node=>node.id===primary.id).children[0].children,primary.children[0].children,'grouping retains every note mark and character');
    assert.deepEqual([...flow.querySelectorAll(':scope > .metadata-entry-author')].map(element=>element.dataset.metadataEntryId),[alice.id,bob.id,charlie.id]);
    assert.equal(window.getComputedStyle(entryElement(view,alice.id)).display,'flex','author controls and name share a row');
    const authorIds=()=>view.editor.children[0].children.filter(node=>node.role==='author').map(node=>node.id);
    const affiliationIds=()=>view.editor.children[0].children.filter(node=>node.role==='affiliation').map(node=>node.id);
    const originalNonAuthors=view.editor.children[0].children.filter(node=>node.role!=='author').map(node=>node.id);
    const before=JSON.stringify(view.editor.children);
    metadata.getBoundingClientRect=()=>new window.DOMRect(20,20,600,540);
    slate.getBoundingClientRect=()=>new window.DOMRect(0,0,700,600);
    for(const element of metadata.querySelectorAll('.document-metadata-entry'))element.getBoundingClientRect=()=>{
      const role=element.dataset.metadataRole,siblings=[...metadata.querySelectorAll('.document-metadata-entry')].filter(item=>item.dataset.metadataRole===role),index=siblings.indexOf(element);
      return role==='author'?new window.DOMRect(index%2===0?40:180,70+Math.floor(index/2)*45,120,30)
        :role==='affiliation'?new window.DOMRect(40,230+index*110,520,35):new window.DOMRect(40,430,520,30);
    };
    let outerStarts=0;const outerStart=()=>outerStarts++;
    document.body.addEventListener('pointerdown',outerStart);document.body.addEventListener('dragstart',outerStart);
    const begin=id=>{
      const element=entryElement(view,id),handle=element.querySelector('.metadata-entry-drag-handle'),rect=element.getBoundingClientRect();
      assert.ok(handle);handle.setPointerCapture=()=>{};handle.hasPointerCapture=()=>false;
      api.flushSync(()=>handle.dispatchEvent(new window.PointerEvent('pointerdown',{pointerId:31,clientX:rect.left+5,clientY:rect.top+5,button:0,buttons:1,bubbles:true,cancelable:true})));
      return handle;
    };
    const send=(type,x,y)=>api.flushSync(()=>window.dispatchEvent(new window.PointerEvent(type,{pointerId:31,clientX:x,clientY:y,bubbles:true,cancelable:true})));
    begin(charlie.id);send('pointermove',30,80);
    const authorLine=document.querySelector('[data-metadata-drop-line="author"]');assert.equal(authorLine.style.display,'block');assert.equal(authorLine.style.width,'2px');
    send('pointerup',30,80);await tick();
    assert.deepEqual(authorIds(),[charlie.id,alice.id,bob.id]);
    assert.deepEqual(view.editor.children[0].children.filter(node=>node.role!=='author').map(node=>node.id),originalNonAuthors);
    assert.deepEqual(view.editor.children[0].children.find(node=>node.id===alice.id).affiliationIds,[labA.id,labB.id]);
    assert.deepEqual(view.editor.children[0].children.find(node=>node.id===alice.id).noteIds,[primary.id]);
    assert.equal(entryElement(view,alice.id).querySelector('.metadata-entry-markers').textContent,'1, 2, †');
    assert.equal(entryElement(view,bob.id).querySelector('.metadata-entry-markers').textContent,'2, *');
    assert.equal(document.querySelector('[data-metadata-drop-line]'),null);
    const afterAuthors=JSON.stringify(view.editor.children);
    begin(labB.id);send('pointermove',60,220);
    const affiliationLine=document.querySelector('[data-metadata-drop-line="affiliation"]');assert.equal(affiliationLine.style.display,'block');assert.equal(affiliationLine.style.height,'2px');
    send('pointerup',60,220);await tick();assert.deepEqual(affiliationIds(),[labB.id,labA.id]);
    assert.deepEqual(authorIds(),[charlie.id,alice.id,bob.id]);
    assert.deepEqual(view.editor.children[0].children.find(node=>node.id===alice.id).affiliationIds,[labA.id,labB.id]);
    assert.equal(entryElement(view,alice.id).querySelector('.metadata-entry-markers').textContent,'1, 2, †','markers follow numbering without rewriting stored association order');
    assert.equal(entryElement(view,bob.id).querySelector('.metadata-entry-markers').textContent,'1, *');
    api.flushSync(()=>view.editor.tf.undo());await tick();assert.equal(JSON.stringify(view.editor.children),afterAuthors,'affiliation reorder is one undo step');
    const noteContentBefore=JSON.stringify(view.editor.children[0].children.filter(node=>node.role==='note'));
    begin(labA.id);send('pointermove',60,430);
    const noteBoundaryLine=document.querySelector('[data-metadata-drop-line="affiliation"]');assert.equal(noteBoundaryLine.style.display,'block');assert.equal(noteBoundaryLine.style.top,'430px');
    send('pointerup',60,430);await tick();
    assert.deepEqual(affiliationIds(),[labB.id,labA.id],'dropping at the upper note edge moves to the end of the affiliation group');
    assert.deepEqual(view.editor.children[0].children.map(node=>node.role||'legacy'),['title','author','author','author','affiliation','affiliation','note','note','legacy']);
    assert.equal(JSON.stringify(view.editor.children[0].children.filter(node=>node.role==='note')),noteContentBefore,'moving to the note boundary never moves or changes a note');
    api.flushSync(()=>view.editor.tf.undo());await tick();assert.equal(JSON.stringify(view.editor.children),afterAuthors);
    api.flushSync(()=>view.editor.tf.undo());await tick();assert.equal(JSON.stringify(view.editor.children),before,'author reorder is one undo step');
    api.flushSync(()=>view.editor.tf.redo());await tick();assert.deepEqual(authorIds(),[charlie.id,alice.id,bob.id]);
    const unchanged=JSON.stringify(view.editor.children),handle=begin(bob.id);send('pointermove',30,80);
    window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));send('pointerup',30,80);await tick();
    assert.equal(JSON.stringify(view.editor.children),unchanged);assert.equal(document.querySelector('[data-metadata-drop-line]'),null);
    begin(bob.id);send('pointermove',60,250);send('pointerup',60,250);await tick();
    assert.equal(JSON.stringify(view.editor.children),unchanged,'dropping an author over the affiliation area does not move it');
    const native=new window.Event('dragstart',{bubbles:true,cancelable:true});handle.dispatchEvent(native);
    assert.equal(native.defaultPrevented,true);assert.equal(outerStarts,0,'entry handles cannot start the outer document drag');
    document.body.removeEventListener('pointerdown',outerStart);document.body.removeEventListener('dragstart',outerStart);
    view.close();
  });

  await t.test('the add and role menus retain old rich content, support explicit conversion, and delete whole entries with undo',async()=>{
    const old={type:'p',id:'legacy-paragraph',children:[{text:'Original ',bold:true},{text:'author note',italic:true}]};
    const view=mount([{type:'document_metadata',id:'legacy-metadata',children:[old,paragraph('Another free paragraph')]},paragraph('Body')]);
    const withoutIds=value=>JSON.parse(JSON.stringify(value,(key,item)=>key==='id'?undefined:item));
    assert.deepEqual(withoutIds(view.editor.children[0].children[0]),withoutIds(old));
    api.flushSync(()=>view.editor.tf.select({path:[0,0,0],offset:3}));await tick();
    await openMenu(view.container.querySelector('.metadata-add-button'));
    await chooseMenu('[data-metadata-convert-role="author"]');
    const converted=view.editor.children[0].children[0],convertedId=converted.id;
    assert.equal(converted.type,'metadata_entry');assert.equal(converted.role,'author');
    assert.deepEqual(withoutIds(converted.children[0]),withoutIds(old));
    assert.equal(plain(view.editor.children[0].children[1]),'Another free paragraph');
    api.flushSync(()=>view.editor.tf.withNewBatch(()=>view.editor.tf.setNodes({affiliationIds:['unresolved-affiliation'],noteIds:['unresolved-note']},{at:[0,0]})));await tick();
    await openMenu(entryElement(view,convertedId).querySelector('.metadata-role-button'));
    await chooseMenu('[data-metadata-set-role="note"]');
    assert.equal(view.editor.children[0].children[0].id,convertedId);assert.equal(view.editor.children[0].children[0].role,'note');
    assert.deepEqual(view.editor.children[0].children[0].affiliationIds,['unresolved-affiliation']);
    assert.deepEqual(view.editor.children[0].children[0].noteIds,['unresolved-note']);
    assert.deepEqual(withoutIds(view.editor.children[0].children[0].children[0]),withoutIds(old));
    api.flushSync(()=>view.editor.tf.undo());await tick();assert.equal(view.editor.children[0].children[0].role,'author');
    await openMenu(view.container.querySelector('.metadata-add-button'));await chooseMenu('[data-metadata-add-role="affiliation"]');
    assert.deepEqual(view.editor.children[0].children.map(node=>node.role||'legacy'),['author','affiliation','legacy']);
    const addedId=view.editor.children[0].children.find(node=>node.role==='affiliation').id;
    api.flushSync(()=>view.editor.tf.select({path:[0,0,0,0],offset:3}));await tick();
    await openMenu(entryElement(view,convertedId).querySelector('.metadata-role-button'));await chooseMenu('[data-metadata-set-role="note"]');
    assert.deepEqual(view.editor.children[0].children.map(node=>node.role||'legacy'),['affiliation','note','legacy'],'changing a role moves the existing entry into its semantic group');
    assert.equal(view.editor.children[0].children[1].id,convertedId);
    assert.equal(view.editor.api.above({at:view.editor.selection.anchor,match:node=>node.type==='metadata_entry'})[0].id,convertedId,'the restored cursor follows the same rich text after its entry moves');
    assert.equal(view.editor.selection.anchor.offset,3);
    assert.deepEqual(view.editor.children[0].children[1].noteIds,['unresolved-note']);
    api.flushSync(()=>view.editor.tf.undo());await tick();
    assert.deepEqual(view.editor.children[0].children.map(node=>node.role||'legacy'),['author','affiliation','legacy'],'role change and layout normalization undo together');
    await openMenu(entryElement(view,addedId).querySelector('.metadata-role-button'));
    const deletion=[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent==='Delete entry');
    assert.ok(deletion);api.flushSync(()=>deletion.click());await tick();
    assert.equal(view.editor.children[0].children.some(node=>node.id===addedId),false);
    api.flushSync(()=>view.editor.tf.undo());await tick();assert.equal(view.editor.children[0].children.some(node=>node.id===addedId),true);
    assert.deepEqual(withoutIds(view.editor.children[0].children[0].children[0]),withoutIds(old));
    view.close();
  });

  await t.test('read-only metadata keeps its content and disables editing controls',async()=>{
    const note=entry('note','Shared contribution note'),author=entry('author','Alice',{noteIds:[note.id]});
    const block={...api.createMetadataBlock(),children:[author,note]};
    const view=mount([block,paragraph('Body')],true),before=JSON.stringify(view.editor.children);
    assert.equal(view.container.querySelector('.document-metadata-marker'),null);
    assert.equal(view.container.querySelector('.metadata-entry-controls'),null);
    assert.equal(view.container.querySelector('.metadata-entry-drag-handle'),null);
    assert.equal(entryElement(view,author.id).querySelector('.metadata-entry-markers').textContent,'*');
    const button=view.container.querySelector('button[aria-label="Metadata"]');assert.equal(button.disabled,true);
    api.flushSync(()=>button.click());await tick();
    assert.equal(JSON.stringify(view.editor.children),before);
    assert.equal(view.prepareCount(),0);
    assert.match(view.container.querySelector('.document-metadata-body').textContent,/Shared contribution note/);
    view.close();
  });
});
