import React,{useContext,useEffect,useState} from 'react';
import {PilcrowIcon,TypeIcon} from 'lucide-react';
import {HostContext} from '@/plate-editor-context';
import {ToolbarButton} from './toolbar';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from './dialog';
import {defaultTypography,mathFonts,type MathFont} from '@/document-typography';
import {showFormattingMarks} from '@/formatting-marks';
import {t} from '@/i18n';

export function DocumentTypeTools({readOnly}:{readOnly:boolean}){
  const host=useContext(HostContext);
  const [marks,setMarks]=useState(()=>{try{return localStorage.getItem('editor.formattingMarks')==='true';}catch{return false;}});
  const [open,setOpen]=useState(false),[draft,setDraft]=useState(defaultTypography);
  useEffect(()=>{
    const editor=host?.mount.querySelector<HTMLElement>('[data-slate-editor]');
    if(marks&&editor)return showFormattingMarks(editor);
  },[marks,host]);
  return <>
    <ToolbarButton tooltip="Show formatting marks" aria-pressed={marks} onMouseDown={e=>e.preventDefault()} onClick={()=>{
      setMarks(!marks);try{localStorage.setItem('editor.formattingMarks',String(!marks));}catch{/* Per-window toggle still works. */}
    }}><PilcrowIcon /></ToolbarButton>
    {!readOnly&&<ToolbarButton tooltip="Document typography" onClick={()=>{setDraft(host?.typography??defaultTypography);setOpen(true);}}>
      <TypeIcon /><span>{t('Document typography')}</span>
    </ToolbarButton>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-sm">
      <DialogHeader><DialogTitle>{t('Document typography')}</DialogTitle></DialogHeader>
      <form className="vn-type-form" onSubmit={event=>{event.preventDefault();host?.setTypography(draft);setOpen(false);}}>
        <label>{t('Body font')}<input list="vn-body-fonts" maxLength={100} pattern={'[\\p{L}\\p{N} ._\\-]*'} value={draft.bodyFont} placeholder={t('System default')} onChange={e=>setDraft({...draft,bodyFont:e.target.value})}/></label>
        <datalist id="vn-body-fonts">{['Times New Roman','Georgia','Arial','Cambria','SimSun','Microsoft YaHei'].map(f=><option key={f}>{f}</option>)}</datalist>
        <label>{t('Body size (pt)')}<input type="number" min="6" max="96" step="any" required defaultValue={draft.bodyPt} onChange={e=>setDraft({...draft,bodyPt:e.target.valueAsNumber})}/></label>
        <label>{t('Math font')}<select value={draft.mathFont} onChange={e=>setDraft({...draft,mathFont:e.target.value as MathFont})}>{Object.entries(mathFonts).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label>{t('Math size (pt)')}<input type="number" min="6" max="96" step="any" defaultValue={draft.mathPt??''} placeholder={t('Follow surrounding text')} onChange={e=>setDraft({...draft,mathPt:e.target.value===''?null:e.target.valueAsNumber})}/></label>
        <button type="submit">{t('Apply')}</button>
      </form>
    </DialogContent></Dialog>
  </>;
}
