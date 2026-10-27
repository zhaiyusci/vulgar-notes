import {documentSessionId,draftStorage} from './platform';
import type {TElement, Value, Descendant} from 'platejs';
import {type JSONContent, migrateLegacy, documentLatex} from './document-format';
import {EditorModel} from './editor-model';
import {referenceTex,validReferenceKey,type ReferenceNode} from './references';
import {parseBibLibraries,validateBibLibraries,validCitationKey,type BibLibrary} from './bibtex';
import {isBibliographyStyle,type BibliographyStyle} from './bibliography-style';
import {t} from './i18n';

const sessionId=documentSessionId();
/** A newly opened document owns its draft, even when the browser copies opener storage. */
export const documentStorageKey='math-plate-document-v1'+(sessionId?':'+sessionId:'');
export function documentContentKey(source:string):string {
  return JSON.stringify(JSON.parse(source), (key,value)=>{
    if(key==='snapshot'&&typeof value==='string')return JSON.parse(value).root;
    return value;
  });
}
export interface DocumentEnvelope {version:1;value:Value;bibliographyLibraries:BibLibrary[];bibliographyStyle?:BibliographyStyle}
export class DocumentFormatError extends Error {
  readonly name='DocumentFormatError';
  constructor(readonly code:'invalid-json'|'invalid-document'){
    // JSON parser and library errors can contain parts of the selected file.
    // Keep those details out of the public error and application diagnostics.
    super(t('This file is not a valid Vulgar Notes document.'));
  }
}
export function isBlankDocument(value:Value,style:BibliographyStyle='simple'):boolean{
  const node=value[0],leaf=node?.children?.[0];
  return style==='simple'&&value.length===1&&node.type==='p'&&Object.keys(node).every(key=>['type','children','id'].includes(key))&&node.children.length===1&&leaf?.text===''&&Object.keys(leaf).every(key=>key==='text');
}
/** Validate both text and its attached source libraries before replacing a document. */
export function parseDocumentEnvelope(source:string):DocumentEnvelope {
  let saved:any;
  try{saved=JSON.parse(source);}catch{throw new DocumentFormatError('invalid-json');}
  try{
    if(saved?.version!==1||!Array.isArray(saved.value)||!saved.value.length)throw Error('Invalid document format');
    validate(saved.value);
    if(saved.value.some((node:any)=>typeof node.type!=='string'||!Array.isArray(node.children)))throw Error('Invalid document root');
    const bibliographyLibraries=validateBibLibraries(saved.bibliographyLibraries);
    if(saved.bibliographyStyle!==undefined&&!isBibliographyStyle(saved.bibliographyStyle))throw Error('Invalid bibliography style');
    // A paste can introduce a manual key already present in a source library.
    // Preserve both on reopen; reference resolution flags that ambiguity.
    return {version:1,value:saved.value,bibliographyLibraries,...(saved.bibliographyStyle?{bibliographyStyle:saved.bibliographyStyle}:{})};
  }catch{throw new DocumentFormatError('invalid-document');}
}
export function parseDocumentFile(source:string):Value {return parseDocumentEnvelope(source).value;}
/** Libraries share a citation namespace with existing hand-written bibliography entries. */
export function validateDocumentLibraries(value:Value,libraries:readonly BibLibrary[]):void {
  const keys=new Set<string>();
  const walk=(nodes:any[])=>{for(const node of nodes){if(node.type==='bibliography_entry')keys.add(node.citeKey);if(Array.isArray(node.children))walk(node.children);}};walk(value);
  for(const entry of parseBibLibraries(libraries))if(keys.has(entry.key))throw Error('Duplicate citation key: '+entry.key);
}
export const isFormula=(n:unknown):boolean=>!!n&&typeof n==='object'&&'type' in n&&(n.type==='equation'||n.type==='inline_equation');
export type FormulaNode=TElement & {id:string; snapshot?:string;texExpression:string;numbered:boolean;display?:boolean;texLabel?:string};
export const newId=()=>'math-'+crypto.randomUUID();
export function formulaNode(model:EditorModel,display=false):FormulaNode {
  return {type:'inline_equation',display,id:newId(),snapshot:model.snapshot(),texExpression:model.exportLatex(),numbered:true,children:[{text:''}]};
}
/** Markdown has block math only; adapt a copy, without splitting the editing tree. */
export function markdownDisplayBlocks(nodes:Descendant[]):Descendant[]{
  return nodes.flatMap(node=>{
    if(!Array.isArray(node.children)||isFormula(node))return [node];
    const children=node.children as Descendant[];
    if(/^h[1-3]$/.test(String(node.type))&&validReferenceKey(node.texLabel))
      return [{...node,children:[...markdownDisplayBlocks(children),{text:' {#'+node.texLabel+'}'}]}];
    if(!children.some(child=>isFormula(child)&&child.display===true))
      return [{...node,children:markdownDisplayBlocks(children)}];
    const result:Descendant[]=[];let run:Descendant[]=[];
    const flush=()=>{if(run.some(child=>!('text' in child)||child.text!==''))result.push({...node,children:run});run=[];};
    for(const child of children){
      if(isFormula(child)&&child.display===true){flush();result.push({...child,type:'equation'} as TElement);}
      else run.push(child);
    }
    flush();return result;
  });
}
/** One-way migration only. Earlier storage keys are never modified. */
export function fromTiptap(doc:JSONContent):Value {
  function read(node:JSONContent,indent=0,listStyleType?:string):any[] {
    const a=node.attrs||{}, children=()=>node.content?.flatMap(n=>read(n,indent))||[{text:''}];
    switch(node.type){
      case 'doc':return node.content?.flatMap(n=>read(n))||[];
      case 'text':return [{text:node.text||'',...Object.fromEntries((node.marks||[]).filter(m=>m.type!=='link').map(m=>[m.type==='strike'?'strikethrough':m.type,true]))}].map(text=>{
        const link=node.marks?.find(m=>m.type==='link');return link?{type:'a',url:link.attrs?.href,children:[text]}:text;
      });
      case 'hardBreak':return [{text:'\n'}];
      case 'inlineMath':case 'displayMath':{
        const m=new EditorModel();m.restore(a.snapshot);
        return [{...formulaNode(m,node.type==='displayMath'),type:node.type==='displayMath'?'equation':'inline_equation',id:a.id||newId(),numbered:a.numbered!==false}];
      }
      case 'bulletList':case 'orderedList':return node.content?.flatMap(n=>read(n,indent+1,node.type==='orderedList'?'decimal':'disc'))||[];
      case 'listItem':return (node.content||[]).flatMap(n=>n.type==='paragraph'?[{type:'p',indent,listStyleType,children:childrenOf(n)}]:read(n,indent));
      case 'heading':return [{type:'h'+a.level,children:children()}];
      case 'horizontalRule':return [{type:'hr',children:[{text:''}]}];
      case 'codeBlock':return [{type:'code_block',lang:a.language,children:[{type:'code_line',children:children()}]}];
      case 'blockquote':return [{type:'blockquote',children:(node.content||[]).flatMap(n=>childrenOf(n))}];
      default:return [{type:'p',children:children()}];
    }
  }
  function childrenOf(n:JSONContent){return n.content?.flatMap(c=>read(c))||[{text:''}];}
  return read(doc) as Value;
}
export function restoreDocumentEnvelope(initial:EditorModel):DocumentEnvelope {
  const keys=sessionId?[documentStorageKey]:[documentStorageKey,'math-tiptap-document-v1','math-text-flow-state'];
  try {
    const current=draftStorage().getItem(documentStorageKey);
    if(current)return parseDocumentEnvelope(current);
    // New windows/tabs are blank documents, never another view of the primary draft.
    if(sessionId)return {version:1,value:[{type:'p',children:[{text:''}]}],bibliographyLibraries:[]};
    const tiptap=draftStorage().getItem('math-tiptap-document-v1');
    if(tiptap){const saved=JSON.parse(tiptap);if(saved.version!==2)throw Error('Invalid previous document');return {version:1,value:fromTiptap(saved.doc),bibliographyLibraries:[]};}
    const legacy=draftStorage().getItem('math-text-flow-state');if(legacy)return {version:1,value:fromTiptap(migrateLegacy(legacy)),bibliographyLibraries:[]};
  }catch(error){
    for(const key of keys){const value=draftStorage().getItem(key);if(value)draftStorage().setItem(key+'-recovery',value);}
    console.warn('The original draft has been preserved for recovery.',error);
  }
  return {version:1,value:[{type:'p',children:[{text:''}]}],bibliographyLibraries:[]};
}
export function restoreDocument(initial:EditorModel):Value {return restoreDocumentEnvelope(initial).value;}
export function validate(nodes:unknown[]):void {
  for(const raw of nodes){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid document node');
    const n=raw as TElement & {text?:string;snapshot?:string};
    validateNodeFields(n);
    if('text' in n){
      if(typeof n.text!=='string'||'type' in n||'children' in n)throw Error('Invalid document text');
      continue;
    }
    if(typeof n.type!=='string'||!n.type||!Array.isArray(n.children)||!n.children.length)throw Error('Invalid document element');
    if(n.texLabel!==undefined&&!validReferenceKey(n.texLabel))throw Error('Invalid label');
    if(n.type==='tex_label'&&!validReferenceKey(n.texLabel))throw Error('Invalid label');
    if(n.type==='tex_reference')referenceTex(n as ReferenceNode);
    if(n.type==='bibliography_entry'&&!validCitationKey(n.citeKey))throw Error('Invalid citation key');
    if(isFormula(n)&&n.snapshot)new EditorModel().restore(n.snapshot);
    validate(n.children);
  }
}
/** Check fields consumed by the installed renderer, leaving other metadata intact. */
function validateNodeFields(n:Record<string,unknown>):void {
  const field=(name:string,check:(value:unknown)=>boolean,required=false)=>{
    if((required||n[name]!==undefined)&&!check(n[name]))throw Error('Invalid document field');
  };
  const string=(value:unknown)=>typeof value==='string';
  const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
  const boolean=(value:unknown)=>typeof value==='boolean';
  const cssSize=(value:unknown)=>string(value)||number(value);
  const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
  field('id',string);
  // The editor is extensible. An unknown node's metadata is not necessarily a
  // built-in mark, even when it happens to share a field name such as `code`.
  const knownElement=typeof n.type==='string'&&['p','h1','h2','h3','h4','h5','h6','blockquote','hr','a','date','mention','mention_input','tag','code_block','code_line','code_drawing','callout','img','audio','video','file','media_embed','placeholder','column','column_group','table','tr','td','th','toggle','toc','excalidraw','footnoteReference','footnoteDefinition','footnoteInput','equation','inline_equation','tex_label','tex_reference','bibliography_entry','ul','ol','li','lic'].includes(n.type);
  if(typeof n.text==='string'||knownElement){
    for(const name of ['color','backgroundColor','fontFamily','className','align','textAlign','listStyleType'])field(name,string);
    for(const name of ['fontSize','fontWeight','lineHeight','textIndent'])field(name,cssSize);
  }
  if(typeof n.text==='string')for(const name of ['bold','italic','underline','strikethrough','code','subscript','superscript','highlight','kbd'])field(name,boolean);
  if(knownElement){
    field('checked',boolean);
    for(const name of ['indent','listStart','listRestart','listRestartPolite'])field(name,number);
  }
  if(n.type==='a'){field('url',string,true);field('target',string);}
  if(n.type==='date'){field('date',string);field('rawDate',string);}
  if(n.type==='mention'||n.type==='tag')field('value',string,true);
  if(n.type==='code_block')field('lang',string);
  if(n.type==='callout'){field('icon',string);field('variant',string);}
  if(['img','audio','video','file','media_embed'].includes(String(n.type))){
    field('url',string,true);
    for(const name of ['name','provider','sourceUrl','placeholderId'])field(name,string);
    for(const name of ['width','height','initialWidth','initialHeight'])field(name,cssSize);
    field('isUpload',boolean);
    if(n.caption!==undefined){if(!Array.isArray(n.caption))throw Error('Invalid media caption');validate(n.caption);}
  }
  if(n.type==='placeholder')field('mediaType',value=>typeof value==='string'&&['img','audio','video','file'].includes(value),true);
  if(n.type==='column')field('width',cssSize);
  if(n.type==='column_group')field('layout',value=>Array.isArray(value)&&value.every(number));
  if(n.type==='table'){
    field('colSizes',value=>Array.isArray(value)&&value.every(number));field('marginLeft',number);
  }
  if(n.type==='tr'||n.type==='td'||n.type==='th'){
    field('size',number);
    for(const name of ['colSpan','rowSpan'])field(name,value=>number(value)&&Number.isInteger(value)&&Number(value)>=1);
    field('background',string);
    if(n.borders!==undefined){
      if(!object(n.borders))throw Error('Invalid table borders');
      for(const side of ['top','bottom','left','right']){
        const border=n.borders[side];if(border===undefined)continue;
        if(!object(border)||border.color!==undefined&&!string(border.color)||border.style!==undefined&&!string(border.style)||border.size!==undefined&&!number(border.size))throw Error('Invalid table border');
      }
    }
    if(n.attributes!==undefined){
      if(!object(n.attributes))throw Error('Invalid table attributes');
      for(const name of ['colspan','rowspan'])if(n.attributes[name]!==undefined&&!string(n.attributes[name]))throw Error('Invalid table span');
    }
  }
  if(n.type==='footnoteReference'||n.type==='footnoteDefinition')field('identifier',string);
  if(n.type==='equation'||n.type==='inline_equation'){
    // Snapshot-only formulas from older versions are still readable.
    field('texExpression',string);field('snapshot',string);field('display',boolean);field('numbered',boolean);
  }
  if(n.type==='code_drawing'||n.type==='excalidraw'){
    if(n.data!==undefined&&!object(n.data))throw Error('Invalid drawing data');
    const data=n.data as Record<string,unknown>|undefined;
    if(n.type==='code_drawing'){
      for(const name of ['code','drawingType','drawingMode'])if(data?.[name]!==undefined&&!string(data[name]))throw Error('Invalid drawing field');
    }else if(data){
      if(data.elements!==undefined&&(!Array.isArray(data.elements)||!data.elements.every(object)))throw Error('Invalid drawing elements');
      if(data.state!==undefined&&!object(data.state))throw Error('Invalid drawing state');
      const state=data.state as Record<string,unknown>|undefined;
      if(state?.viewBackgroundColor!==undefined&&!string(state.viewBackgroundColor))throw Error('Invalid drawing background');
    }
  }
}
/** Keep the established LaTeX prose exporter independent of the document engine. */
export function plateLatex(value:Value,formatMath?:(source:string)=>string):string {
  const read=(n:any):JSONContent=>{
    if(n.type==='tex_label')return {type:'texLabel',attrs:{texLabel:n.texLabel}};
    if(n.type==='tex_reference')return {type:'texReference',attrs:{command:n.command,keys:n.keys}};
    if(n.type==='bibliography_entry')return {type:'bibliographyEntry',attrs:{citeKey:n.citeKey},content:n.children?.map(read)};
    if(typeof n.text==='string')return {type:'text',text:n.text,marks:Object.keys(n).filter(k=>k!=='text'&&n[k]===true).map(type=>({type:type==='strikethrough'?'strike':type}))};
    if(isFormula(n))return {type:n.type==='equation'||n.display?'displayMath':'inlineMath',attrs:n};
    const type=/^h[1-6]$/.test(n.type)?'heading':({p:'paragraph',a:'text',code_block:'codeBlock',code_line:'paragraph',hr:'horizontalRule'} as Record<string,string>)[n.type]||n.type;
    return {type,attrs:{level:Number(n.type[1]),language:n.lang,texLabel:n.texLabel},content:n.children?.map(read)};
  };
  return documentLatex({type:'doc',content:value.map(read)},formatMath).trim();
}
