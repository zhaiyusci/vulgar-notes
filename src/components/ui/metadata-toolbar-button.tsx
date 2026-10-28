// SPDX-License-Identifier: GPL-3.0-or-later
'use client';

import {useContext} from 'react';
import {FilePenLineIcon} from 'lucide-react';
import {useEditorRef} from 'platejs/react';
import {createMetadataBlock} from '@/document-metadata';
import {HostContext} from '@/plate-math-element';
import {t} from '@/i18n';
import {ToolbarButton} from './toolbar';

export function MetadataToolbarButton(){
  const editor=useEditorRef(),host=useContext(HostContext);
  const open=()=>{
    if(editor.api.isReadOnly()||host?.readOnly)return;
    host?.prepareTextInsertion();
    editor.tf.withNewBatch(()=>{
      let index=editor.children.findIndex(node=>node.type==='document_metadata');
      if(index===-1){index=0;editor.tf.insertNodes(createMetadataBlock(),{at:[index]});}
      editor.tf.select(editor.api.start([index]));
    });
    editor.tf.focus();
  };
  return <ToolbarButton className="document-metadata-trigger" tooltip={t('Metadata')} aria-label={t('Metadata')}
    disabled={editor.api.isReadOnly()||host?.readOnly} onPointerDown={event=>event.preventDefault()} onClick={open}>
    <FilePenLineIcon /><span>{t('Metadata')}</span>
  </ToolbarButton>;
}
