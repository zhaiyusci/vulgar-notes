'use client';
import {useSyncExternalStore,type ReactNode} from 'react';
import {getEditorZoom,subscribeEditorZoom} from '@/editor-zoom';

/** Scale document content without coupling it to toolbar actions or parsers. */
export function DocumentZoomSurface({children}:{children:ReactNode}){
  const zoom=useSyncExternalStore(subscribeEditorZoom,getEditorZoom,()=>100 as const);
  return <div className="document-zoom-surface" data-editor-zoom={zoom} style={{zoom:zoom/100}}>{children}</div>;
}
