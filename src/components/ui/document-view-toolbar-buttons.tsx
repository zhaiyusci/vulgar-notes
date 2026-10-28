'use client';

import * as React from 'react';
import {TableOfContentsIcon} from 'lucide-react';
import {useEditorRef} from 'platejs/react';
import {HostContext} from '@/plate-math-element';
import {insertBlock} from '@/components/editor/transforms';
import {ToolbarButton} from './toolbar';

export function DocumentViewToolbarButtons(){
  const editor=useEditorRef(),host=React.useContext(HostContext);
  const insertContents=()=>{
    if(editor.api.isReadOnly())return;
    host?.prepareTextInsertion();
    if(!editor.selection)editor.tf.select(editor.api.end([]));
    insertBlock(editor,'toc');editor.tf.focus();
  };
  return <ToolbarButton tooltip="Insert table of contents" onPointerDown={event=>event.preventDefault()}
    onClick={insertContents}><TableOfContentsIcon /></ToolbarButton>;
}
