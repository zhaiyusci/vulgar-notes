import {draftStorage} from './platform';
import type {TElement, Value, Descendant} from 'platejs';
import {type JSONContent, migrateLegacy, documentLatex} from './document-format';
import {EditorModel} from './editor-model';
import {referenceTex,validReferenceKey,type ReferenceNode} from './references';

export const documentStorageKey='math-plate-document-v1';
export function documentContentKey(source:string):string {
  return JSON.stringify(JSON.parse(source), (key,value)=>{
    if(key==='snapshot'&&typeof value==='string')return JSON.parse(value).root;
    return value;
  });
}
export function parseDocumentFile(source:string):Value {
  const saved=JSON.parse(source);
  if(saved?.version!==1||!Array.isArray(saved.value)||!saved.value.length)throw Error('Invalid document format');
  validate(saved.value);
  if(saved.value.some((node:any)=>typeof node.type!=='string'||!Array.isArray(node.children)))throw Error('Invalid document root');
  return saved.value;
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
export function restoreDocument(initial:EditorModel):Value {
  try {
    const current=draftStorage().getItem(documentStorageKey);
    if(current){const saved=JSON.parse(current);if(saved.version!==1||!Array.isArray(saved.value))throw Error('Invalid Plate document');validate(saved.value);return saved.value;}
    const tiptap=draftStorage().getItem('math-tiptap-document-v1');
    if(tiptap){const saved=JSON.parse(tiptap);if(saved.version!==2)throw Error('Invalid previous document');return fromTiptap(saved.doc);}
    const legacy=draftStorage().getItem('math-text-flow-state');if(legacy)return fromTiptap(migrateLegacy(legacy));
  }catch(error){
    for(const key of [documentStorageKey,'math-tiptap-document-v1','math-text-flow-state']){const value=draftStorage().getItem(key);if(value)draftStorage().setItem(key+'-recovery',value);}
    console.warn('The original draft has been preserved for recovery.',error);
  }
  return [{type:'p',children:[{text:'在这里输入正文。已知 '},formulaNode(initial),{text:'，可以继续输入文字，也可以在光标处插入新的公式。'}]}];
}
export function validate(nodes:unknown[]):void {
  for(const raw of nodes){
    if(!raw||typeof raw!=='object')throw Error('Invalid document node');
    const n=raw as TElement & {text?:string;snapshot?:string};
    if(typeof n.text==='string')continue;
    if(typeof n.type!=='string'||!Array.isArray(n.children))throw Error('Invalid document element');
    if(n.texLabel!==undefined&&!validReferenceKey(n.texLabel))throw Error('Invalid label');
    if(n.type==='tex_reference')referenceTex(n as ReferenceNode);
    if(n.type==='bibliography_entry'&&!validReferenceKey(n.citeKey))throw Error('Invalid citation key');
    if(isFormula(n)&&n.snapshot)new EditorModel().restore(n.snapshot);
    validate(n.children);
  }
}
/** Keep the established LaTeX prose exporter independent of the document engine. */
export function plateLatex(value:Value,formatMath?:(source:string)=>string):string {
  const read=(n:any):JSONContent=>{
    if(n.type==='tex_reference')return {type:'texReference',attrs:{command:n.command,keys:n.keys}};
    if(n.type==='bibliography_entry')return {type:'bibliographyEntry',attrs:{citeKey:n.citeKey},content:n.children?.map(read)};
    if(typeof n.text==='string')return {type:'text',text:n.text,marks:Object.keys(n).filter(k=>k!=='text'&&n[k]===true).map(type=>({type:type==='strikethrough'?'strike':type}))};
    if(isFormula(n))return {type:n.type==='equation'||n.display?'displayMath':'inlineMath',attrs:n};
    const type=/^h[1-6]$/.test(n.type)?'heading':({p:'paragraph',a:'text',code_block:'codeBlock',code_line:'paragraph',hr:'horizontalRule'} as Record<string,string>)[n.type]||n.type;
    return {type,attrs:{level:Number(n.type[1]),language:n.lang,texLabel:n.texLabel},content:n.children?.map(read)};
  };
  return documentLatex({type:'doc',content:value.map(read)},formatMath).trim();
}
