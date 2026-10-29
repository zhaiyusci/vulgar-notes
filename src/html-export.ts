// SPDX-License-Identifier: GPL-3.0-or-later

export interface HtmlExportTarget {element:Element;id:string}
export interface HtmlExportLink {element:Element;href:string}
export interface HtmlExportOptions {
  title?:string;
  lang?:string;
  targets?:readonly HtmlExportTarget[];
  links?:readonly HtmlExportLink[];
  formulas?:readonly {element:Element;source:string;typesetSource?:string}[];
  /** Injectable for tests; production reads the same assets used by the view. */
  fetchResource?:(url:string)=>Promise<Blob>;
}

const editOnly=[
  'script','iframe','object','embed','link','style','base','meta','foreignObject',
  '.document-metadata-marker','.metadata-entry-controls','.metadata-entry-group-label',
  '.tex-label-marker','.slate-gutterLeft','.slate-blockToolbarWrapper','.slate-dropLine',
  '.slate-selection-area','[data-slot="block-selection"]','[role="toolbar"]',
  '[data-slate-spacer]','[data-slate-placeholder]','[data-empty-text="true"]',
  '[data-resizing]','[class~="group/resize"]',
  '.math-caret','.document-zoom-controls','.document-zoom-dock',
].join(',');
const transientClasses=new Set(['math-active-region','math-selected','flow-selected','font-warning','math-region','math-item','opacity-50','first-block-drop-target']);
const transientAttribute=/^(?:on|data-(?:reference-selected|formula-selected|endnote-selected|nav-|metadata-dragging|table-selecting|table-resizing)|aria-(?:selected|expanded|haspopup|invalid)|contenteditable$|draggable$|spellcheck$|tabindex$|autofocus$)/i;
const escapeHtml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const dataUrl=/^data:/i;
const fontFamilies=(source:string):string[]=>Array.from(source.matchAll(/(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,])+/g),match=>match[0].trim().replace(/^(['"])(.*)\1$/,'$2').replace(/\\(['"\\])/g,'$1').toLowerCase()).filter(Boolean);

function staticLink(value:string,base:string):string|null {
  if(!value.trim())return null;
  if(value.startsWith('#'))return value;
  try{const url=new URL(value,base);return /^(?:https?:|mailto:|tel:)$/.test(url.protocol)?url.href:null;}catch{return null;}
}

function resourceUrl(value:string,base:string):string {
  const url=new URL(value,base);
  if(!/^(?:https?:|tauri:|asset:|blob:|data:)$/.test(url.protocol))throw Error('HTML export cannot embed this resource: '+url.protocol);
  return url.href;
}

async function blobDataUrl(blob:Blob):Promise<string> {
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
  for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));
  const type=/^[\w.+-]+\/[\w.+-]+$/.test(blob.type)?blob.type:'application/octet-stream';
  return 'data:'+type+';base64,'+btoa(binary);
}

function replaceTag(element:Element,tag:string):HTMLElement {
  const replacement=element.ownerDocument.createElement(tag);
  for(const attribute of Array.from(element.attributes))replacement.setAttribute(attribute.name,attribute.value);
  replacement.append(...Array.from(element.childNodes));element.replaceWith(replacement);return replacement;
}

/** Clone a rendered view; no live selection, editor node or MathJax tree is changed. */
export async function exportRenderedHtml(root:HTMLElement,options:HtmlExportOptions={}):Promise<string> {
  const document=root.ownerDocument,view=document.defaultView;
  if(!view)throw Error('The document view is unavailable for HTML export.');
  const base=document.baseURI,clone=root.cloneNode(true) as HTMLElement;
  const copies=new Map<Element,Element>();
  const originals=[root,...Array.from(root.querySelectorAll('*'))],clones=[clone,...Array.from(clone.querySelectorAll('*'))];
  originals.forEach((element,index)=>copies.set(element,clones[index]));
  const fetchResource=options.fetchResource??(async(url:string)=>{
    const response=await fetch(url,{credentials:'same-origin'});
    if(!response.ok)throw Error('HTTP '+response.status);
    return response.blob();
  });
  const resources=new Map<string,Promise<string>>();
  const embed=(value:string,relativeTo=base):Promise<string>=>{
    if(value.startsWith('#')||dataUrl.test(value))return Promise.resolve(value);
    const url=resourceUrl(value,relativeTo);
    let pending=resources.get(url);
    if(!pending){
      pending=fetchResource(url).then(blobDataUrl).catch(error=>{throw Error('Unable to embed an HTML export resource: '+url+' ('+String(error)+')');});
      resources.set(url,pending);
    }
    return pending;
  };
  const embedCss=async(css:string,relativeTo=base):Promise<string>=>{
    const pattern=/url\(\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^)]*))\s*\)/gi;
    const matches=Array.from(css.matchAll(pattern));let result='',offset=0;
    for(const match of matches){
      const raw=(match[1]??match[2]??match[3]??'').trim().replace(/\\([()'"\\ ])/g,'$1');
      if(!raw)continue;
      const encoded=await embed(raw,relativeTo);
      result+=css.slice(offset,match.index)+'url("'+encoded.replace(/"/g,'%22')+'")';offset=match.index!+match[0].length;
    }
    return result+css.slice(offset);
  };

  // These are exact live-to-copy mappings, so duplicate headings and reference
  // text never make an exported link point to an unrelated section.
  for(const target of options.targets??[])copies.get(target.element)?.setAttribute('id',target.id);
  for(const link of options.links??[]){
    const element=copies.get(link.element);if(!element)continue;
    const href=staticLink(link.href,base);if(!href)continue;
    const anchor=element.tagName.toLowerCase()==='a'?element:replaceTag(element,'a');
    anchor.setAttribute('href',href);copies.set(link.element,anchor);
  }
  for(const button of Array.from(clone.querySelectorAll('button.document-toc-link'))){
    const path=button.getAttribute('data-heading-path');
    const anchor=replaceTag(button,'a');
    if(path&&/^\d+(?:\.\d+)*$/.test(path))anchor.setAttribute('href','#vn-heading-'+path.replace(/\./g,'-'));
  }

  // Table editing adds a separate control column, not a document data column.
  for(const table of Array.from(clone.querySelectorAll('table'))){
    const rows=Array.from(table.querySelectorAll('tr')).filter(row=>row.closest('table')===table);
    if(rows.length&&rows.every(row=>row.firstElementChild?.matches('td[contenteditable="false"]:not([data-slate-node])'))){
      const controlColumn=table.querySelector('colgroup')?.firstElementChild as HTMLElement|null;
      const controlWidth=controlColumn?.style.width;
      if(controlWidth&&/^\d+(?:\.\d+)?px$/.test(controlWidth)&&/^\d+(?:\.\d+)?px$/.test(table.style.width))
        table.style.width=Math.max(0,parseFloat(table.style.width)-parseFloat(controlWidth))+'px';
      for(const row of rows)row.firstElementChild?.remove();
      controlColumn?.remove();table.closest('[data-slate-node="element"]')?.classList.remove('-ml-2');
    }
  }
  // A placeholder contributes MathJax geometry but no document glyph. Preserve
  // only its measured empty space, never a square, an editing class or a label.
  for(const original of originals.filter(element=>element.classList.contains('math-placeholder'))){
    const placeholder=copies.get(original);if(!placeholder||!clone.contains(placeholder))continue;
    const rect=original.getBoundingClientRect();let zoom=1;
    for(let current:Element|null=original;current;current=current.parentElement){
      const value=view.getComputedStyle(current).zoom;
      const factor=value?.endsWith('%')?parseFloat(value)/100:parseFloat(value);
      if(Number.isFinite(factor)&&factor>0)zoom*=factor;
    }
    const phantom=document.createElement('span'),style=view.getComputedStyle(original);
    phantom.setAttribute('aria-hidden','true');
    phantom.style.cssText='display:inline-block;pointer-events:none;width:'+(rect.width>0?rect.width/zoom+'px':'.4em')+';height:'+(rect.height>0?rect.height/zoom+'px':'.7em')+';vertical-align:'+(style.verticalAlign||'baseline');
    placeholder.replaceWith(phantom);
  }
  clone.querySelectorAll('.math-boundary').forEach(element=>{
    element.classList.remove('math-boundary','boundary-start','boundary-end');
    element.removeAttribute('title');element.setAttribute('aria-hidden','true');
  });
  clone.querySelectorAll(editOnly).forEach(element=>element.remove());
  clone.querySelectorAll('[data-slate-zero-width]').forEach(element=>{
    const lineBreak=element.querySelector('br');if(lineBreak)element.replaceWith(lineBreak);else element.remove();
  });
  for(const original of originals){
    const element=copies.get(original);if(!element||!clone.contains(element))continue;
    if(original.tagName.toLowerCase()==='img'){
      const selected=(original as HTMLImageElement).currentSrc;if(selected)element.setAttribute('src',selected);
    }else if(original.tagName.toLowerCase()==='canvas'){
      const image=document.createElement('img');
      for(const attribute of Array.from(element.attributes))image.setAttribute(attribute.name,attribute.value);
      try{image.src=(original as HTMLCanvasElement).toDataURL('image/png');}catch{throw Error('A canvas image could not be embedded in the HTML export.');}
      element.replaceWith(image);copies.set(original,image);
    }else if(original.tagName.toLowerCase()==='textarea'){
      const text=replaceTag(element,'div');text.textContent=(original as HTMLTextAreaElement).value;
    }else if(original.tagName.toLowerCase()==='input'){
      const input=original as HTMLInputElement;
      const text=replaceTag(element,'span');text.textContent=input.type==='checkbox'?(input.checked?'☑':'☐'):input.value;
    }
  }
  clone.querySelectorAll('button').forEach(element=>replaceTag(element,'span'));
  clone.querySelectorAll('picture > source').forEach(element=>element.remove());
  const elements=[clone,...Array.from(clone.querySelectorAll('*'))];
  for(const element of elements){
    if(element.getAttribute('role')==='textbox'){
      element.removeAttribute('role');element.removeAttribute('aria-multiline');
      element.removeAttribute('aria-readonly');element.removeAttribute('aria-autocomplete');element.removeAttribute('aria-activedescendant');
    }
    // This outer wrapper's label describes the editing action. MathJax's own
    // inner role/labels describe the expression and remain in the static file.
    if(element.matches('.inline-formula'))element.removeAttribute('aria-label');
    if(element.matches('.inline-formula,.tex-reference-content,.math-source-region,.font-warning')){
      element.removeAttribute('title');element.removeAttribute('aria-description');
    }
    for(const attribute of Array.from(element.attributes)){
      if(transientAttribute.test(attribute.name)||attribute.name==='srcdoc'||attribute.name==='srcset'||attribute.name==='formaction')element.removeAttribute(attribute.name);
    }
    for(const name of Array.from(element.classList))if(transientClasses.has(name)||element.closest('mjx-container')&&/^(?:region-|item-|structure-(?:node$|n\d))/.test(name))element.classList.remove(name);
    element.removeAttribute('data-heading-path');element.removeAttribute('data-editor-zoom');
    element.removeAttribute('data-metadata-placeholder');element.removeAttribute('data-caption-placeholder');
    element.removeAttribute('data-formula-source');element.removeAttribute('data-formula-reader-active');
    if(element instanceof view.HTMLElement)element.style.removeProperty('zoom');
    if(element.tagName.toLowerCase()==='a'){
      const href=staticLink(element.getAttribute('href')??'',base);
      if(href)element.setAttribute('href',href);else element.removeAttribute('href');
      element.removeAttribute('ping');element.removeAttribute('download');
      if(element.getAttribute('target')==='_blank')element.setAttribute('rel','noopener noreferrer');
    }
    for(const name of ['href','xlink:href']){
      if(element.tagName.toLowerCase()==='a'||!element.hasAttribute(name))continue;
      const value=element.getAttribute(name)!;
      if(element.tagName.toLowerCase()==='image')element.setAttribute(name,await embed(value));
      else if(!value.startsWith('#'))element.removeAttribute(name);
    }
    if(element.hasAttribute('src')){
      if(!/^(?:img|audio|video|source)$/i.test(element.tagName))element.removeAttribute('src');
      else{
        const original=originals[clones.indexOf(element)];
        const selected=element.tagName.toLowerCase()==='img'?(original as HTMLImageElement|undefined)?.currentSrc:undefined;
        element.setAttribute('src',await embed(selected||element.getAttribute('src')!));
      }
    }
    if(element.hasAttribute('poster'))element.setAttribute('poster',await embed(element.getAttribute('poster')!));
    if(element.hasAttribute('style'))element.setAttribute('style',await embedCss(element.getAttribute('style')!));
  }

  // MathJax's sidebar shares this page and creates font faces of its own. Embed
  // only families used by retained document nodes, including CHTML glyphs whose
  // actual characters live in ::before/::after rather than text nodes.
  const usedFonts=new Set<string>();
  for(const original of originals){
    const copy=copies.get(original);if(!copy||!clone.contains(copy))continue;
    for(const pseudo of [null,'::before','::after']){
      const style=view.getComputedStyle(original,pseudo);
      for(const family of fontFamilies(style.fontFamily))usedFonts.add(family);
    }
  }
  const readRules=async(rules:CSSRuleList,relativeTo:string,ancestors:Set<CSSStyleSheet>):Promise<string>=>{
    const parts:string[]=[];
    for(const rule of Array.from(rules)){
      if(rule.type===3){
        const imported=rule as CSSImportRule;
        if(!imported.styleSheet)throw Error('An imported stylesheet is not ready for HTML export.');
        const content=await readSheet(imported.styleSheet,ancestors),media=imported.media.mediaText;
        if(content)parts.push(media&&media!=='all'?'@media '+media+'{'+content+'}':content);
      }else if(rule.type===5){
        const face=rule as CSSFontFaceRule;
        const family=face.style?.fontFamily??/font-family\s*:\s*([^;}]+)/i.exec(rule.cssText)?.[1]??'';
        if(fontFamilies(family).some(name=>usedFonts.has(name)))parts.push(await embedCss(rule.cssText,relativeTo));
      }else if(rule.type!==1&&'cssRules' in rule){
        const content=await readRules((rule as CSSGroupingRule).cssRules,relativeTo,ancestors);
        if(content)parts.push(rule.cssText.slice(0,rule.cssText.indexOf('{')+1)+content+'}');
      }else parts.push(await embedCss(rule.cssText,relativeTo));
    }
    return parts.join('\n');
  };
  const readSheet=async(sheet:CSSStyleSheet,ancestors=new Set<CSSStyleSheet>()):Promise<string>=>{
    if(ancestors.has(sheet))return '';
    const parents=new Set(ancestors);parents.add(sheet);
    let rules:CSSRuleList;
    try{rules=sheet.cssRules;}catch{throw Error('Unable to read a stylesheet for HTML export: '+(sheet.href??'inline stylesheet'));}
    return readRules(rules,sheet.href??base,parents);
  };
  const sheets=[...Array.from(document.styleSheets),...Array.from(document.adoptedStyleSheets??[])];
  const css=(await Promise.all([...new Set(sheets)].filter(sheet=>!sheet.disabled).map(sheet=>readSheet(sheet)))).join('\n');
  const exportCss=`
html,body{width:auto!important;height:auto!important;max-width:none!important;margin:0!important;padding:0!important;overflow:visible!important}
#plateMount{min-height:0!important}
#plateMount [data-slate-editor]{height:auto!important;min-height:0!important;overflow:visible!important;cursor:auto!important;caret-color:transparent}
.document-zoom-surface{zoom:1!important}
.document-metadata{border:0;padding:0}
.metadata-entry-grouped{display:block!important}
.metadata-entry-body::before,.document-float-caption::after{display:none!important}
.document-toc-link{text-decoration:none;color:inherit}
.math-region,.math-item,.inline-formula,.tex-reference-content{cursor:inherit!important}
.math-mount-wrapper,.inline-formula{user-select:text!important}
.font-warning::after{display:none!important}
@media print{html,body{overflow:visible!important}.document-zoom-surface{max-inline-size:none}}
`;
  const htmlRoot=document.documentElement;
  const lang=options.lang||htmlRoot.lang||'en';
  let hasMath=false;
  for(const formula of options.formulas??[]){
    const element=copies.get(formula.element);if(!element||!clone.contains(element))continue;
    hasMath=true;
    element.setAttribute('data-slate-tex-expression',formula.source);
    element.setAttribute('data-export-math-source',formula.typesetSource??'\\('+formula.source+'\\)');
  }
  // The standard MathJax component supplies its own source/copy menu. Keep the
  // already-rendered output as the initial view while the native runtime loads.
  const mathConfig=hasMath?await(await fetchResource(new URL('mathjax-export-config.js',base).href)).text():'';
  const random=new Uint8Array(16);if(hasMath)view.crypto.getRandomValues(random);
  const nonce=hasMath?Array.from(random,byte=>byte.toString(16).padStart(2,'0')).join(''):'';
  const attributes=' lang="'+escapeHtml(lang)+'"'+
    (htmlRoot.className?' class="'+escapeHtml(htmlRoot.className)+'"':'')+
    (htmlRoot.dataset.colorScheme?' data-color-scheme="'+escapeHtml(htmlRoot.dataset.colorScheme)+'"':'');
  return '<!doctype html>\n<html'+attributes+'><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '+(hasMath?'script-src \'nonce-'+nonce+'\' https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net; ':'')+'style-src \'unsafe-inline\'; img-src data:; font-src data:'+(hasMath?' https://cdn.jsdelivr.net':'')+'; media-src data:; base-uri \'none\'; form-action \'none\'">'+
    '<title>'+escapeHtml(options.title??document.title.replace(/^\* /,''))+'</title><style>'+((css+'\n'+exportCss).replace(/<\/style/gi,'<\\/style'))+'</style>'+
    (hasMath?'<script nonce="'+nonce+'">'+mathConfig.replace(/<\/script/gi,'<\\/script')+'</script><script defer src="https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-chtml.js"></script>':'')+'</head>'+
    '<body><main id="plateMount">'+clone.outerHTML+'</main></body></html>';
}
