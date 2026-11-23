// SPDX-License-Identifier: GPL-3.0-or-later
import {cloneExportContent,embeddedStyles,escapeHtml,exportAssets,type HtmlExportOptions} from './html-export';
import printContentCss from '../dist/print-content.css' with {type:'text'};
import {t} from './i18n';
import {mathFontBase} from './document-typography';
import documentPrintCss from './document-print.css' with {type:'text'};
import {installUnicodeFonts} from './mathjax-unicode-fonts';
import {installMathDelimiters} from './install-math-delimiters';
import {mathJaxExtensionLoads,mathJaxTexPackages,mathJaxDisabledTexPackages,mathJaxRequireOptions} from './mathjax-extension-policy';

export interface PrintOptions {paper:'a4'|'letter';landscape:boolean;marginMm:number;pageNumbers:boolean}
export const defaultPrintOptions:PrintOptions={paper:'a4',landscape:false,marginMm:20,pageNumbers:true};
export function printGeometry(options:PrintOptions){
  if(!options||!['a4','letter'].includes(options.paper)||typeof options.landscape!=='boolean'||typeof options.pageNumbers!=='boolean'||
    !Number.isFinite(options.marginMm)||options.marginMm<5||options.marginMm>40)throw Error('Invalid PDF page settings.');
  const [short,long]=options.paper==='a4'?[210,297]:[215.9,279.4];
  const widthMm=options.landscape?long:short,heightMm=options.landscape?short:long;
  return {widthMm,heightMm,contentWidth:(widthMm-2*options.marginMm)*96/25.4,contentHeight:(heightMm-2*options.marginMm)*96/25.4};
}

/** These rules also apply on screen in the preparation frame: MathJax must see
 * the final text measure before it calculates line breaks and tag positions. */
export function printStyles(options:PrintOptions):string {
  const {widthMm,heightMm,contentWidth}=printGeometry(options);
  return `
@page{size:${widthMm}mm ${heightMm}mm;margin:${options.marginMm}mm;${options.pageNumbers?'@bottom-center{content:counter(page);font:9pt serif;color:#444}':''}}
html{--vn-print-width:${contentWidth}px}
${printContentCss}
${documentPrintCss}
`;
}

/** Promote only real header cells. A data row must never become a fake header. */
export function preparePrintTables(root:HTMLElement,contentWidth:number):void {
  for(const table of root.querySelectorAll<HTMLTableElement>('table')){
    for(let wrapper=table.parentElement;wrapper&&wrapper!==root&&!wrapper.matches('.document-float');wrapper=wrapper.parentElement)
      wrapper.classList.add('print-table-wrapper');
    const columns=[...table.querySelectorAll<HTMLTableColElement>(':scope>colgroup>col')];
    const widths=columns.map(col=>parseFloat(col.style.width)||0),total=widths.reduce((sum,n)=>sum+n,0);
    const original=parseFloat(table.style.width)||total;
    table.style.width=Math.min(original||contentWidth,contentWidth)+'px';
    if(total&&widths.every(n=>n>0))columns.forEach((col,i)=>col.style.width=(100*widths[i]/total)+'%');
    for(const cell of table.querySelectorAll<HTMLElement>('td,th')){
      cell.style.removeProperty('width');cell.style.removeProperty('min-width');cell.style.removeProperty('max-width');
    }
    if(!table.tHead){
      const headers:HTMLTableRowElement[]=[];
      for(const row of [...table.rows]){
        if(row.closest('table')!==table||!row.cells.length||![...row.cells].every(cell=>cell.tagName==='TH'))break;
        headers.push(row);
      }
      if(headers.length){const head=table.createTHead();headers.forEach(row=>head.append(row));}
    }
  }
}

function nextLayout(view:Window):Promise<void>{return new Promise(resolve=>view.setTimeout(resolve,30));}
async function resourcesReady(document:Document):Promise<void>{
  for(const image of document.images)image.loading='eager';
  void document.documentElement.offsetHeight;
  await document.fonts.ready;
  const failedFont=[...document.fonts].find(font=>font.status==='error');
  if(failedFont)throw Error(t('Cannot load PDF font {name}',{name:failedFont.family}));
  await Promise.all([...document.images].map(async (image,index)=>{
    const failure=()=>Error(t('Cannot load PDF image {number}',{number:index+1})+(image.alt?' ('+image.alt+')':''));
    if(!image.complete)await new Promise<void>((resolve,reject)=>{
      image.addEventListener('load',()=>resolve(),{once:true});
      image.addEventListener('error',()=>reject(failure()),{once:true});
    });
    if(image.hasAttribute('src')&&!image.naturalWidth)throw failure();
    // Printing can paint a loaded image directly, including SVG. A separate
    // bitmap decode can reject even when the rendering engine can display it.
  }));
}

