import {t} from '@/i18n';
export function LabelMarker({id,label}:{id:string;label:string}){
  return <button type="button" contentEditable={false} className="tex-label-marker" title={'\\label{'+label+'}'} aria-label={t('Set label')+': '+label}
    onMouseDown={e=>e.preventDefault()} onClick={()=>document.dispatchEvent(new CustomEvent('edit-tex-label',{detail:id}))}>{label}</button>;
}
