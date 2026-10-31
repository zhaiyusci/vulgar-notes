'use client';

import * as React from 'react';

import { Redo2Icon, Undo2Icon } from 'lucide-react';
import { useEditorRef, useEditorSelector } from 'platejs/react';

import { ToolbarButton } from './toolbar';
import {HostContext} from '@/plate-math-element';
import {inactiveCollaboration} from '@/collaboration-types';

const noSubscription=()=>()=>{};
const noCollaboration=()=>inactiveCollaboration;

export function RedoToolbarButton(
  props: React.ComponentProps<typeof ToolbarButton>
) {
  const editor = useEditorRef();
  const host=React.useContext(HostContext);
  const collaboration=React.useSyncExternalStore(host?.subscribeCollaboration??noSubscription,host?.getCollaborationState??noCollaboration,noCollaboration);
  const standaloneDisabled = useEditorSelector(
    (editor) => editor.history.redos.length === 0,
    []
  );
  const disabled=collaboration.active?!host?.canRedoCollaboration():standaloneDisabled;

  return (
    <ToolbarButton
      {...props}
      disabled={disabled}
      onClick={() => collaboration.active?host?.redoCollaboration():editor.redo()}
      onMouseDown={(e) => e.preventDefault()}
      tooltip="Redo"
    >
      <Redo2Icon />
    </ToolbarButton>
  );
}

export function UndoToolbarButton(
  props: React.ComponentProps<typeof ToolbarButton>
) {
  const editor = useEditorRef();
  const host=React.useContext(HostContext);
  const collaboration=React.useSyncExternalStore(host?.subscribeCollaboration??noSubscription,host?.getCollaborationState??noCollaboration,noCollaboration);
  const standaloneDisabled = useEditorSelector(
    (editor) => editor.history.undos.length === 0,
    []
  );
  const disabled=collaboration.active?!host?.canUndoCollaboration():standaloneDisabled;

  return (
    <ToolbarButton
      {...props}
      disabled={disabled}
      onClick={() => collaboration.active?host?.undoCollaboration():editor.undo()}
      onMouseDown={(e) => e.preventDefault()}
      tooltip="Undo"
    >
      <Undo2Icon />
    </ToolbarButton>
  );
}
