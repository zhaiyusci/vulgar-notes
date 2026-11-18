import type {EditorModel} from './editor-model';
import type {MathEditor,MathSourceEditorContext} from './math-editor';
import {createMathTreeView} from './math-tree-view';
import {maxFormulaFileBytes} from './math-editor-file';
import {normalizeMathSource} from './tex-import';
import {t} from './i18n';

interface InspectorPorts {
  math():MathEditor|undefined;
  model():EditorModel;
  name():string;
  focusMath():void;
}
const viewKey='vulgar-notes.formula-editor.views';
type InspectorTab='latex'|'tree'|'none';

/** Read-only views of the live formula; importing is a separate transaction. */
export function createStandaloneMathInspector(ports:InspectorPorts){
  const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const workspace=document.querySelector<HTMLElement>('.formula-workspace')!;
  const sourceView=get('latexSource'),status=get('latexStatus');
  const tree=createMathTreeView(get('syntaxTree'));
  const events=new AbortController();
  const on=(target:EventTarget,event:string,callback:EventListener)=>target.addEventListener(event,callback,{signal:events.signal});
  let tab:InspectorTab='tree',mathPanel=true,context:MathSourceEditorContext|undefined;
  let disposed=false;
  try{const saved=JSON.parse(localStorage.getItem(viewKey)||'null');if(saved){mathPanel=saved.mathPanel!==false;if(['latex','tree','none'].includes(saved.tab))tab=saved.tab;}}catch{}
  function remember(){try{localStorage.setItem(viewKey,JSON.stringify({mathPanel,tab}));}catch{}}
  function update(model=ports.model()){
    const source=model.exportLatex();if(sourceView.textContent!==source)sourceView.textContent=source;
    if(tab==='tree')tree.update(model);
  }
  function show(){
    get('mathPanel').hidden=!mathPanel;workspace.classList.toggle('math-panel-hidden',!mathPanel);
    get('toggleMathPanel').setAttribute('aria-pressed',String(mathPanel));
    get('formulaInspector').hidden=tab==='none';workspace.classList.toggle('inspector-hidden',tab==='none');
    get('latexPane').hidden=tab!=='latex';get('syntaxTreePane').hidden=tab!=='tree';
    for(const [button,which] of [['showLatex','latex'],['showSyntaxTree','tree']] as const)get(button).setAttribute('aria-pressed',String(tab===which));
    for(const [button,which] of [['latexTab','latex'],['syntaxTreeTab','tree']] as const){get(button).setAttribute('aria-selected',String(tab===which));get(button).tabIndex=tab===which?0:-1;}
    update();remember();ports.math()?.hooks.change();
  }
  const sourceEditor={
    label:t('View LaTeX'),
    open(next:MathSourceEditorContext){context=next;tab='latex';show();},
    close(){context=undefined;},
  };
  function openLatex(){ports.math()?.openSource();}
  const dialog=document.createElement('dialog');dialog.className='document-unsaved-dialog latex-import-dialog';dialog.id='latexImportDialog';
  const title=document.createElement('h2');title.id='latexImportTitle';title.textContent=t('Import LaTeX');dialog.setAttribute('aria-labelledby',title.id);
  const input=document.createElement('textarea');input.id='latexImportSource';input.spellcheck=false;input.setAttribute('aria-label',t('LaTeX to import'));input.placeholder=t('Paste LaTeX to import');
  const importError=document.createElement('p');importError.className='latex-import-error';importError.setAttribute('role','status');
  const actions=document.createElement('div');actions.className='document-unsaved-actions';
  const fileButton=document.createElement('button');fileButton.type='button';fileButton.id='chooseLatexFile';fileButton.textContent=t('Choose .tex file');
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent=t('Cancel');cancel.dataset.choice='cancel';
  const confirm=document.createElement('button');confirm.type='button';confirm.textContent=t('Import');confirm.dataset.choice='save';
  actions.append(fileButton,cancel,confirm);dialog.append(title,input,importError,actions);document.body.append(dialog);
  const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='.tex,.latex,.txt,text/plain';fileInput.hidden=true;dialog.append(fileInput);
  let importEpoch=0;
  on(get('importLatex'),'click',()=>{
    openLatex();input.value='';confirm.disabled=true;importError.textContent='';++importEpoch;dialog.showModal();input.focus();
  });
  on(input,'input',()=>{confirm.disabled=!input.value.trim();});
  on(fileButton,'click',()=>fileInput.click());
  on(fileInput,'change',()=>{
    const file=fileInput.files?.[0],epoch=importEpoch;fileInput.value='';if(!file)return;
    void (async()=>{try{if(file.size>maxFormulaFileBytes)throw Error(t('The formula file is too large.'));const text=await file.text();if(disposed||!dialog.open||epoch!==importEpoch)return;input.value=text;confirm.disabled=!text.trim();importError.textContent='';input.focus();}catch(error){if(!disposed&&dialog.open&&epoch===importEpoch)importError.textContent=t(error instanceof Error?error.message:String(error));}})();
  });
  on(cancel,'click',()=>dialog.close());
  on(dialog,'close',()=>{++importEpoch;input.value='';ports.focusMath();});
  on(confirm,'click',()=>{
    if(!input.value.trim())return;
    try{
      if(new TextEncoder().encode(input.value).byteLength>maxFormulaFileBytes)throw Error(t('The formula file is too large.'));
      const source=normalizeMathSource(input.value)?.source??input.value;
      if(!context?.isCurrent()||!context.apply(source)){importError.textContent=t('The formula changed. Reopen import to continue.');return;}
      context=undefined;update();status.textContent=t('LaTeX imported.');dialog.close();
    }catch(error){importError.textContent=t(error instanceof Error?error.message:String(error));}
  });
  on(get('copyLatex'),'click',()=>{
    const source=ports.model().exportLatex();
    void (async()=>{try{await navigator.clipboard.writeText(source);if(!disposed)status.textContent=t('LaTeX copied.');}
    catch{if(disposed)return;const temporary=document.createElement('textarea');temporary.value=source;temporary.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(temporary);temporary.select();const copied=document.execCommand('copy');temporary.remove();status.textContent=t(copied?'LaTeX copied.':'Copy failed. Select the source and copy it manually.');}})();
  });
  on(get('downloadLatex'),'click',()=>{
    const url=URL.createObjectURL(new Blob([ports.model().exportLatex()],{type:'application/x-tex;charset=utf-8'})),anchor=document.createElement('a');
    anchor.href=url;anchor.download=(ports.name().replace(/\.(vulgar-math|json)$/i,'')||'formula')+'.tex';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    status.textContent=t('LaTeX file downloaded.');
  });
  for(const id of ['toggleMathPanel','showLatex','showSyntaxTree'])on(get(id),'pointerdown',event=>event.preventDefault());
  on(get('toggleMathPanel'),'click',()=>{mathPanel=!mathPanel;show();});
  on(get('showLatex'),'click',()=>{if(tab==='latex'){tab='none';show();ports.focusMath();}else openLatex();});
  on(get('showSyntaxTree'),'click',()=>{tab=tab==='tree'?'none':'tree';show();ports.focusMath();});
  on(get('latexTab'),'click',openLatex);
  on(get('syntaxTreeTab'),'click',()=>{tab='tree';show();});
  on(get('closeInspector'),'click',()=>{tab='none';show();ports.focusMath();});
  on(get('formulaInspector'),'keydown',event=>{
    const key=event as KeyboardEvent;if(!(key.target instanceof Element)||!key.target.closest('[role=tab]')||!['ArrowLeft','ArrowRight','Home','End'].includes(key.key))return;
    key.preventDefault();if(key.key==='Home'||(key.key==='ArrowLeft'||key.key==='ArrowRight')&&tab==='tree'){openLatex();get('latexTab').focus();}else{tab='tree';show();get('syntaxTreeTab').focus();}
  });
  show();
  return {sourceEditor,update,dispose(){disposed=true;events.abort();tree.dispose();dialog.remove();}};
}
