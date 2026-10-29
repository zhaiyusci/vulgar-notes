'use client';

import * as React from 'react';

import { insertInlineEquation } from '@/plate-math-plugins';
import { RadicalIcon } from 'lucide-react';
import { useEditorRef } from 'platejs/react';
import {HostContext} from '@/plate-math-element';

import { ToolbarButton } from './toolbar';

export function InlineEquationToolbarButton(
  props: React.ComponentProps<typeof ToolbarButton>
) {
  const editor = useEditorRef();
  const host=React.useContext(HostContext);

  return (
    <ToolbarButton
      {...props}
      onPointerDown={event=>event.preventDefault()}
      onClick={() => {
        if(host){host.insertFormula(false,editor.selection?editor.api.string(editor.selection):'');return;}
        insertInlineEquation(editor);
      }}
      tooltip="Mark as equation"
    >
      <RadicalIcon />
    </ToolbarButton>
  );
}
