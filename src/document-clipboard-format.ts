// SPDX-License-Identifier: GPL-3.0-or-later
import type {Value} from 'platejs';
import {isFormula,type FormulaNode} from './plate-document';
import {referenceTex,type ReferenceNode} from './references';

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const safeUrl=(value:unknown,image=false):string|undefined=>{
  if(typeof value!=='string')return;
  if(image&&/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(value))return value;
  if(value.startsWith('#')&&!image)return value;
  try {const url=new URL(value);if(['https:','http:',...(!image?['mailto:']:[])].includes(url.protocol))return value;}catch{}
};
const formulaText=(node:FormulaNode)=>node.type==='equation'||node.display?'\\['+node.texExpression+'\\]':'\\('+node.texExpression+'\\)';

/** Serialize the selected data, never the live MathJax/accessibility DOM. */
export function documentClipboardText(value:Value):string {
  const render=(node:any):string=>{
    if(typeof node.text==='string')return node.text;
    if(isFormula(node))return formulaText(node);
    if(node.type==='tex_reference')return referenceTex(node as ReferenceNode);
    if(node.type==='tex_label')return '\\label{'+node.texLabel+'}';
    if(node.type==='img')return String(node.alt??node.url??'');
    if(node.type==='footnoteReference')return '[^'+node.identifier+']';
    const content=(node.children??[]).map(render).join(node.type==='tr'?'\t':'');
    return content+(['p','h1','h2','h3','h4','h5','h6','blockquote','tr','float_caption','metadata_entry','footnoteDefinition'].includes(node.type)?'\n':'');
  };
  return value.map(render).join('').replace(/\n$/,'');
}

export function documentClipboardHtml(value:Value):string {
  const render=(node:any):string=>{
    if(typeof node.text==='string'){
      let text=escapeHtml(node.text).replace(/\n/g,'<br>');
      for(const [mark,tag] of [['bold','strong'],['italic','em'],['underline','u'],['strikethrough','s'],['code','code'],['superscript','sup'],['subscript','sub']])if(node[mark])text='<'+tag+'>'+text+'</'+tag+'>';
      return text;
    }
    if(isFormula(node))return '<span data-vulgar-tex="'+escapeHtml(node.texExpression)+'" data-vulgar-display="'+String(node.type==='equation'||node.display===true)+'">'+escapeHtml(formulaText(node))+'</span>';
    if(node.type==='tex_reference')return escapeHtml(referenceTex(node as ReferenceNode));
    if(node.type==='tex_label')return escapeHtml('\\label{'+node.texLabel+'}');
    if(node.type==='img'){const url=safeUrl(node.url,true);return url?'<img src="'+escapeHtml(url)+'" alt="'+escapeHtml(String(node.alt??''))+'">':escapeHtml(String(node.alt??''));}
    if(node.type==='footnoteReference')return '<sup>'+escapeHtml('[^'+node.identifier+']')+'</sup>';
    const content=(node.children??[]).map(render).join('');
    if(node.type==='a'){const url=safeUrl(node.url);return url?'<a href="'+escapeHtml(url)+'">'+content+'</a>':content;}
    const tag=({p:'p',h1:'h1',h2:'h2',h3:'h3',h4:'h4',h5:'h5',h6:'h6',blockquote:'blockquote',table:'table',tr:'tr',td:'td',th:'th',float:'figure',float_caption:'figcaption',code_block:'pre',code_line:'div',document_metadata:'div',metadata_entry:'div',footnoteDefinition:'p',bibliography_entry:'p'} as Record<string,string>)[node.type];
    const align=['left','center','right','justify'].includes(node.align)?' style="text-align:'+node.align+'"':'';
    return tag?'<'+tag+align+'>'+content+'</'+tag+'>':content;
  };
  return value.map(render).join('');
}

export interface ClipboardMathAnnotation {source:string;display:boolean}
/** Retain rich HTML while replacing explicit TeX annotations before Plate reads it. */
export function prepareClipboardHtml(source:string):{html:string;math:Map<string,ClipboardMathAnnotation>} {
  const parsed=new DOMParser().parseFromString(source,'text/html'),math=new Map<string,ClipboardMathAnnotation>();
  parsed.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(element=>element.remove());
  const candidates=parsed.querySelectorAll('[data-vulgar-tex],math,.katex,mjx-container');
  for(const element of candidates){
    if(!parsed.body.contains(element))continue;
    const annotation=element.querySelector('annotation[encoding="application/x-tex"],annotation[encoding="application/x-latex"]');
    const tex=element.getAttribute('data-vulgar-tex')??annotation?.textContent;
    if(tex===undefined||tex===null)continue;
    const display=element.getAttribute('data-vulgar-display')==='true'||element.getAttribute('display')==='block'||element.getAttribute('display')==='true'||!!element.closest('.katex-display');
    const token='VNCLIPMATH'+crypto.randomUUID().replace(/-/g,'')+'END';
    math.set(token,{source:tex,display});
    element.replaceWith(parsed.createTextNode(token));
  }
  for(const element of parsed.body.querySelectorAll('*')){
    for(const attribute of [...element.attributes]){
      if(attribute.name.startsWith('on')||attribute.name==='data-slate-fragment'||attribute.name==='contenteditable')element.removeAttribute(attribute.name);
      if((attribute.name==='href'||attribute.name==='src')&&!safeUrl(attribute.value,attribute.name==='src'))element.removeAttribute(attribute.name);
    }
  }
  return {html:parsed.body.innerHTML,math};
}

/** A single annotated formula, with no surrounding prose, can enter math mode. */
export function extractClipboardMathHtml(source:string):ClipboardMathAnnotation|null {
  if(!source)return null;
  const prepared=prepareClipboardHtml(source);if(prepared.math.size!==1)return null;
  const [token,annotation]=prepared.math.entries().next().value!;
  const body=new DOMParser().parseFromString(prepared.html,'text/html').body;
  return body.textContent?.replace(token,'').trim()===''?annotation:null;
}

/** Markup cannot manufacture a formula; only a captured explicit TeX annotation can. */
export function restoreClipboardMath(value:Value,math:Map<string,ClipboardMathAnnotation>,create:(source:string,display:boolean)=>FormulaNode):Value {
  if(!math.size)return value;
  const pattern=new RegExp('('+[...math.keys()].join('|')+')','g');
  const visit=(nodes:any[]):any[]=>nodes.flatMap(node=>{
    if(typeof node.text==='string')return node.text===''?[node]:node.text.split(pattern).filter((text:string)=>text!=='').map((text:string)=>{
      const annotation=math.get(text);return annotation?create(annotation.source,annotation.display):{...node,text};
    });
    return {...node,children:visit(node.children??[])};
  });
  return visit(value) as Value;
}
