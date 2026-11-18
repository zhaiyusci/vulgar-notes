import {t} from './i18n';
import type {MathColorTarget as ColorTarget} from './math-color';
import {palette} from './math-color-palette';

/** Selection formatting only. Formula state and MathJax remain the owner's job. */
export function createMathColorControl(options:{
  mount:HTMLElement;panel:HTMLElement;canApply(target:ColorTarget):boolean;canReset(target:ColorTarget):boolean;
  apply(color:string|null,target:ColorTarget):void;focus():void;
}) {
  const {mount,panel}=options,document=mount.ownerDocument,window=document.defaultView!;
  const events=new window.AbortController(),signal=events.signal;
  const button=document.createElement('button');
  button.type='button';button.className='math-color-button';button.title=t('Text color');
  button.setAttribute('aria-label',t('Text color'));button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
  const icon=document.createElement('span');icon.textContent='A';icon.setAttribute('aria-hidden','true');button.append(icon);mount.append(button);
  const popup=document.createElement('div');popup.className='math-color-popup';popup.hidden=true;
  popup.setAttribute('role','dialog');popup.setAttribute('aria-label',t('Text color'));panel.append(popup);
  const target:ColorTarget='text';
  let lastColor=palette.find(entry=>entry.name==='blue')!.color;
  const swatches=document.createElement('div');swatches.className='math-color-swatches';popup.append(swatches);
  const close=()=>{popup.hidden=true;button.setAttribute('aria-expanded','false');};
  const apply=(color:string|null)=>{if(options.canApply(target)){if(color)lastColor=color;options.apply(color,target);}close();options.focus();};
  swatches.replaceChildren(...palette.map(({name,color})=>{
    const swatch=document.createElement('button');swatch.type='button';swatch.style.backgroundColor=color;
    swatch.dataset.mathColor=color;swatch.dataset.colorName=name;
    swatch.title=name+' · '+color;
    swatch.setAttribute('aria-label',swatch.title);return swatch;
  }));
  swatches.addEventListener('click',event=>{
    const swatch=(event.target as Element).closest<HTMLButtonElement>('button[data-math-color]');
    if(swatch&&!swatch.disabled)apply(swatch.dataset.mathColor!);
  },{signal});
  const customLabel=document.createElement('label');customLabel.className='math-color-custom';customLabel.append(t('Custom color'));
  const custom=document.createElement('input');custom.type='color';custom.value=lastColor;custom.setAttribute('aria-label',t('Custom color'));
  custom.addEventListener('change',()=>apply(custom.value),{signal});customLabel.append(custom);popup.append(customLabel);
  const reset=document.createElement('button');reset.type='button';reset.className='math-color-reset';reset.textContent=t('Default color');
  reset.addEventListener('click',()=>apply(null),{signal});popup.append(reset);
  function syncAvailability(){
    reset.disabled=!options.canApply(target)||!options.canReset(target);
    for(const swatch of swatches.querySelectorAll<HTMLButtonElement>('button'))swatch.disabled=!options.canApply(target);
    custom.disabled=!options.canApply(target);
  }
  syncAvailability();
  button.addEventListener('pointerdown',event=>event.preventDefault(),{signal});
  button.addEventListener('click',event=>{
    if(!popup.hidden){close();return;}
    if(!options.canApply(target))return;
    custom.value=lastColor;syncAvailability();
    popup.hidden=false;button.setAttribute('aria-expanded','true');
    const rect=button.getBoundingClientRect();
    popup.style.left=Math.max(8,Math.min(rect.right-popup.offsetWidth,window.innerWidth-popup.offsetWidth-8))+'px';
    popup.style.top=Math.max(8,rect.bottom+6+popup.offsetHeight>window.innerHeight?rect.top-popup.offsetHeight-6:rect.bottom+6)+'px';
    if(event.detail===0)swatches.querySelector('button')?.focus({preventScroll:true});
  },{signal});
  popup.addEventListener('pointerdown',event=>{if((event.target as Element).closest('button'))event.preventDefault();},{signal});
  document.addEventListener('pointerdown',event=>{const target=event.target as Node;if(!popup.contains(target)&&!button.contains(target))close();},{signal,capture:true});
  document.addEventListener('keydown',event=>{
    if(!popup.hidden&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();options.focus();}
  },{signal,capture:true});
  window.addEventListener('resize',close,{signal});
  document.addEventListener('scroll',event=>{if(!popup.contains(event.target as Node))close();},{signal,capture:true});
  return {
    update(){button.disabled=!options.canApply(target);if(!popup.hidden)syncAvailability();if(button.disabled)close();},
    close,
    dispose(){events.abort();button.remove();popup.remove();}
  };
}
