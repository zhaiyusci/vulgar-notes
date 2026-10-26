import {useCallback,useContext,useEffect,useRef,useState} from 'react';
import {Link2Icon} from 'lucide-react';
import {NodeApi} from 'platejs';
import {useEditorRef,useEditorSelector} from 'platejs/react';
import type {Range} from 'slate';
import {HostContext} from '@/plate-math-element';
import {referenceTargets,validReferenceKey,type ReferenceCommand,type ReferenceNode} from '@/references';
import {validCitationKey} from '@/bibtex';
import {useBibliographyLibraries} from '@/use-bibliography';
import {t} from '@/i18n';
import {ToolbarButton} from './toolbar';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './dialog';
import {Button} from './button';
import {BibtexLibrariesButton} from './bibtex-libraries-button';

type ReferenceKind='cross-reference'|'citation';
type CrossReferenceCommand=Exclude<ReferenceCommand,'cite'>;

export function CrossReferenceToolbarButton(){return <ReferenceDialog kind="cross-reference" />;}
/** Existing citations remain editable; new citations are inserted from the library manager. */
export function CitationReferenceEditor(){return <ReferenceDialog kind="citation" />;}

/** Cross-references and existing citations have independent editors and cannot change kinds. */
function ReferenceDialog({kind}:{kind:ReferenceKind}){
  const editor=useEditorRef(),host=useContext(HostContext);
  const libraries=useBibliographyLibraries();
  const citation=kind==='citation';
  const title=t(citation?'Citation':'Cross-reference');
  const [open,setOpen]=useState(false),[crossCommand,setCrossCommand]=useState<CrossReferenceCommand>('eqref');
  const action:ReferenceCommand=citation?'cite':crossCommand;
  const [key,setKey]=useState(''),[error,setError]=useState('');
  const [query,setQuery]=useState('');
  const selection=useRef<Range|null>(null),editing=useRef<string|undefined>(undefined);
  const targets=useEditorSelector(editor=>referenceTargets(editor.children,libraries),[libraries]);
  const start=useCallback((node?:ReferenceNode)=>{
    if(editor.api.isReadOnly())return;
    if(citation&&(!node||typeof node.id!=='string'||!node.id))return;
    host?.prepareTextInsertion();
    selection.current=editor.selection?structuredClone(editor.selection):null;
    editing.current=node?.id as string|undefined;
    setCrossCommand(node?.command==='ref'?'ref':'eqref');setKey(node?.keys.join(', ')||'');setError('');setQuery('');
    setOpen(true);
  },[editor,host,citation]);
  useEffect(()=>{
    const edit=(event:Event)=>{
      if(editor.api.isReadOnly())return;
      const node=[...NodeApi.nodes(editor)].find(([n])=>n.type==='tex_reference'&&n.id===(event as CustomEvent).detail)?.[0];
      if(!node)return;
      if(citation?node.command==='cite':node.command==='ref'||node.command==='eqref')start(node as ReferenceNode);
      else setOpen(false);
    };
    document.addEventListener('edit-tex-reference',edit);return()=>document.removeEventListener('edit-tex-reference',edit);
  },[editor,citation,start]);
  const submit=()=>{
    const keys=key.split(',').map(k=>k.trim());
    if(!keys.every(citation?validCitationKey:validReferenceKey)||action!=='cite'&&keys.length!==1){setError(t(citation?'Use a citation key containing letters, digits, colon, dot, underscore, slash, plus, hyphen or apostrophe.':'Use a letter followed by letters, digits, colon, dot, underscore or hyphen.'));return;}
    try{
      const existing=editing.current?[...NodeApi.nodes(editor)].find(([n])=>n.type==='tex_reference'&&n.id===editing.current):undefined;
      if(citation&&!existing){setError(t('This reference is no longer available.'));return;}
      if(editing.current&&(!existing||(citation?existing[0].command!=='cite':existing[0].command!=='ref'&&existing[0].command!=='eqref'))){setError(t('This reference is no longer available.'));return;}
      if(!existing&&!selection.current){setError(t('Place the cursor in the document first.'));return;}
      editor.tf.withNewBatch(()=>{
        if(existing)editor.tf.setNodes({command:action,keys},{at:existing[1]});
        else{
          editor.tf.select(selection.current!);
          editor.tf.insertNodes({type:'tex_reference',id:crypto.randomUUID(),command:action,keys,children:[{text:''}]},{select:true});
          editor.tf.move({distance:1,unit:'offset'});
        }
      });
      setOpen(false);editor.tf.focus();
    }catch(err){setError(err instanceof Error?err.message:String(err));}
  };
  const chooseKey=(chosen:string)=>setKey(previous=>action==='cite'?[...new Set([...previous.split(',').map(part=>part.trim()).filter(Boolean),chosen])].join(', '):chosen);
  const search=query.trim().toLocaleLowerCase();
  const candidates=targets.filter(x=>x.key&&(action==='cite'?x.kind==='bibliography':action==='eqref'?x.kind==='equation':x.kind!=='bibliography'&&x.kind!=='endnote')&&(!search||(x.key+' '+x.description).toLocaleLowerCase().includes(search)));
  return <>
    {!citation&&<ToolbarButton tooltip={title} aria-label={title} title={title} onPointerDown={e=>e.preventDefault()} onClick={()=>start()}><Link2Icon /></ToolbarButton>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={e=>e.preventDefault()}>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{t(citation?'Cite entries from your bibliography libraries. Citation keys stay stable when numbering changes.':'Reference a label in the document. Labels stay stable when numbering changes.')}</DialogDescription>
      {!citation&&<label>{t('Reference type')}<select aria-label={t('Reference type')} className="block w-full rounded border p-2" value={crossCommand} onChange={e=>{setCrossCommand(e.target.value as CrossReferenceCommand);setError('');}}>
        <option value="ref">\ref — {t('Cross-reference')}</option>
        <option value="eqref">\eqref — {t('Equation reference')}</option>
      </select></label>}
      <label>{citation?t('Citation key'):t('Label')}<input aria-label={citation?t('Citation key'):t('Label')} className="block w-full rounded border p-2" value={key} onChange={e=>setKey(e.target.value)} placeholder={citation?'einstein1905':'eq:energy'} /></label>
        <input type="search" className="w-full rounded border px-3 py-2 text-sm" value={query} onChange={event=>setQuery(event.target.value)} aria-label={t(citation?'Search bibliography':'Search labels')} placeholder={t(citation?'Search by author, title or citation key':'Search labels')} />
        <div className="max-h-48 overflow-auto rounded border">
          {candidates.slice(0,100).map(x=><button type="button" className="block w-full px-2 py-2 text-left text-sm hover:bg-muted" key={x.libraryId?x.libraryId+':'+x.key:x.path.join('.')} onClick={()=>chooseKey(x.key)}><span className="font-mono text-xs">{x.key}</span>{x.number?' — '+x.number:''}<span className="block truncate text-muted-foreground">{x.description}</span></button>)}
          {!candidates.length&&<p className="p-3 text-sm text-muted-foreground">{t('No matching references.')}</p>}
        </div>
        {candidates.length>100&&<p className="text-xs text-muted-foreground">{t('Showing the first 100 matches. Refine your search to find an entry.')}</p>}
      {citation&&<div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{t('Separate multiple citation keys with commas.')}</p><BibtexLibrariesButton compact onChooseKey={chooseKey} /></div>}
      {error&&<p role="alert" className="text-red-600">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setOpen(false)}>{t('Cancel')}</Button><Button onClick={submit}>{t('Apply')}</Button></div>
    </DialogContent></Dialog>
  </>;
}
