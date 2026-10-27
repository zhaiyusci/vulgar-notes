'use client';

import * as React from 'react';
import {FilePlusIcon,FolderOpenIcon,SaveIcon,CopyIcon,HouseIcon} from 'lucide-react';
import {getDocumentState,runDocumentCommand,subscribeDocumentState} from '@/document-lifecycle';
import {t} from '@/i18n';
import {ToolbarButton} from './toolbar';

export function DocumentFileToolbarButtons() {
  const state=React.useSyncExternalStore(subscribeDocumentState,getDocumentState,getDocumentState);
  return <>
    <ToolbarButton tooltip="Recent documents" aria-label={t('Recent documents')} disabled={state.busy} onClick={()=>void runDocumentCommand('home')}><HouseIcon className="size-4" /></ToolbarButton>
    <ToolbarButton tooltip="New document" aria-label={t('New document')} disabled={state.busy} onClick={()=>void runDocumentCommand('new')}><FilePlusIcon className="size-4" /></ToolbarButton>
    <ToolbarButton tooltip="Open document" aria-label={t('Open document')} disabled={state.busy} onClick={()=>void runDocumentCommand('open')}><FolderOpenIcon className="size-4" /></ToolbarButton>
    <ToolbarButton tooltip="Save document" aria-label={t('Save document')} disabled={state.busy||!state.active} onClick={()=>void runDocumentCommand('save')}><SaveIcon className="size-4" /></ToolbarButton>
    <ToolbarButton tooltip="Save document as" aria-label={t('Save document as')} disabled={state.busy||!state.active} onClick={()=>void runDocumentCommand('saveAs')}><CopyIcon className="size-4" /></ToolbarButton>
    <span data-document-status className="max-w-40 truncate px-1 text-xs text-muted-foreground" title={state.name} aria-live="polite">{state.dirty?'• ':''}{state.name}</span>
  </>;
}
