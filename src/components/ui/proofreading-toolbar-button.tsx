'use client';

import {useContext} from 'react';
import {useEditorReadOnly} from 'platejs/react';
import {HostContext} from '@/plate-editor-context';
import {ProofreadingTools} from './proofreading-tools';

/** Plate integration only; the tools themselves know only the proofreading client. */
export function ProofreadingToolbarButton(){
  const host=useContext(HostContext),readOnly=useEditorReadOnly();
  return host?.proofreader?<ProofreadingTools service={host.proofreader} readOnly={readOnly||host.readOnly}
    onConfigure={()=>document.getElementById('openPreferences')?.click()}/>:null;
}
