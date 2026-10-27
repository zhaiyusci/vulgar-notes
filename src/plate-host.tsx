import {documentSessionId,draftStorage} from './platform';
import {t} from './i18n';
import React from 'react';
import {DisplayBoundaryText} from './display-boundary-text';
import {HostContext} from './plate-math-element';
import {createRoot,type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createPlateEditor,Plate,type PlateEditor} from 'platejs/react';
import {type TElement,type Value,NodeApi,assignLegacyTransforms,KEYS} from 'platejs';
import {MarkdownPlugin} from '@platejs/markdown';
import {Range,Path} from 'slate';
import {EditorKit} from './components/editor/editor-kit';
import {Editor,EditorContainer} from './components/ui/editor';
import {BibtexBibliography} from './components/ui/bibtex-bibliography';
import {TooltipProvider} from './components/ui/tooltip';
import {Toaster} from 'sonner';
import {EditorModel} from './editor-model';
import type {DocumentHost,MathHostHooks,FormulaEntry} from './document-host';
import {documentStorageKey,formulaNode,isFormula,newId,plateLatex,restoreDocumentEnvelope,parseDocumentEnvelope,validateDocumentLibraries,documentContentKey,isBlankDocument,type FormulaNode} from './plate-document';
import {importMath} from './tex-import';
import {bibliographyItems,citedReferenceKeys,validReferenceKey} from './references';
import {citedBibLibraries,validateBibLibraries,validCitationKey,type BibLibrary} from './bibtex';
import {bibliographyMarkdown} from './bibliography-markdown';
import {readLibraryCache,writeLibraryCache,restoreLibraryAttachments} from './bibliography-library-store';
import {isBibliographyStyle,type BibliographyStyle} from './bibliography-style';

