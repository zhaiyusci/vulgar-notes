'use client';

import * as React from 'react';
import {t} from '@/i18n';
import {exportPdfDocument,nativePdfAvailable} from '@/pdf-export';
import type {PrintOptions} from '@/print-document';
import {Button} from './button';
import {Dialog,DialogContent,DialogTitle} from './dialog';

export function PdfExportDialog({open,onOpenChange,render}:{
  open:boolean;onOpenChange(open:boolean):void;render(options:PrintOptions):Promise<string>;
}){
  const [paper,setPaper]=React.useState<PrintOptions['paper']>('a4');
  const [landscape,setLandscape]=React.useState(false),[margin,setMargin]=React.useState('20');
  const [pageNumbers,setPageNumbers]=React.useState(true),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  const running=React.useRef(false),native=nativePdfAvailable();
  const marginMm=Number(margin),validMargin=margin.trim()!==''&&Number.isFinite(marginMm)&&marginMm>=5&&marginMm<=40;
  const changeOpen=(next:boolean)=>{if(!running.current){setError('');onOpenChange(next);}};
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();if(running.current||!validMargin)return;
    running.current=true;setBusy(true);setError('');
    const options:PrintOptions={paper,landscape,marginMm,pageNumbers};
    try{
      const completed=await exportPdfDocument(()=>render(options),options);
      if(completed)onOpenChange(false);
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      if(message.startsWith('PDF font: '))setError(t('Cannot load PDF font {name}',{name:message.slice(10)}));
      else if(message.startsWith('PDF image: '))setError(t('Cannot load PDF image {number}',{number:message.slice(11)}));
      else setError(t(message));
    }
    finally{running.current=false;setBusy(false);}
  };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent showCloseButton={false} aria-describedby={undefined} onCloseAutoFocus={event=>event.preventDefault()}>
      <DialogTitle>{t('Export PDF')}</DialogTitle>
      <form className="grid gap-4" onSubmit={event=>void submit(event)} aria-busy={busy}>
        <fieldset disabled={busy} className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1 text-sm">{t('Paper size')}
              <select className="rounded border bg-background p-2" aria-label={t('Paper size')} value={paper} onChange={event=>setPaper(event.target.value as PrintOptions['paper'])}>
                <option value="a4">A4</option><option value="letter">Letter</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">{t('Orientation')}
              <select className="rounded border bg-background p-2" aria-label={t('Orientation')} value={landscape?'landscape':'portrait'} onChange={event=>setLandscape(event.target.value==='landscape')}>
                <option value="portrait">{t('Portrait')}</option><option value="landscape">{t('Landscape')}</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1 text-sm">{t('Margins (mm)')}
            <input type="number" min="5" max="40" step="1" required className="rounded border bg-background p-2" aria-label={t('Margins (mm)')} value={margin} onChange={event=>setMargin(event.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pageNumbers} onChange={event=>setPageNumbers(event.target.checked)} />{t('Page numbers')}</label>
          {!native&&<p className="text-xs text-muted-foreground">{t('Turn off headers and footers in the browser print settings.')}</p>}
        </fieldset>
        {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={()=>changeOpen(false)}>{t('Cancel')}</Button>
          <Button type="submit" disabled={busy||!validMargin}>{t(busy?'Preparing PDF…':native?'Save PDF':'Print / Save as PDF')}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
