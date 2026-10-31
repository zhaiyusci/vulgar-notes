const test=require('node:test'),assert=require('node:assert/strict');
const {build}=require('esbuild');

class Network {
  endpoints=new Map();queue=[];
  endpoint(id,role){
    const network=this;
    const endpoint={peerId:id,role,available:role==='host',peers:new Set(),listeners:new Set(),messages:new Set(),
      getState(){return {available:this.available,peers:[...this.peers]};},
      subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);},
      onMessage(fn){this.messages.add(fn);return()=>this.messages.delete(fn);},
      send(to,bytes){if(!this.available||!this.peers.has(to))return false;network.queue.push({from:id,to,bytes:new Uint8Array(bytes)});return true;},
      emit(){for(const fn of this.listeners)fn();},
      destroy(){for(const peer of [...this.peers])network.disconnect(this,network.endpoints.get(peer));this.available=false;this.emit();this.messages.clear();this.listeners.clear();},
    };this.endpoints.set(id,endpoint);return endpoint;
  }
  connect(a,b){a.available=b.available=true;a.peers.add(b.peerId);b.peers.add(a.peerId);a.emit();b.emit();}
  disconnect(a,b){if(!b)return;a.peers.delete(b.peerId);b.peers.delete(a.peerId);if(a.role==='guest')a.available=false;if(b.role==='guest')b.available=false;a.emit();b.emit();}
  flush(){for(let count=0;this.queue.length;count++){assert.ok(count<1000);const frame=this.queue.shift(),target=this.endpoints.get(frame.to);if(target?.available&&target.peers.has(frame.from))for(const fn of target.messages)fn(frame.from,frame.bytes);}}
}

