import {useContext,useEffect,useRef,useState} from 'react';
import {BookOpenIcon} from 'lucide-react';
import {NodeApi} from 'platejs';
import {useEditorRef} from 'platejs/react';
import type {Range} from 'slate';
import {HostContext} from '@/plate-math-element';
import {referenceTargets,validReferenceKey,type ReferenceCommand,type ReferenceNode} from '@/references';
import {t} from '@/i18n';
import {ToolbarButton} from './toolbar';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './dialog';
import {Button} from './button';

type Action='ref'|'eqref'|'cite'|'bibitem';
export function ReferenceToolbarButton(){
  const editor=useEditorRef(),host=useContext(HostContext);
  const [open,setOpen]=useState(false),[action,setAction]=useState<Action>('eqref');
  const [key,setKey]=useState(''),[description,setDescription]=useState(''),[error,setError]=useState('');
  const selection=useRef<Range|null>(null),editing=useRef<string|undefined>(undefined);
  const targets=referenceTargets(editor.children);
  const start=(node?:ReferenceNode)=>{
    host?.prepareTextInsertion();selection.current=editor.selection?structuredClone(editor.selection):null;
    editing.current=node?.id as string|undefined;
    setAction(node?.command||'eqref');setKey(node?.keys.join(', ')||'');setDescription('');setError('');
    setOpen(true);
  };
  useEffect(()=>{
    const edit=(event:Event)=>{
      if(editor.api.isReadOnly())return;
      const node=[...NodeApi.nodes(editor)].find(([n])=>n.type==='tex_reference'&&n.id===(event as CustomEvent).detail)?.[0];
      if(node)start(node as ReferenceNode);
    };
    document.addEventListener('edit-tex-reference',edit);return()=>document.removeEventListener('edit-tex-reference',edit);
  });
  const choose=(value:Action)=>{
    setAction(value);setError('');setKey('');
    editing.current=undefined;
  };
  const submit=()=>{
    const keys=key.split(',').map(k=>k.trim());
    if(!keys.every(validReferenceKey)||action!=='cite'&&keys.length!==1){setError(t('Use a letter followed by letters, digits, colon, dot, underscore or hyphen.'));return;}
    try{
      if(action==='bibitem'){
        if(!description.trim())throw Error(t('Enter the bibliography entry.'));
        if(targets.some(x=>x.kind==='bibliography'&&x.key===keys[0]))throw Error(t('This citation key already exists.'));
        editor.tf.withNewBatch(()=>editor.tf.insertNodes({type:'bibliography_entry',citeKey:keys[0],children:[{text:description.trim()}]},{at:[editor.children.length]}));
      }else{
        const existing=editing.current?[...NodeApi.nodes(editor)].find(([n])=>n.type==='tex_reference'&&n.id===editing.current):undefined;
        editor.tf.withNewBatch(()=>{
          if(existing)editor.tf.setNodes({command:action,keys},{at:existing[1]});
          else{
            if(selection.current)editor.tf.select(selection.current);
            editor.tf.insertNodes({type:'tex_reference',id:crypto.randomUUID(),command:action as ReferenceCommand,keys,children:[{text:''}]},{select:true});
            editor.tf.move({distance:1,unit:'offset'});
          }
        });
      }
      setOpen(false);editor.tf.focus();
    }catch(err){setError(err instanceof Error?err.message:String(err));}
  };
  const candidates=targets.filter(x=>x.key&&(action==='cite'?x.kind==='bibliography':action==='eqref'?x.kind==='equation':x.kind!=='bibliography'));
  return <>
    <ToolbarButton tooltip={t('References')} onPointerDown={e=>e.preventDefault()} onClick={()=>start()}><BookOpenIcon /></ToolbarButton>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent onCloseAutoFocus={e=>e.preventDefault()}>
      <DialogTitle>{t('References')}</DialogTitle>
      <DialogDescription>{t('Labels and citation keys remain stable when numbering changes.')}</DialogDescription>
      <label>{t('Action')}<select className="block w-full rounded border p-2" value={action} onChange={e=>choose(e.target.value as Action)}>
        <option value="ref">\ref — {t('Cross-reference')}</option>
        <option value="eqref">\eqref — {t('Equation reference')}</option><option value="cite">\cite — {t('Citation')}</option>
        <option value="bibitem">\bibitem — {t('Add bibliography entry')}</option>
      </select></label>
      <label>{action==='cite'||action==='bibitem'?t('Citation key'):t('Label')}<input className="block w-full rounded border p-2" value={key} onChange={e=>setKey(e.target.value)} placeholder={action==='cite'||action==='bibitem'?'einstein1905':'eq:energy'} /></label>
      {action!=='bibitem'&&<div className="max-h-40 overflow-auto rounded border">
        {candidates.map(x=><button type="button" className="block w-full px-2 py-1 text-left hover:bg-muted" key={x.path.join('.')} onClick={()=>setKey(action==='cite'&&key.trim()?key+', '+x.key:x.key)}>{x.key} — {x.number} {x.description.slice(0,60)}</button>)}
      </div>}
      {action==='bibitem'&&<label>{t('Bibliography entry')}<textarea className="block w-full rounded border p-2" rows={4} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Author. Title. Journal, year." /></label>}
      {action==='cite'&&<p className="text-sm text-muted-foreground">{t('Separate multiple citation keys with commas.')}</p>}
      {error&&<p role="alert" className="text-red-600">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setOpen(false)}>{t('Cancel')}</Button><Button onClick={submit}>{t('Apply')}</Button></div>
    </DialogContent></Dialog>
  </>;
}
