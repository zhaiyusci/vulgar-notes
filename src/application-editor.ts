import {createMathEditor,type MathEditorElements} from './math-editor';
import {PlateMathHost} from './plate-host';
import {elementById} from './dom';
import {documentSessionId} from './platform';
import {documentMathClipboard} from './document-math-clipboard';

/** Only the application knows page IDs, recovery keys and which prose engine is mounted. */
export function mountApplicationEditor(onDocumentChange:()=>void){
  const elements:MathEditorElements={
    formula:elementById('formula',HTMLElement),preview:elementById('preview',HTMLElement),
    // Plate replaces the initial mount with its inner prose surface.
    get content(){return elementById('textFlow',HTMLElement);},input:elementById('mathInput',HTMLTextAreaElement),
    error:elementById('error',HTMLElement),panel:elementById('mathPanel',HTMLElement),
    toolbar:elementById('insertToolbar',HTMLElement),layout:elementById('formulaLayout',HTMLSelectElement),
    pendingFontHint:elementById('pendingFontHint',HTMLElement),structureCount:elementById('structureCount',HTMLElement),
    overlayRoot:document.body,countLabels:[...document.querySelectorAll<HTMLElement>('[data-count-category]')],
  };
  const session=documentSessionId(),key='math-editor-state'+(session?':'+session:'');
  const math=createMathEditor({elements,clipboard:documentMathClipboard,draft:{
    read:()=>sessionStorage.getItem(key)||(!session?document.getElementById('recoveredEditorState')?.textContent:null),
    write:snapshot=>sessionStorage.setItem(key,snapshot),
  }});
  const previousLoadFailure=window.mathjaxLoadFailed;
  window.mathjaxLoadFailed=math.notifyLoadFailure;
  const releaseMath=()=>{
    try{math.dispose();}
    finally{if(window.mathjaxLoadFailed===math.notifyLoadFailure)window.mathjaxLoadFailed=previousLoadFailure;}
  };
  try{
    const host=new PlateMathHost(elements.content,math.initialModel,{
      ...math.hooks,change:()=>{math.hooks.change();onDocumentChange();},
    });
    try{math.connect(host);}catch(error){try{host.destroy();}catch{/* Keep the original connection error. */}throw error;}
    let disposed=false;
    return {host,math,dispose(){
      if(disposed)return;disposed=true;
      try{host.destroy();}finally{releaseMath();}
    }};
  }catch(error){try{releaseMath();}catch{/* Keep the original construction or connection error. */}throw error;}
}
export type ApplicationEditor=ReturnType<typeof mountApplicationEditor>;