export class PlateMathHost implements DocumentHost {
  readonly editor:PlateEditor;
  readonly models=new Map<string,EditorModel>();
  readonly mounts=new Map<string,HTMLElement>();
  readonly root:Root;
  private syncing=false;
  private initialized=false;
  private pending=false;
  private savedDocument='';
  private activeFormula:HTMLElement|undefined;
  private pendingActivation=new Set<string>();
  private bibliographyLibraries:readonly BibLibrary[]=Object.freeze([]);
  private bibliographyStyle:BibliographyStyle='simple';
  getBibliographyStyle=():BibliographyStyle=>this.bibliographyStyle;
  setBibliographyStyle(style:BibliographyStyle):void {
    if(!isBibliographyStyle(style))throw Error('Invalid bibliography style');
    if(style===this.bibliographyStyle)return;
    this.bibliographyStyle=style;
    for(const listener of this.bibliographyListeners)listener();
    this.save();this.scheduleChange();
  }
  private capturedLibraryIds=new Set<string>();
  private cacheLibraryIds:Record<string,string>=Object.create(null);
  private libraryNotices:string[]=[];
  isCapturedBibliographyLibrary=(id:string)=>this.capturedLibraryIds.has(id);
  getBibliographyNotices=():readonly string[]=>this.libraryNotices;
  private bibliographyListeners=new Set<()=>void>();
  getBibliographyLibraries=():readonly BibLibrary[]=>this.bibliographyLibraries;
  getBibliographySourceId=(id:string):string=>this.cacheLibraryIds[id]??id;
  subscribeBibliography=(listener:()=>void)=>{this.bibliographyListeners.add(listener);return ()=>{this.bibliographyListeners.delete(listener);};};
  private replaceBibliography(libraries:readonly BibLibrary[]){
    this.bibliographyLibraries=Object.freeze(libraries.map(library=>Object.freeze({...library})));
    for(const listener of this.bibliographyListeners)listener();
  }
  /** Full sources live on this device; only cited entries belong to the document. */
  setBibliographyLibraries(libraries:readonly BibLibrary[],updatedLibraryIds?:readonly string[]):void {
    const next=validateBibLibraries(libraries);validateDocumentLibraries(this.editor.children,next);
    if(JSON.stringify(next)===JSON.stringify(this.bibliographyLibraries)&&!updatedLibraryIds?.length)return;
    const changed=new Set(updatedLibraryIds??next.filter(library=>!this.bibliographyLibraries.some(old=>old.id===library.id&&old.name===library.name&&old.source===library.source)).map(library=>library.id));
    const removed=this.bibliographyLibraries.filter(old=>!next.some(library=>library.id===old.id));
    const replaceIds=new Set([...removed.map(library=>this.cacheLibraryIds[library.id]??library.id),...next.filter(library=>changed.has(library.id)).map(library=>this.cacheLibraryIds[library.id]??library.id)]);
    const currentCache=readLibraryCache();
    const cached=[...currentCache.libraries.filter(library=>!replaceIds.has(library.id)),...next.filter(library=>changed.has(library.id))];
    // Commit the independent cache before replacing a usable in-memory source.
    writeLibraryCache(cached);
    const origins:Record<string,string>=Object.create(null);
    const captured=new Set<string>();
    for(const library of next){
      // Source identity survives another window updating the same catalog.
      // Its current contents are separate from this view's full/captured state.
      const cacheId=changed.has(library.id)?library.id:this.cacheLibraryIds[library.id];
      if(cacheId)origins[library.id]=cacheId;
      if(!changed.has(library.id)&&(!this.bibliographyLibraries.some(old=>old.id===library.id)||this.capturedLibraryIds.has(library.id)))captured.add(library.id);
    }
    this.capturedLibraryIds=captured;
    this.cacheLibraryIds=origins;
    this.libraryNotices=[];
    this.replaceBibliography(next);this.save();this.scheduleChange();
  }
  private restoreBibliography(captured:readonly BibLibrary[],value:Value){
    const cache=readLibraryCache();
    const reserved=[...NodeApi.nodes({children:value} as PlateEditor)].filter(([node])=>node.type==='bibliography_entry').map(([node])=>String(node.citeKey));
    const restored=restoreLibraryAttachments(captured,cache.libraries,reserved);
    this.capturedLibraryIds=new Set(restored.capturedOnlyIds);this.cacheLibraryIds=restored.cacheLibraryIds;
    this.libraryNotices=[...(cache.error?[t('The saved library cache could not be read. The original data has been kept.')]:[]),...restored.conflicts.map(conflict=>t('A local library differs from this document. Its captured references were preserved.')+' '+conflict.name)];
    this.replaceBibliography(restored.libraries);
  }
  private envelope(){
    const bibliographyLibraries=citedBibLibraries(this.bibliographyLibraries,citedReferenceKeys(this.editor.children));
    return {version:1,value:this.editor.children,...(bibliographyLibraries.length?{bibliographyLibraries}:{}),...(this.bibliographyStyle!=='simple'?{bibliographyStyle:this.bibliographyStyle}:{})};
  }
  get readOnly(){return this.mount.querySelector('[data-slate-editor]')?.getAttribute('contenteditable')==='false';}
  constructor(readonly mount:HTMLElement,initial:EditorModel,private hooks:MathHostHooks){
    const restored=restoreDocumentEnvelope(initial);this.bibliographyStyle=restored.bibliographyStyle??'simple';this.restoreBibliography(restored.bibliographyLibraries,restored.value);
    this.editor=createPlateEditor({plugins:EditorKit,value:restored.value});
    this.ensureFormulas();
    const originalNormalize=this.editor.tf.normalizeNode.bind(this.editor);
    this.editor.tf.normalizeNode=entry=>{
      const [node,path]=entry;
      if(path.length===0&&this.groupBibliography())return;
      if('type' in node&&isFormula(node)){
        const n=node as FormulaNode;
        const duplicate=[...NodeApi.nodes(this.editor)].some(([other,p])=>other!==node&&'type' in other&&isFormula(other)&&other.id===n.id&&Path.compare(p,path)<0);
        if(!n.id||duplicate){this.editor.tf.setNodes({id:newId()},{at:path});return;}
      }
      originalNormalize(entry);
    };
    // Slate's normalization loop also calls its legacy entry point.
    assignLegacyTransforms(this.editor,{normalizeNode:this.editor.tf.normalizeNode});
    this.editor.tf.withoutSaving(()=>this.editor.tf.normalize({force:true}));
    // Recovery is not a file save. The lifecycle restores a real saved baseline
    // after construction; otherwise restored content remains unsaved.
    this.savedDocument=isBlankDocument(this.editor.children,this.bibliographyStyle)?JSON.stringify(this.envelope(),null,2):JSON.stringify({version:1,value:[{type:'p',children:[{text:''}]}]},null,2);
    mount.removeAttribute('contenteditable');mount.removeAttribute('role');mount.removeAttribute('aria-label');mount.id='plateMount';
    this.root=createRoot(mount);
    flushSync(()=>this.root.render(<HostContext.Provider value={this}><TooltipProvider><Plate editor={this.editor} onChange={()=>this.changed()}>
      <EditorContainer><Editor autoFocus={documentSessionId()!==null} renderText={props=><DisplayBoundaryText {...props} />} id="textFlow" aria-label={t("Body")} placeholder={t("Type here…")}
        onPointerDown={e=>{if(!(e.target as Element).closest('.inline-formula')){this.activeFormula=undefined;this.hooks.leave();}}}
        onFocus={()=>{this.activeFormula=undefined;this.hooks.leave();}}
        onKeyDownCapture={e=>this.handleObjectDelete(e)} onKeyDown={e=>this.keyDown(e)} /><BibtexBibliography /></EditorContainer>
    </Plate><Toaster /></TooltipProvider></HostContext.Provider>));
    this.initialized=true;this.persist();
  }
  /** Editable references and endnotes form one tail in their shared number order. */
  private groupBibliography():boolean {
    const entries=bibliographyItems(this.editor.children,this.bibliographyLibraries).filter(item=>!item.libraryId);
    if(!entries.length)return false;
    const trailing=()=>{
      const last=this.editor.children.at(-1);
      return last?.type==='p'&&last.children.length===1&&last.children[0].text==='';
    };
    const start=this.editor.children.length-(trailing()?1:0)-entries.length;
    if(entries.every(({path},index)=>path.length===1&&path[0]===start+index))return false;
    const refs=entries.map(({path})=>this.editor.api.pathRef(path));
    try{
      this.editor.tf.withoutNormalizing(()=>{
        for(const ref of refs){
          if(!ref.current)continue;
          // move_node's destination is measured after removing its source.
          const destination=this.editor.children.length-(trailing()?1:0)-(ref.current.length===1?1:0);
          if(!Path.equals(ref.current,[destination]))this.editor.tf.moveNodes({at:ref.current,to:[destination]});
        }
      });
    }finally{refs.forEach(ref=>ref.unref());}
    return true;
  }
  private ensureFormulas(){
    for(const [raw,path] of NodeApi.nodes(this.editor)){
      if(!('type' in raw)||!isFormula(raw))continue;
      const node=raw as FormulaNode;
      if(!node.snapshot){
        const model=importMath(node.texExpression||'');
        if(model){
          const id=node.id||newId();
          if(this.initialized&&!node.texExpression)this.pendingActivation.add(id);
          this.editor.tf.withoutSaving(()=>this.editor.tf.setNodes({id,snapshot:model.snapshot(),texExpression:model.exportLatex(),numbered:node.numbered!==false},{at:path}));
        }
      }
    }
  }
  attach(node:FormulaNode,element:HTMLElement){
    this.mounts.set(node.id,element);
    if(node.snapshot){
      let model=this.models.get(node.id);
      if(!model){model=new EditorModel();this.models.set(node.id,model);}
      if(model.snapshot()!==node.snapshot)model.restore(node.snapshot);
      if(this.pendingActivation.delete(node.id))queueMicrotask(()=>{if(element.isConnected)this.enter(element,'start');});
    }else{
      // Unsupported imported TeX is retained verbatim, never silently rewritten.
      element.textContent='\\('+node.texExpression+'\\)';
      element.title='此导入公式保留原始 LaTeX；尚不能转换为结构化编辑。';
      if(window.ready)void MathJax.typesetPromise([element]);
    }
    this.scheduleChange();
  }
  detach(element:HTMLElement){if(element&&this.mounts.get(element.dataset.mathId!)===element)this.mounts.delete(element.dataset.mathId!);}
  private scheduleChange(){
    if(this.pending)return;this.pending=true;
    queueMicrotask(()=>{this.pending=false;if(this.initialized)this.hooks.change();});
  }
  private changed(){
    if(!this.initialized||this.syncing)return;
    this.ensureFormulas();
    // Document undo/redo is authoritative before the next math repaint.
    for(const [raw] of NodeApi.nodes(this.editor)){
      if(!isFormula(raw))continue;
      const n=raw as FormulaNode,m=this.models.get(n.id);
      if(m&&n.snapshot&&m.snapshot()!==n.snapshot)m.restore(n.snapshot);
    }
    this.save();this.scheduleChange();
  }
  entries():FormulaEntry[]{return [...this.mount.querySelectorAll<HTMLElement>('.inline-formula')].flatMap(element=>{
    const model=this.models.get(element.dataset.mathId!);return model?[{element,model}]:[];
  });}
  private locate(element:HTMLElement){return [...NodeApi.nodes(this.editor)].find(([n])=>'type' in n&&isFormula(n)&&n.id===element.dataset.mathId) as [FormulaNode,number[]]|undefined;}
  private save(){try{
    const storage=draftStorage(),source=JSON.stringify(this.envelope());
    if(storage.getItem(documentStorageKey)!==source){storage.setItem(documentStorageKey,source);storage.setItem(documentStorageKey+'-updated-at',String(Date.now()));}
  }catch{const error=document.getElementById('error');if(error)error.textContent=t('Recovery storage is full. Please save the document to a file.');}}
  persist(){
    if(this.syncing||!this.initialized)return;this.syncing=true;
    try{
      for(const [raw,path] of NodeApi.nodes(this.editor)){
        if(!('type' in raw)||!isFormula(raw))continue;
        const node=raw as FormulaNode,model=this.models.get(node.id);if(!model)continue;
        const snapshot=model.snapshot();if(snapshot===node.snapshot)continue;
        const set=()=>this.editor.tf.setNodes({snapshot,texExpression:model.exportLatex()},{at:path});
        if(node.snapshot&&JSON.stringify(JSON.parse(snapshot).root)===JSON.stringify(JSON.parse(node.snapshot).root))this.editor.tf.withoutSaving(set);
        else this.editor.tf.withNewBatch(set);
      }
      this.save();
    }finally{this.syncing=false;}
  }
  exportLatex(){return plateLatex(this.editor.children as Value);}
  serializeDocument(){this.persist();return JSON.stringify(this.envelope(),null,2);}
  hasUnsavedChanges(){return documentContentKey(this.serializeDocument())!==documentContentKey(this.savedDocument);}
  markDocumentSaved(source:string){this.savedDocument=source;}
  openDocument(source:string){
    const opened=parseDocumentEnvelope(source);
    this.persist();
    draftStorage().setItem(documentStorageKey+'-before-open',this.serializeDocument());
    this.hooks.leave();this.activeFormula=undefined;this.pendingActivation.clear();this.models.clear();
    flushSync(()=>{
      this.bibliographyStyle=opened.bibliographyStyle??'simple';this.restoreBibliography(opened.bibliographyLibraries,opened.value);this.editor.tf.setValue(opened.value);
      this.editor.tf.withoutSaving(()=>this.editor.tf.normalize({force:true}));
    });
    for(const [raw] of NodeApi.nodes(this.editor)){
      if(!isFormula(raw))continue;
      const node=raw as FormulaNode;
      if(node.snapshot&&!this.models.has(node.id)){const model=new EditorModel();model.restore(node.snapshot);this.models.set(node.id,model);}
    }
    this.editor.history={undos:[],redos:[]};
    this.persist();this.savedDocument=this.serializeDocument();this.scheduleChange();
  }
  exportMarkdown(){
    return bibliographyMarkdown(this.editor.children,this.bibliographyLibraries,value=>this.editor.getApi(MarkdownPlugin).markdown.serialize({value}),this.bibliographyStyle);
  }
  get activeFormulaId(){return this.activeFormula?.dataset.mathId;}
  prepareTextInsertion(){
    if(this.activeFormula?.isConnected)this.exit(this.activeFormula,1,false);
    this.hooks.leave();this.persist();
    if(!this.editor.selection)this.editor.tf.select(this.editor.api.end([]));
  }
  isDisplay(element:HTMLElement){return element.dataset.display==='true';}
  isNumbered(element:HTMLElement){return element.dataset.numbered!=='false';}
  setNumbered(element:HTMLElement,numbered:boolean){const entry=this.locate(element);if(entry)this.editor.tf.withNewBatch(()=>this.editor.tf.setNodes({numbered},{at:entry[1]}));}
  setDisplay(element:HTMLElement,display:boolean){
    this.hooks.leave();this.persist();const entry=this.locate(element);if(!entry||this.isDisplay(element)===display)return;
    const [node,path]=entry;
    flushSync(()=>this.editor.tf.withNewBatch(()=>this.editor.tf.withoutNormalizing(()=>{
      if(node.type==='equation'){
        // Older block equations keep their paragraph boundary when converted.
        this.editor.tf.removeNodes({at:path});
        this.editor.tf.insertNodes({type:'p',children:[{text:''},{...node,type:'inline_equation',display},{text:''}]},{at:path,select:true});
      }else this.editor.tf.setNodes({display},{at:path});
      this.editor.api.onChange();
    })));
    const elementNext=this.mounts.get(node.id);if(elementNext)this.enter(elementNext,'end');
  }
  insertFormula(display=false,source=''):FormulaEntry{
    if(this.readOnly)throw Error('Document is read-only');
    if(this.activeFormula?.isConnected)this.exit(this.activeFormula,1,false);
    this.hooks.leave();this.persist();
    const parsed=source?importMath(source):null,model=parsed||new EditorModel();
    if(!parsed){model.root.items=Array.from(source);model.index();}
    model.setCursor(model.root.id,model.root.items.length);
    const node=formulaNode(model,display);this.models.set(node.id,model);
    flushSync(()=>this.editor.tf.withNewBatch(()=>{
      if(!this.editor.selection)this.editor.tf.select(this.editor.api.end([]));
      this.editor.tf.insertNodes(node,{select:true});
      this.editor.api.onChange();
    }));
    const element=this.mounts.get(node.id);if(!element)throw Error('Unable to mount formula');
    this.enter(element,source?'end':'start');return {element,model};
  }
  enter(element:HTMLElement,edge:'start'|'end'){
    if(this.readOnly)return;
    const entry=this.locate(element),model=this.models.get(element.dataset.mathId!);if(!entry||!model)return;
    // Deselecting while Slate synchronizes selection can suppress its native
    // blur handler. Explicitly release focus before activating the math input,
    // otherwise a later Slate render clears the textarea's native caret.
    this.editor.tf.blur();
    flushSync(()=>{this.editor.tf.deselect();this.editor.api.onChange();});this.activeFormula=element;this.hooks.activate(element,model,edge);
  }
  exit(element:HTMLElement,direction:-1|1,focus=true){
    this.activeFormula=undefined;
    this.hooks.leave();this.persist();const entry=this.locate(element);if(!entry)return;
    const [node,path]=entry;
    flushSync(()=>{
      let point=direction<0?this.editor.api.before(path):this.editor.api.after(path);
      if(node.type==='equation'){
        const adjacent=path.slice();adjacent[adjacent.length-1]+=direction;
        if(!this.editor.api.hasPath(adjacent)||isFormula(NodeApi.get(this.editor,adjacent) as TElement)){
          const at=direction<0?path:Path.next(path);this.editor.tf.insertNodes({type:'p',children:[{text:''}]},{at});point=this.editor.api.start(at);
        }
      }
      if(point)this.editor.tf.select(point);
    });
    if(focus)this.editor.tf.focus();
  }
  private objectRange(path:number[]):Range{
    const previous=[...path.slice(0,-1),path[path.length-1]-1],next=Path.next(path);
    const a=NodeApi.get(this.editor,previous),b=NodeApi.get(this.editor,next);
    if(typeof a?.text==='string'&&typeof b?.text==='string')return {anchor:{path:previous,offset:a.text.length},focus:{path:next,offset:0}};
    const anchor=this.editor.api.before(path,{voids:true}),focus=this.editor.api.after(path,{voids:true});
    return anchor&&focus?{anchor,focus}:this.editor.api.range(path)!;
  }
  removeEmpty(element:HTMLElement){
    this.hooks.leave();const entry=this.locate(element);if(!entry)return;
    this.activeFormula=undefined;
    this.editor.tf.focus();
    flushSync(()=>{this.editor.tf.select(this.objectRange(entry[1]));this.editor.api.onChange();});
  }
  private handleObjectDelete(event:React.KeyboardEvent):boolean{
    if((event.key==='Backspace'||event.key==='Delete')&&!event.nativeEvent.isComposing){
      const selection=this.editor.selection;
      if(selection&&!Range.isCollapsed(selection)){
        const selected=[...NodeApi.nodes(this.editor)].find(([n,path])=>(isFormula(n)||n.type==='tex_reference'||n.type===KEYS.footnoteReference)&&Range.equals(Range.isBackward(selection)?{anchor:selection.focus,focus:selection.anchor}:selection,this.objectRange(path)));
        if(selected){event.preventDefault();event.stopPropagation?.();if(!event.repeat)this.editor.tf.withNewBatch(()=>this.editor.tf.removeNodes({at:selected[1]}));return true;}
      }
      if(selection&&Range.isCollapsed(selection)){
        const match=(n:TElement)=>isFormula(n)||n.type==='tex_reference'||n.type===KEYS.footnoteReference;
        const selected=this.editor.api.above({at:selection.anchor,match,voids:true});
        if(selected){
          event.preventDefault();event.stopPropagation?.();
          // Holding a key must not turn the selection preview into deletion.
          if(!event.repeat)this.editor.tf.withNewBatch(()=>this.editor.tf.removeNodes({at:selected[1]}));
          return true;
        }
        const point=event.key==='Backspace'?this.editor.api.before(selection.anchor,{voids:true}):this.editor.api.after(selection.anchor,{voids:true});
        const adjacent=point&&this.editor.api.above({at:point,match,voids:true});
        if(adjacent){
          event.preventDefault();event.stopPropagation?.();
          flushSync(()=>this.editor.tf.select(this.objectRange(adjacent[1])));
          this.editor.tf.focus();return true;
        }
      }
    }
    return false;
  }
  private keyDown(event:React.KeyboardEvent){
    if(this.handleObjectDelete(event))return;
    if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){
      const bibliography=this.editor.api.above({match:n=>n.type==='bibliography_entry'||n.type===KEYS.footnoteDefinition});
      if(bibliography){
        event.preventDefault();
        const first=this.editor.children.findIndex(node=>node.type==='bibliography_entry'||node.type===KEYS.footnoteDefinition);
        this.editor.tf.insertNodes({type:'p',children:[{text:''}]},{at:[first<0?bibliography[1][0]:first],select:true});return;
      }
    }
    if(event.key==='}'&&!event.nativeEvent.isComposing&&this.editor.selection&&Range.isCollapsed(this.editor.selection)){
      const point=this.editor.selection.anchor,leaf=NodeApi.get(this.editor,point.path);
      const match=typeof leaf?.text==='string'?leaf.text.slice(0,point.offset).match(/\\(ref|eqref|cite|label)\{([^{}]+)$/):null;
      const code=this.editor.api.above({match:n=>n.type==='code_block'});
      if(match&&!code){
        const keys=match[2].split(',').map(key=>key.trim());
        if(keys.every(match[1]==='cite'?validCitationKey:validReferenceKey)&&(match[1]==='cite'||keys.length===1)){
          event.preventDefault();this.editor.tf.withNewBatch(()=>{
            this.editor.tf.select({anchor:{...point,offset:point.offset-match[0].length},focus:point});
            this.editor.tf.insertNodes(match[1]==='label'?{type:'tex_label',id:newId(),texLabel:keys[0],children:[{text:''}]}:{type:'tex_reference',id:newId(),command:match[1],keys,children:[{text:''}]},{select:true});
            this.editor.tf.move({distance:1,unit:'offset'});
          });return;
        }
      }
    }
    if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();this.insertFormula(event.shiftKey);return;}
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    const selection=this.editor.selection;if(!selection||!Range.isCollapsed(selection))return;
    const dir=event.key==='ArrowLeft'?-1:1;
    const point=dir<0?this.editor.api.before(selection.anchor,{voids:true}):this.editor.api.after(selection.anchor,{voids:true});
    if(!point)return;
    const above=this.editor.api.above({at:point,match:n=>'type' in n&&isFormula(n),voids:true});
    if(above){const el=this.mounts.get((above[0] as FormulaNode).id);if(el){event.preventDefault();this.enter(el,dir<0?'end':'start');}}
  }
  destroy(){this.initialized=false;this.root.unmount();}
}
