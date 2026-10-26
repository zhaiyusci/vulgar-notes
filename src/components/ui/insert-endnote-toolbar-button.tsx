import {useContext} from 'react';
import {StickyNoteIcon} from 'lucide-react';
import {useEditorRef} from 'platejs/react';
import {HostContext} from '@/plate-math-element';
import {insertEndnote} from '@/components/editor/insert-endnote';
import {t} from '@/i18n';
import {ToolbarButton} from './toolbar';

export function InsertEndnoteToolbarButton(){
  const editor=useEditorRef(),host=useContext(HostContext);
  return <ToolbarButton tooltip={t('Insert endnote')} title={t('Insert endnote')} aria-label={t('Insert endnote')}
    onPointerDown={event=>event.preventDefault()} onClick={()=>insertEndnote(editor,host??undefined)}>
    <StickyNoteIcon />
  </ToolbarButton>;
}
