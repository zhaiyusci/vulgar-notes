import {createMathEditor,type MathDocumentAdapter,type MathEditor} from './math-editor';
import {EditorModel} from './editor-model';
import {convertMath} from './tex-convert';
import {decodeFormulaFile,encodeFormulaFile,formulaFileExtension as extension,maxFormulaFileBytes} from './math-editor-file';
import {initLocale,locale,t} from './i18n';
import {createStandaloneMathInspector} from './standalone-math-inspector';

const reloadKey='vulgar-notes.formula-editor.language-reload';
interface FileHandle {
  name:string;
  getFile():Promise<File>;
  createWritable():Promise<{write(data:string):Promise<void>;close():Promise<void>;abort():Promise<void>}>;
}
interface FilePickerWindow extends Window {
  showOpenFilePicker?:(options:unknown)=>Promise<FileHandle[]>;
  showSaveFilePicker?:(options:unknown)=>Promise<FileHandle>;
}

/** A single-formula host; it does not create a prose/document editor. */
export function mountStandaloneMathEditor(){
  const get=<T extends HTMLElement>(id:string)=>{
    const element=document.getElementById(id);if(!element)throw Error('Missing formula editor element: '+id);return element as T;
  };
  initLocale();
  for(const [selector,key] of [['.formula-file-actions','Formula file'],['#formula','Formula'],['#mathInput','Edit formula'],['#textFlow','Formula']] as const)document.querySelector(selector)?.setAttribute('aria-label',t(key));
  for(const [selector,key] of [['.formula-view-actions','Formula views'],['.inspector-tabs','Formula inspector'],['#latexSource','LaTeX source'],['#closeInspector','Close inspector']] as const)document.querySelector(selector)?.setAttribute('aria-label',t(key));
  const formula=get('formula'),preview=get('preview'),input=get<HTMLTextAreaElement>('mathInput');
  const status=get('formulaStatus'),fileName=get('formulaFileName'),language=get<HTMLSelectElement>('uiLocale');
  const actions=['newFormula','openFormula','saveFormula'].map(id=>get<HTMLButtonElement>(id));
  let model=convertMath(''),display=true,numbered=false,name='',handle:FileHandle|undefined;
  let baseline='',busy=false,allowUnload=false,disposed=false;
  let math:MathEditor|undefined;
  let inspector:ReturnType<typeof createStandaloneMathInspector>|undefined;
  const events=new AbortController();
  const on=(element:EventTarget,type:string,fn:EventListener)=>element.addEventListener(type,fn,{signal:events.signal});
  const contentKey=(current=model)=>JSON.stringify({root:JSON.parse(current.snapshot()).root,display,numbered});
  // Only an explicit language switch uses this short-lived reload handoff.
  // Opening a fresh page always starts with an empty formula.
  try{
    const saved=sessionStorage.getItem(reloadKey);sessionStorage.removeItem(reloadKey);
    if(saved){const state=JSON.parse(saved),decoded=decodeFormulaFile(state.file);model=decoded.model;display=decoded.display;numbered=decoded.numbered;name=typeof state.name==='string'?state.name:'';baseline=typeof state.baseline==='string'?state.baseline:'';}
    else baseline=contentKey();
  }catch{baseline=contentKey();}
  const dirty=()=>contentKey(pendingModel())!==baseline;
  function pendingModel(){
    const pending=math?.hooks.pendingMathSnapshot();if(!pending)return model;
    const current=new EditorModel();current.restore(pending.snapshot);return current;
  }
  function sync(){
    formula.classList.toggle('display-formula',display||!!model.formulaLayout());
    fileName.textContent=(name||t('Untitled formula'))+(dirty()?' *':'');
    document.title=(dirty()?'* ':'')+(name||t('Untitled formula'))+' — '+t('Formula editor');
    inspector?.update(model);
  }
  const adapter:MathDocumentAdapter={
    readOnly:false,entries:()=>[{element:formula,model}],syncMath:sync,
    getFormulaSource:()=>model.exportLatex(),
    replaceFormulaSource:(_element,source)=>{model.record();model.restore(convertMath(source).snapshot());math!.hooks.change();},
    isDisplay:()=>display,isNumbered:()=>numbered,
    setDisplay:(_element,value)=>{display=value;math!.hooks.change();},
    setNumbered:(_element,value)=>{numbered=value;math!.hooks.change();},
    insertFormula:()=>{math!.hooks.activate(formula,model,'end');return {element:formula,model};},
    enter:(_element,edge)=>math!.hooks.activate(formula,model,edge),
    // There is no neighbouring prose: keep the caret at the formula boundary.
    exit:(_element,direction)=>math!.hooks.activate(formula,model,direction<0?'start':'end'),
    removeEmpty:()=>math!.hooks.activate(formula,model,'start'),
  };
  inspector=createStandaloneMathInspector({math:()=>math,model:()=>model,name:()=>name,focusMath:activateSavedCursor});
  math=createMathEditor({initialModel:model,sourceEditor:inspector.sourceEditor,elements:{formula,preview,content:get('textFlow'),input,error:get('error'),
    panel:get('mathPanel'),toolbar:get('insertToolbar'),layout:get<HTMLSelectElement>('formulaLayout'),
    pendingFontHint:get('pendingFontHint'),structureCount:get('structureCount'),overlayRoot:document.body}});
  const previousLoadFailure=window.mathjaxLoadFailed;
  const loadFailure=()=>math!.notifyLoadFailure();window.mathjaxLoadFailed=loadFailure;
  try{math.connect(adapter);}catch(error){try{math.dispose();}finally{inspector.dispose();window.mathjaxLoadFailed=previousLoadFailure;}throw error;}
  function activateSavedCursor(){
    const cursor={...model.cursor},pendingFont=model.pendingFont;
    math!.hooks.activate(formula,model,'end');
    model.setCursor(cursor.region,cursor.offset,cursor.anchor);model.pendingFont=pendingFont;math!.hooks.change();
  }
  language.value=locale;
  const pickerTypes=[{description:t('Formula file'),accept:{'application/json':[extension]}}];
  const showError=(error:unknown)=>{status.textContent=t('Could not complete the action: {error}',{error:t(error instanceof Error?error.message:String(error))});};
  const abortError=(error:unknown)=>error instanceof DOMException&&error.name==='AbortError';
  function commit(){math!.hooks.leave();sync();}
  function download(text:string,downloadName:string){
    const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=downloadName;document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function save():Promise<boolean>{
    commit();const savedModel=pendingModel(),savedKey=contentKey(savedModel),text=encodeFormulaFile(savedModel,{display,numbered});
    let nextHandle=handle,nextName=name||'formula'+extension;
    try{
      const pick=(window as FilePickerWindow).showSaveFilePicker;
      if(pick){
        nextHandle??=await pick.call(window,{suggestedName:nextName,types:pickerTypes});
        const writer=await nextHandle.createWritable();
        try{await writer.write(text);await writer.close();}catch(error){try{await writer.abort();}catch{}throw error;}
        nextName=nextHandle.name;
      }else download(text,nextName);
      handle=nextHandle;name=nextName;baseline=savedKey;sync();status.textContent=t(pick?'Formula saved.':'Formula file downloaded.');return true;
    }catch(error){if(!abortError(error))showError(error);return false;}
  }
  function confirmReplacement():Promise<'save'|'discard'|'cancel'>{
    const dialog=document.createElement('dialog');dialog.className='document-unsaved-dialog';
    const heading=document.createElement('h2');heading.textContent=t('Save changes?');
    const message=document.createElement('p');message.textContent=t('Save changes to this formula before opening another file?');
    const controls=document.createElement('div');controls.className='document-unsaved-actions';
    for(const [choice,label] of [['cancel','Cancel'],['discard','Discard'],['save','Save']] as const){const button=document.createElement('button');button.type='button';button.dataset.choice=choice;button.textContent=t(label);button.addEventListener('click',()=>dialog.close(choice));controls.append(button);}
    dialog.append(heading,message,controls);document.body.append(dialog);
    return new Promise(resolve=>{dialog.addEventListener('close',()=>{const choice=dialog.returnValue;dialog.remove();resolve(choice==='save'||choice==='discard'?choice:'cancel');},{once:true});dialog.showModal();});
  }
  /** Decode before changing the live model, including before a discard decision. */
  async function openFile(file:File,nextHandle?:FileHandle){
    if(file.size>maxFormulaFileBytes)throw Error(t('The formula file is too large.'));
    const decoded=decodeFormulaFile(await file.text());
    commit();
    if(dirty()){
      const choice=await confirmReplacement();
      if(choice==='cancel'||choice==='save'&&!await save())return;
    }
    model=decoded.model;display=decoded.display;numbered=decoded.numbered;name=file.name;handle=nextHandle;baseline=contentKey();
    activateSavedCursor();status.textContent='';sync();
  }
  const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept=extension+',.json';fileInput.hidden=true;document.body.append(fileInput);
  async function run(action:()=>Promise<unknown>|unknown){
    if(busy||disposed)return;busy=true;actions.forEach(button=>button.disabled=true);
    try{await action();}catch(error){if(!abortError(error))showError(error);}
    finally{busy=false;actions.forEach(button=>button.disabled=false);}
  }
  on(fileInput,'change',()=>{const file=fileInput.files?.[0];fileInput.value='';if(file)void run(()=>openFile(file));});
  on(get('openFormula'),'click',()=>void run(async()=>{
    const pick=(window as FilePickerWindow).showOpenFilePicker;
    if(pick){const [selected]=await pick.call(window,{multiple:false,types:pickerTypes});if(selected)await openFile(await selected.getFile(),selected);}
    else fileInput.click();
  }));
  on(get('saveFormula'),'click',()=>void run(save));
  on(get('newFormula'),'click',()=>{window.open(new URL(window.location.pathname,window.location.origin).href,'_blank','noopener');});
  on(language,'change',()=>{
    try{commit();sessionStorage.setItem(reloadKey,JSON.stringify({file:encodeFormulaFile(model,{display,numbered}),baseline,name}));localStorage.setItem('editor.locale',language.value);allowUnload=true;window.location.reload();}
    catch(error){language.value=locale;showError(error);}
  });
  on(window,'beforeunload',event=>{if(!allowUnload&&dirty()){event.preventDefault();(event as BeforeUnloadEvent).returnValue='';}});
  on(document,'keydown',event=>{
    const key=event as KeyboardEvent;if(!(key.ctrlKey||key.metaKey)||key.altKey)return;
    if(document.querySelector('dialog[open]')&&['s','o'].includes(key.key.toLowerCase())){key.preventDefault();return;}
    if(key.key.toLowerCase()==='s'){key.preventDefault();void run(save);}
    if(key.key.toLowerCase()==='o'){key.preventDefault();get('openFormula').click();}
  });
  on(preview,'pointerdown',event=>{
    const pointer=event as PointerEvent;if(pointer.button===0&&event.target instanceof Element&&!event.target.closest('.inline-formula,textarea,button')){event.preventDefault();math!.hooks.activate(formula,model,'end');}
  });
  // The lone formula is ready for typing as soon as the page opens.
  activateSavedCursor();
  return {math,get model(){return model;},get dirty(){return dirty();},openFile,save,dispose(){
    if(disposed)return;disposed=true;events.abort();fileInput.remove();
    try{math!.dispose();}finally{inspector!.dispose();if(window.mathjaxLoadFailed===loadFailure)window.mathjaxLoadFailed=previousLoadFailure;}
  }};
}

mountStandaloneMathEditor();
