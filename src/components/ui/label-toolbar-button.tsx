import {useContext,useEffect,useRef,useState} from 'react';
import {TagIcon} from 'lucide-react';
import {useEditorRef} from 'platejs/react';
import type {Range} from 'slate';
import {HostContext} from '@/plate-math-element';
import {referenceTargets,validReferenceKey} from '@/references';
import {t} from '@/i18n';
import {ToolbarButton} from './toolbar';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './dialog';
import {Button} from './button';

/** Both the toolbar and document markers open the same label-only editor. */
export function LabelToolbarButton(){
  const editor=useEditorRef(),host=useContext(HostContext);
  const [open,setOpen]=useState(false),[key,setKey]=useState(''),[error,setError]=useState('');
  const selection=useRef<Range|null>(null),targetId=useRef<string|undefined>(undefined);
  const start=(id?:string)=>{
    const chosenId=id||host?.activeFormulaId;
    const chosen=chosenId?referenceTargets(editor.children).find(x=>x.node.id===chosenId&&x.kind!=='bibliography'&&x.kind!=='endnote'):undefined;
    host?.prepareTextInsertion();
    selection.current=editor.selection?structuredClone(editor.selection):null;
    targetId.current=chosen?.node.id as string|undefined;
    setKey(chosen?.key||'');setError('');setOpen(true);
  };
  useEffect(()=>{
    const edit=(event:Event)=>start((event as CustomEvent).detail);
    document.addEventListener('edit-tex-label',edit);
    return()=>document.removeEventListener('edit-tex-label',edit);
  });
  const submit=()=>{
    const value=key.trim(),targets=referenceTargets(editor.children);
    const chosen=targets.find(x=>targetId.current&&x.node.id===targetId.current);
    if(value&&!validReferenceKey(value)){setError(t('Use a letter followed by letters, digits, colon, dot, underscore or hyphen.'));return;}
    if(value&&targets.some(x=>x.kind!=='bibliography'&&x.kind!=='endnote'&&x.key===value&&x.node!==chosen?.node)){setError(t('This label already exists.'));return;}
    if(!chosen&&!selection.current){setError(t('Place the cursor in the document first.'));return;}
    editor.tf.withNewBatch(()=>{
      if(chosen){
        if(value)editor.tf.setNodes({texLabel:value},{at:chosen.path});
        else if(chosen.kind==='anchor')editor.tf.removeNodes({at:chosen.path});
        else editor.tf.unsetNodes('texLabel',{at:chosen.path});
      }else if(value){
        editor.tf.select(selection.current!);editor.tf.collapse({edge:'end'});
        editor.tf.insertNodes({type:'tex_label',id:crypto.randomUUID(),texLabel:value,children:[{text:''}]},{select:true});
        editor.tf.move({distance:1,unit:'offset'});
      }
    });
    setOpen(false);editor.tf.focus();
  };
  return <>
    <ToolbarButton tooltip={t('Set label')} onPointerDown={e=>e.preventDefault()} onClick={()=>start()}><TagIcon /></ToolbarButton>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent onCloseAutoFocus={e=>e.preventDefault()}>
      <DialogTitle>{t('Set label')}</DialogTitle>
      <DialogDescription>{t('Label this location. Clear the name to remove an existing label.')}</DialogDescription>
      <label>{t('Label')}<input autoFocus className="block w-full rounded border p-2" value={key} onChange={e=>setKey(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();submit();}}} /></label>
      {error&&<p role="alert" className="text-red-600">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setOpen(false)}>{t('Cancel')}</Button><Button onClick={submit}>{t('Apply')}</Button></div>
    </DialogContent></Dialog>
  </>;
}
