export interface JSONContent { type?:string; text?:string; attrs?:Record<string,any>; marks?:{type:string;attrs?:Record<string,any>}[]; content?:JSONContent[] }
import {EditorModel} from './editor-model';

export const isMath=(type?:string)=>type==='inlineMath'||type==='displayMath';
export function mathSource(snapshot:string):string {
  const model=new EditorModel();model.restore(snapshot);return model.exportLatex();
}
export function mathMarkdown(node:JSONContent):string {
  const latex=mathSource(node.attrs!.snapshot);
  if(node.type==='inlineMath')return '$'+latex+'$';
  return node.attrs!.numbered===false?'$$\n'+latex+'\n$$':'\\begin{equation}\n'+latex+'\n\\end{equation}';
}

/** One-way migration of the previous prototype's saved semantic tree. */
export function migrateLegacy(source:string):JSONContent {
  const saved=JSON.parse(source);
  if(saved?.version!==1||!Array.isArray(saved.parts))throw Error('Invalid legacy document');
  const ids=new Set<string>();
  const blocks=(nodes:JSONContent[]):JSONContent[]=>{
    const result:JSONContent[]=[],inline:JSONContent[]=[];
    const flush=()=>{if(inline.length)result.push({type:'paragraph',content:inline.splice(0)});};
    for(const node of nodes){if(['text','hardBreak','inlineMath'].includes(node.type!))inline.push(node);else{flush();result.push(node);}}
    flush();return result.length?result:[{type:'paragraph'}];
  };
  const read=(parts:unknown[],marks:JSONContent['marks']=[]):JSONContent[]=>parts.flatMap((raw):JSONContent[]=>{
    const part=raw as {kind?:string;text?:unknown;id?:unknown;snapshot?:unknown;display?:unknown;numbered?:unknown;tag?:string;children?:unknown[]};
    if(!part||typeof part!=='object')throw Error('Invalid legacy part');
    if(part.kind==='text'&&typeof part.text==='string')return part.text.split('\n').flatMap((line,i)=>[
      ...(i?[{type:'hardBreak'}]:[]),...(line?[{type:'text',text:line,marks}]:[])
    ]);
    if(part.kind==='math'){
      if(typeof part.id!=='string'||ids.has(part.id)||typeof part.snapshot!=='string'||part.display!==undefined&&typeof part.display!=='boolean'||part.numbered!==undefined&&typeof part.numbered!=='boolean')throw Error('Invalid legacy math');
      mathSource(part.snapshot);ids.add(part.id);
      return [{type:part.display?'displayMath':'inlineMath',attrs:{id:part.id,snapshot:part.snapshot,numbered:part.numbered!==false}}];
    }
    if(part.kind!=='rich'||!Array.isArray(part.children))throw Error('Invalid legacy format');
    const mark:Record<string,string>={b:'bold',strong:'bold',i:'italic',em:'italic',u:'underline',s:'strike',strike:'strike',sub:'subscript',sup:'superscript'};
    if(mark[part.tag!])return read(part.children,[...marks!,{type:mark[part.tag!]}]);
    const children=read(part.children,marks);
    if(part.tag==='br')return [{type:'hardBreak'}];
    if(part.tag==='p'||part.tag==='div')return blocks(children);
    if(/^h[123]$/.test(part.tag!))return [{type:'heading',attrs:{level:Number(part.tag![1])},content:children}];
    if(part.tag==='blockquote')return [{type:'blockquote',content:blocks(children)}];
    if(part.tag==='li')return [{type:'listItem',content:blocks(children)}];
    if(part.tag==='ul'||part.tag==='ol')return [{type:part.tag==='ul'?'bulletList':'orderedList',content:children}];
    throw Error('Unsupported legacy format');
  });
  return {type:'doc',content:blocks(read(saved.parts))};
}

const escapeText=(text:string)=>text.replace(/[\\{}$%#&_~^]/g,c=>({
  '\\':'\\textbackslash{}','~':'\\textasciitilde{}','^':'\\textasciicircum{}'
} as Record<string,string>)[c]??'\\'+c);

/** LaTeX is an additional export; Markdown is serialized by Tiptap itself. */
export function documentLatex(node:JSONContent,formatMath:(source:string)=>string=source=>source):string {
  const body=(node.content||[]).map(child=>documentLatex(child,formatMath)).join('');
  if(isMath(node.type)){
    const source=formatMath(mathSource(node.attrs!.snapshot)),env=node.attrs!.numbered===false?'equation*':'equation';
    return node.type==='displayMath'?`\n\\begin{${env}}\n${source}\n\\end{${env}}\n`:'\\('+source+'\\)';
  }
  if(node.type==='text')return (node.marks||[]).reduce((text,mark)=>{
    const command:Record<string,string>={bold:'textbf',italic:'emph',underline:'underline',code:'texttt',subscript:'textsubscript',superscript:'textsuperscript'};
    return command[mark.type]?`\\${command[mark.type]}{${text}}`:text;
  },escapeText(node.text||''));
  if(node.type==='hardBreak')return '\\\\\n';
  if(node.type==='paragraph')return body+'\n\n';
  if(node.type==='heading')return `\\${['section','subsection','subsubsection'][Math.min(3,node.attrs?.level||1)-1]}*{${body}}\n\n`;
  if(node.type==='listItem')return '\\item '+body.trim()+'\n';
  const env:Record<string,string>={bulletList:'itemize',orderedList:'enumerate',blockquote:'quote'};
  if(env[node.type!])return `\n\\begin{${env[node.type!]}}\n${body}\\end{${env[node.type!]}}\n`;
  if(node.type==='codeBlock')return '\\begin{verbatim}\n'+(node.content||[]).map(n=>n.text||'').join('')+'\n\\end{verbatim}\n';
  if(node.type==='horizontalRule')return '\n\\hrule\n';
  return body;
}
