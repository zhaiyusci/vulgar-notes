// SPDX-License-Identifier: GPL-3.0-or-later
import {invoke,isTauri} from '@tauri-apps/api/core';
import {t} from './i18n';
import type {PrintOptions} from './print-document';

export interface PdfExportEnvironment {
  native:boolean;
  openWindow():Window|null;
  saveNative(html:string,options:PrintOptions,suggestedName:string):Promise<boolean>;
}

export function nativePdfAvailable():boolean {
  return isTauri()&&/Windows|Win32|Win64/i.test(navigator.userAgent+' '+navigator.platform);
}

function pdfEnvironment():PdfExportEnvironment {
  return {
    native:nativePdfAvailable(),
    openWindow:()=>window.open('about:blank','_blank'),
    saveNative:(html,options,suggestedName)=>invoke<boolean>('export_pdf',{html,options,suggestedName}),
  };
}

/** Fonts and images must finish loading in the new browsing context as well. */
export async function waitForPrintResources(target:Window,timeoutMs=45_000):Promise<void> {
  const document=target.document,events=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let closedCheck:ReturnType<typeof setInterval>|undefined;
  let paintFallback:ReturnType<typeof setTimeout>|undefined,firstFrame:number|undefined,secondFrame:number|undefined;
  const timeout=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(Error('The print document did not finish loading.')),timeoutMs);
    closedCheck=setInterval(()=>{if(target.closed)reject(Error('The print window was closed.'));},100);
  });
  const images=Array.from(document.images,image=>{
    image.loading='eager';
    if(image.complete)return image.naturalWidth?Promise.resolve():Promise.reject(Error('An image could not be loaded for PDF export.'));
    return new Promise<void>((resolve,reject)=>{
      image.addEventListener('load',()=>resolve(),{once:true,signal:events.signal});
      image.addEventListener('error',()=>reject(Error('An image could not be loaded for PDF export.')),{once:true,signal:events.signal});
    });
  });
  try{
    // Reading layout starts fonts referenced by the inserted document.
    void document.body.offsetHeight;
    await Promise.race([Promise.all([document.fonts.ready,...images]),timeout]);
    if(target.closed)throw Error('The print window was closed.');
    await Promise.race([new Promise<void>(resolve=>{
      // Background tabs can suspend animation frames. Resources are already
      // ready, so a layout flush also completes preparation without a frame.
      const painted=()=>{void document.body.offsetHeight;resolve();};
      paintFallback=setTimeout(painted,100);
      firstFrame=target.requestAnimationFrame(()=>{secondFrame=target.requestAnimationFrame(painted);});
    }),timeout]);
  }finally{
    clearTimeout(timer);clearTimeout(paintFallback);clearInterval(closedCheck);events.abort();
    if(firstFrame!==undefined)target.cancelAnimationFrame?.(firstFrame);
    if(secondFrame!==undefined)target.cancelAnimationFrame?.(secondFrame);
  }
}

/** Call directly from the export button so opening a web print tab retains the user gesture. */
export async function exportPdfDocument(
  render:()=>Promise<string>,options:PrintOptions,suggestedName='document.pdf',
  environment:PdfExportEnvironment=pdfEnvironment(),
):Promise<boolean> {
  if(environment.native)return environment.saveNative(await render(),options,suggestedName);
  const target=environment.openWindow();
  if(!target)throw Error('Could not open the print window. Allow pop-ups and try again.');
  try{
    target.opener=null;
    target.document.title=t('Preparing PDF…');
    target.document.body.textContent=t('Preparing PDF…');
    const html=await render();
    if(target.closed)return false;
    target.document.open();target.document.write(html);target.document.close();
    await waitForPrintResources(target);
    if(target.closed)return false;
    // Keep the tab alive until the browser has finished its print dialog.
    target.addEventListener('afterprint',()=>target.close(),{once:true});
    target.focus();target.print();
    return true;
  }catch(error){
    if(target.closed)return false;
    target.close();
    throw error;
  }
}