function mathAssets(document:Document){
  const entry=[...document.scripts].find(script=>/\/tex-chtml\.js(?:[?#]|$)/.test(script.src))?.src;
  if(!entry)throw Error('The MathJax runtime is unavailable for PDF export.');
  const local=/\/vendor\/mathjax\/tex-chtml\.js(?:[?#]|$)/.test(entry);
  const base=local?new URL('../',entry).href:'https://cdn.jsdelivr.net/npm/';
  return {entry,bboldx:base+(local?'mathjax-bboldx':'@mathjax/mathjax-bboldx-font-extension@4.1.3'),
    mhchem:base+(local?'mathjax-mhchem':'@mathjax/mathjax-mhchem-font-extension@4.1.3')};
}

async function typesetPrintMath(frame:HTMLIFrameElement,owner:Document,signal:AbortSignal):Promise<void>{
  const doc=frame.contentDocument!,view=frame.contentWindow! as Window&typeof globalThis;
  const formulas=[...doc.querySelectorAll<HTMLElement>('[data-export-math-source]')];
  if(!formulas.length)return;
  const assets=mathAssets(owner);
  const font=doc.querySelector('[data-math-font="mathjax-stix2"]')?'mathjax-stix2':'mathjax-newcm';
  const fontBase=mathFontBase(font,owner);
  const runtime=()=>view.MathJax as unknown as MathJaxRuntime;
  await new Promise<void>((resolve,reject)=>{
    const configuration={
      output:{font:fontBase,fontExtensions:[assets.bboldx],displayOverflow:'linebreak',linebreaks:{inline:true,width:'100%'}},
      loader:{paths:{[font]:fontBase,'mathjax-bboldx-extension':assets.bboldx,'mathjax-mhchem-extension':assets.mhchem},load:mathJaxExtensionLoads,failed:()=>reject(Error('MathJax could not be loaded for PDF export.'))},
      chtml:{font:'['+font+']',fontURL:fontBase+'/chtml/woff2',dynamicPrefix:'['+font+']/chtml/dynamic'},
      options:{enableMenu:false,enableSpeech:false,enableBraille:false,enableExplorer:false,enableExplorerHelp:false,renderActions:{explorable:[],attachSpeech:[]}},
      tex:{packages:{'[+]':mathJaxTexPackages,'[-]':mathJaxDisabledTexPackages},require:mathJaxRequireOptions,textmacros:{packages:{'[+]':['textcomp']}},tags:'cases' as const,mathStyle:'TeX',mathStyleGreekLC:true,mathStyleMathAlphabets:true},
      startup:{typeset:false,ready:()=>{try{installUnicodeFonts(runtime()._);installMathDelimiters(runtime()._);runtime().startup.defaultReady();}catch(error){reject(error);}},
        pageReady:async()=>{await runtime().startup.defaultPageReady();resolve();}},
    };
    // MathJax tests Object constructors while merging configuration. Objects
    // created in the editor's realm would fail that check in this iframe and
    // silently discard the local fonts, numbering and startup callbacks.
    const local=view.JSON.parse(JSON.stringify(configuration)) as typeof configuration;
    local.startup.ready=configuration.startup.ready;local.startup.pageReady=configuration.startup.pageReady;
    local.loader.failed=configuration.loader.failed;
    view.MathJax=local;
    const script=doc.createElement('script');script.src=assets.entry;
    script.addEventListener('error',()=>reject(Error('MathJax could not be loaded for PDF export.')),{once:true});
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});doc.head.append(script);
  });
  for(const formula of formulas){
    signal.throwIfAborted();
    formula.textContent=formula.dataset.exportMathSource??'';
    const seed=Number(formula.dataset.printFirstNumber??0);
    runtime().texReset(Number.isSafeInteger(seed)&&seed>=0?seed:0);
    await runtime().typesetPromise([formula]);
    if(formula.querySelector('mjx-merror'))throw Error('A formula could not be typeset for PDF export.');
  }
}

function fitPrintBlocks(root:HTMLElement,contentHeight:number):void {
  for(const figure of root.querySelectorAll<HTMLElement>('.document-float[data-float-kind="figure"]')){
    const caption=figure.querySelector<HTMLElement>('.document-float-caption');
    const available=Math.max(48,contentHeight-(caption?.getBoundingClientRect().height??0)-48);
    for(const image of figure.querySelectorAll<HTMLImageElement>('img')){
      image.style.setProperty('height','auto','important');image.style.setProperty('max-height',available+'px','important');
      image.style.setProperty('max-width','100%','important');image.style.setProperty('width','auto','important');
    }
  }
  // A keep-together box larger than a sheet otherwise produces a blank page,
  // an overflow, or browser-dependent clipping. Permit normal fragmentation.
  for(const block of root.querySelectorAll<HTMLElement>('.document-float,.document-metadata,.document-metadata-entry,tr,[data-bibliography-key]')){
    if(block.getBoundingClientRect().height>contentHeight-2)block.classList.add('print-oversize');
  }
  for(const formula of root.querySelectorAll<HTMLElement>('.math-block-node,.display-mount-wrapper')){
    if(formula.getBoundingClientRect().height>contentHeight-2)
      throw Error('A formula is taller than the printable page. Use a larger paper size or split the formula.');
  }
  const page=root.getBoundingClientRect();
  for(const part of root.querySelectorAll<HTMLElement>('.inline-formula mjx-math,.inline-formula mjx-labels')){
    const box=part.getBoundingClientRect();
    if(box.width>0&&(box.right>page.right+2||box.left<page.left-2))
      throw Error('A formula is wider than the printable page. Use landscape or a larger paper size.');
  }
}

/** Finalize the fresh renderer's formula subtrees. The surrounding document
 * was sanitized before mounting and stays in place until serialization. */
export async function collectPrintMath(doc:Document,root:HTMLElement,assets:ReturnType<typeof exportAssets>):Promise<string>{
  const formulas=Array.from(root.querySelectorAll<HTMLElement>('[data-export-math-source]'));
  if(!formulas.length)return '';
  const style=doc.querySelector<HTMLStyleElement>('style#MJX-CHTML-styles');
  if(!style?.sheet)throw Error('MathJax did not produce a print stylesheet.');
  const elements=formulas.flatMap(formula=>Array.from(formula.querySelectorAll('mjx-container,mjx-container *')));
  const usesSelector=(selector:string)=>{
    const origin=selector.replace(/::?(?:before|after)\b/g,':where(*)');
    return formulas.some(formula=>formula.querySelector(origin)!==null);
  };
  const css=await embeddedStyles(doc,[style.sheet],elements,assets,usesSelector);
  for(const formula of formulas){
    const {clone}=await cloneExportContent(formula,{mathRuntime:'none'},assets);
    formula.replaceWith(clone);
  }
  return css;
}

/** An isolated MathJax instance keeps print numbering, line breaks and loader
 * state independent of live typing. Only this export snapshot is re-typeset. */
export async function preparePrintHtml(source:HTMLElement,content:HtmlExportOptions,options:PrintOptions):Promise<string>{
  const document=source.ownerDocument;
  const geometry=printGeometry(options),owner=document.defaultView!;
  const frame=document.createElement('iframe');frame.title='PDF preparation';frame.setAttribute('aria-hidden','true');
  frame.style.cssText=`position:fixed;left:-20000px;top:0;width:${geometry.contentWidth}px;height:${geometry.contentHeight}px;border:0;opacity:0;pointer-events:none`;
  document.body.append(frame);
  const abort=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{const error=Error('PDF preparation timed out.');abort.abort(error);reject(error);},120000);});
  const prepare=async()=>{
    const settings:HtmlExportOptions={...content,mathRuntime:'none'};
    const assets=exportAssets(document.baseURI,settings);
    const {clone:root}=await cloneExportContent(source,settings,assets);
    abort.signal.throwIfAborted();
    const doc=frame.contentDocument!;
    doc.open();doc.write('<!doctype html><html><head></head><body></body></html>');doc.close();
    doc.documentElement.lang=content.lang||document.documentElement.lang||'en';
    const sheet=doc.createElement('style');
    sheet.textContent=printStyles(options);
    doc.head.append(sheet);
    const main=doc.createElement('main');main.id='plateMount';
    doc.body.append(main);main.append(root);
    preparePrintTables(root,geometry.contentWidth);
    await resourcesReady(doc);abort.signal.throwIfAborted();
    await typesetPrintMath(frame,document,abort.signal);
    await resourcesReady(doc);await nextLayout(owner);abort.signal.throwIfAborted();
    fitPrintBlocks(root,geometry.contentHeight);
    await nextLayout(owner);abort.signal.throwIfAborted();
    const mathCss=await collectPrintMath(doc,root,assets);
    const css=(sheet.textContent+'\n'+mathCss).replace(/<\/style/gi,'<\\/style');
    const title=content.title??document.title.replace(/^\* /,'');
    return '<!doctype html><html lang="'+escapeHtml(doc.documentElement.lang)+'"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; media-src data:; base-uri \'none\'; form-action \'none\'">'+
      '<title>'+escapeHtml(title)+'</title><style>'+css+'</style></head><body>'+main.outerHTML+'</body></html>';
  };
  try{return await Promise.race([prepare(),timeout]);}
  finally{if(timer!==undefined)clearTimeout(timer);abort.abort();frame.remove();}
}