test('mounted host controls guest editing, preserves unconfirmed/IME recovery, and keeps guest departure read-only',async t=>{
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><html><body></body></html>');
  const keys=['innerWidth','innerHeight','window','document','navigator','location','history','sessionStorage','localStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'];
  const descriptors=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const browserMethods=['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'];
  for(const key of browserMethods)descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
  for(const key of keys)Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  for(const key of browserMethods)Object.defineProperty(globalThis,key,{value:window[key].bind(window),configurable:true});
  const code=(await build({stdin:{contents:"export {PlateMathHost} from './src/plate-host';export {DocumentCollaborationSession} from './src/collaboration-session';export {EditorModel} from './src/editor-model';export {draftStorage} from './src/platform';",resolveDir:__dirname,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,external:['yjs'],loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'headless-kit',setup(build){build.onLoad({filter:/components[\\/]editor[\\/]editor-kit\.tsx$/},()=>({contents:`import {ParagraphPlugin} from 'platejs/react';import {TrailingBlockPlugin} from 'platejs';import {MathKit} from './plugins/math-kit';import {ReferenceKit} from './plugins/reference-kit';import {FootnoteKit} from './plugins/footnote-kit';export const EditorKit=[ParagraphPlugin,...MathKit,...ReferenceKit,TrailingBlockPlugin,...FootnoteKit];`,loader:'tsx',resolveDir:require('node:path').resolve('src/components/editor')}));}}]})).outputFiles[0].text;
  const compiled={exports:{}};new Function('require','module','exports',code)(require,compiled,compiled.exports);
  const {PlateMathHost,DocumentCollaborationSession,EditorModel,draftStorage}=compiled.exports;
  const network=new Network(),hosts=[],tick=()=>new Promise(resolve=>setTimeout(resolve,15));let next=0,failNextGuest=false;
  const originalStart=DocumentCollaborationSession.prototype.start;
  DocumentCollaborationSession.prototype.start=function(creator){this.options.transportFactory=()=>{if(!creator&&failNextGuest){failNextGuest=false;throw Error('Test connection unavailable');}return network.endpoint((creator?'host':'guest')+'-'+next++,creator?'host':'guest');};return originalStart.call(this,creator);};
  t.after(async()=>{for(const host of hosts)host.destroy();DocumentCollaborationSession.prototype.start=originalStart;await window.happyDOM.cancelAsync();for(const[key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const settle=async()=>{for(let index=0;index<5;index++){network.flush();await tick();}};
  function make(){
    draftStorage().clear();const mount=document.createElement('div');document.body.append(mount);
    const composition={active:false,pending:undefined};
    const flow=new PlateMathHost(mount,new EditorModel(),{activate(){},leave(){composition.active=false;composition.pending=undefined;},change(){},isComposing:()=>composition.active,pendingMathSnapshot:()=>composition.pending});
    flow.testComposition=composition;hosts.push(flow);return flow;
  }
  const main=make(),guest=make();await main.startCollaboration();
  assert.equal(new URL(location.href).hash,'','host refresh must reopen its main file, never become its own guest');
  await guest.startCollaboration(main.getCollaborationState().invite);
  network.connect(main.collaboration.transport,guest.collaboration.transport);await settle();
  assert.equal(main.readOnly,false);assert.equal(guest.readOnly,true);assert.equal(guest.getCollaborationState().permission,'view');
  const identity=guest.collaboration.transport.peerId;
  assert.equal(main.getCollaborationState().peers[0].transportPeerId,identity);
  const before=JSON.stringify(guest.editor.children);
  guest.editor.tf.insertText('blocked',{at:{path:[0,0],offset:0}});assert.equal(JSON.stringify(guest.editor.children),before);
  assert.throws(()=>guest.insertFormula(),/read-only/);
  guest.setBibliographyStyle('aip');assert.equal(guest.getBibliographyStyle(),'simple');
  main.setCollaborationPermission(identity,'edit');await settle();assert.equal(guest.readOnly,false);
  const inserted=guest.insertFormula(false,'x'),id=inserted.element.dataset.mathId;
  guest.persist();await settle();assert.equal(main.models.get(id).exportLatex(),'x');
  assert.equal(main.getCollaborationState().role,'host');assert.equal(guest.hasUnsavedChanges(),false,'a participant does not own the main file Save lifecycle');
  guest.enter(inserted.element,'end');
  const draft=new EditorModel();draft.restore(guest.models.get(id).snapshot());draft.setCursor(draft.root.id,draft.root.items.length);draft.insert('中');
  guest.testComposition.active=true;guest.testComposition.pending={formulaId:id,snapshot:draft.snapshot()};
  main.setCollaborationPermission(identity,'view');await settle();
  assert.equal(guest.readOnly,true);assert.equal(guest.getCollaborationState().recoveryAvailable,true);
  assert.equal(main.models.get(id).exportLatex(),'x');assert.equal(guest.models.get(id).exportLatex(),'x');
  assert.ok(guest.collaborationRecoveries.some(copy=>copy.source.includes('中')),'a composing draft is recoverable even before its first Yjs update');
  main.setCollaborationPermission(identity,'edit');await settle();
  const model=guest.models.get(id);model.setCursor(model.root.id,model.root.items.length);model.insert('+pending');guest.persist();
  assert.ok(guest.getCollaborationState().pending>0);
  main.setCollaborationPermission(identity,'view');await settle();
  assert.equal(main.models.get(id).exportLatex(),'x','a queued proposal is checked against current host permission');
  assert.equal(guest.models.get(id).exportLatex(),'x');assert.ok(guest.collaborationRecoveries.some(copy=>copy.source.includes('pending')));
  assert.ok(guest.collaborationRecoveries.length>=2,'later loss does not overwrite an older recovery');
  guest.leaveCollaboration();await settle();assert.equal(guest.isCollaborating(),true);assert.equal(guest.readOnly,true);assert.equal(guest.collaboration,undefined);
  const readonlyArticle=JSON.stringify(guest.editor.children),readonlyFormula=guest.entries()[0].element;
  guest.setDisplay(readonlyFormula,true);guest.setNumbered(readonlyFormula,false);assert.equal(JSON.stringify(guest.editor.children),readonlyArticle);
  guest.detachCollaboration();await tick();assert.equal(guest.isCollaborating(),false);assert.equal(guest.readOnly,false);
  const canonical=JSON.stringify(main.editor.children);guest.editor.tf.insertText('independent',{at:{path:[0,0],offset:0}});await settle();assert.equal(JSON.stringify(main.editor.children),canonical);
  const pendingHost=make(),pendingStart=pendingHost.startCollaboration();pendingHost.leaveCollaboration();await pendingStart;assert.equal(pendingHost.isCollaborating(),false);
  const failedGuest=make();failNextGuest=true;await assert.rejects(failedGuest.startCollaboration(main.getCollaborationState().invite),/Test connection unavailable/);
  assert.equal(failedGuest.isCollaborating(),true);assert.equal(failedGuest.readOnly,true,'a failed join must not silently become an editable local fork');failedGuest.detachCollaboration();
  const destroyedHost=make(),destroyedStart=destroyedHost.startCollaboration();destroyedHost.destroy();hosts.splice(hosts.indexOf(destroyedHost),1);await destroyedStart;assert.equal(destroyedHost.collaboration,undefined);
  const closingGuest=make();await closingGuest.startCollaboration(main.getCollaborationState().invite);network.connect(main.collaboration.transport,closingGuest.collaboration.transport);await settle();main.setCollaborationPermission(closingGuest.collaboration.transport.peerId,'edit');await settle();
  const closingDraft=new EditorModel();closingDraft.restore(closingGuest.models.get(id).snapshot());closingDraft.setCursor(closingDraft.root.id,closingDraft.root.items.length);closingDraft.insert('末');
  closingGuest.testComposition.active=true;closingGuest.testComposition.pending={formulaId:id,snapshot:closingDraft.snapshot()};closingGuest.destroy();hosts.splice(hosts.indexOf(closingGuest),1);
  assert.ok(closingGuest.collaborationRecoveries.some(copy=>copy.source.includes('末')),'unmount also preserves a native composing draft');assert.equal(main.models.get(id).exportLatex(),'x');
});

test('native math keyboard, palette and IME are gated immediately, with a separate readable composing draft',async t=>{
  const source=(await build({entryPoints:['src/editor-ui.ts'],bundle:true,write:false,format:'iife',globalName:'mathUI'})).outputFiles[0].text;
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><body><div id="preview"><div id="textFlow"><span class="inline-formula" id="formula" data-math-id="test-formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div><select id="formulaLayout"></select></body>');
  window.setTimeout=()=>0;window.requestAnimationFrame=()=>0;window.MathJax={typesetClear(){},async typesetPromise(){}};
  window.eval(source+'\nwindow.mathUI=mathUI;');let hooks,model,readOnly=false;
  window.mathUI.mountMathEditor((mount,initial,h)=>{hooks=h;model=initial;model.root.items=['x'];model.index();model.setCursor(model.root.id,1);return {get readOnly(){return readOnly;},entries:()=>[{element:window.document.getElementById('formula'),model}],syncMath(){},persist(){},exportLatex:()=>'',exportMarkdown:()=>'',isDisplay:()=>false,isNumbered:()=>false};});
  t.after(()=>window.happyDOM.abort());
  const input=window.document.getElementById('mathInput');hooks.activate(window.document.getElementById('formula'),model,'end');
  const formula=window.document.getElementById('formula'),region=window.document.createElement('span'),item=window.document.createElement('span');
  region.className='math-region region-'+model.root.id;item.className='math-item item-'+model.root.id+'-0';item.textContent='x';region.append(item);formula.append(region);
  item.dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,clientX:20,clientY:20,cancelable:true}));
  const staleVariant=window.document.querySelector('#variantMenu [data-variant]');assert.ok(staleVariant);
  input.dispatchEvent(new window.Event('compositionstart'));input.value='x中';
  const pending=hooks.pendingMathSnapshot();assert.equal(pending.formulaId,'test-formula');assert.match(pending.snapshot,/中/);assert.equal(model.exportLatex(),'x');
  readOnly=true;staleVariant.click();assert.equal(model.exportLatex(),'x','a menu opened before revocation cannot mutate a formula afterward');input.dispatchEvent(new window.Event('compositionend'));assert.equal(model.exportLatex(),'x');
  const event=new window.InputEvent('beforeinput',{inputType:'insertText',data:'bad',cancelable:true});assert.equal(input.dispatchEvent(event),false);
  input.value='bad';input.dispatchEvent(new window.Event('input'));input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Backspace',cancelable:true}));
  window.document.querySelector('#insertToolbar [data-insert]').click();assert.equal(model.exportLatex(),'x');
});
