'use client';

import {useSyncExternalStore} from 'react';
import {ZoomInIcon,ZoomOutIcon,RotateCcwIcon} from 'lucide-react';
import {EDITOR_ZOOM_LEVELS,getEditorZoom,subscribeEditorZoom,setEditorZoom,nextEditorZoom} from '@/editor-zoom';
import {t} from '@/i18n';

/** View controls live outside the document and retain its current editing selection. */
export function DocumentZoomControls(){
  const zoom=useSyncExternalStore(subscribeEditorZoom,getEditorZoom,()=>100 as const);
  return <div className="document-zoom-controls" role="group" aria-label={t('Editor zoom')}>
    <button type="button" aria-label={t('Zoom out')} title={t('Zoom out')} disabled={zoom===50}
      onPointerDown={event=>event.preventDefault()} onClick={()=>setEditorZoom(nextEditorZoom(zoom,-1))}><ZoomOutIcon aria-hidden="true" /></button>
    <select className="document-zoom-select" aria-label={t('Editor zoom')} value={zoom}
      onChange={event=>setEditorZoom(Number(event.target.value))}>
      {EDITOR_ZOOM_LEVELS.map(level=><option key={level} value={level}>{level}%</option>)}
    </select>
    <button type="button" aria-label={t('Zoom in')} title={t('Zoom in')} disabled={zoom===200}
      onPointerDown={event=>event.preventDefault()} onClick={()=>setEditorZoom(nextEditorZoom(zoom,1))}><ZoomInIcon aria-hidden="true" /></button>
    <button type="button" aria-label={t('Reset zoom to 100%')} title={t('Reset zoom to 100%')} disabled={zoom===100}
      onPointerDown={event=>event.preventDefault()} onClick={()=>setEditorZoom(100)}><RotateCcwIcon aria-hidden="true" /></button>
  </div>;
}
