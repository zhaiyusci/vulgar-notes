// SPDX-License-Identifier: GPL-3.0-or-later
import type {TElement} from 'platejs';

export type FloatKind='figure'|'table';
export type FloatNode=TElement & {type:'float';id:string;kind:FloatKind;numbered:boolean;texLabel?:string;children:[TElement,TElement]};
export type FloatNumber={kind:FloatKind;number:string};
export type FloatChildrenRenderer=(children:readonly any[])=>string;
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const labelPattern=/^[A-Za-z][A-Za-z0-9:._-]*$/;
const leaf=()=>({text:''});
const paragraph=()=>({type:'p',children:[leaf()]});
const cell=()=>({type:'td',children:[paragraph()]});
const caption=()=>({type:'float_caption',children:[leaf()]});
const id=()=>`float-${crypto.randomUUID()}`;

/** Documents embed local image bytes; remote links remain explicit links. */
export function validFloatImageUrl(value:unknown):value is string {
  if(typeof value!=='string'||!value)return false;
  if(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return true;
  try {const url=new URL(value);return (url.protocol==='https:'||url.protocol==='http:')&&!url.username&&!url.password;}catch{return false;}
}
export function createFigure(url:string,alt=''):FloatNode {
  if(!validFloatImageUrl(url))throw Error('Use an HTTP(S) image URL or a PNG/JPEG image.');
  return {type:'float',id:id(),kind:'figure',numbered:true,children:[{type:'img',url,alt,children:[leaf()]},caption()]};
}
export function createTableFloat(rows=2,columns=2):FloatNode {
  if(!Number.isInteger(rows)||!Number.isInteger(columns)||rows<1||columns<1||rows>1000||columns>1000)throw Error('Invalid table dimensions.');
  return {type:'float',id:id(),kind:'table',numbered:true,children:[caption(),{type:'table',children:Array.from({length:rows},()=>({type:'tr',children:Array.from({length:columns},cell)}))}]};
}
/** Named children avoid assuming the figure and table reading orders coincide. */
export function floatBody(node:FloatNode):TElement {
  const result=node.children.find(child=>child.type===(node.kind==='table'?'table':'img'));
  if(!result)throw Error('A figure or table body is missing.');return result as TElement;
}
export function floatCaption(node:FloatNode):TElement {
  const result=node.children.find(child=>child.type==='float_caption');
  if(!result)throw Error('A figure or table caption is missing.');return result as TElement;
}
/** Validate the structural fields before handing a saved document to React/Slate. */
export function validFloatNode(value:unknown):value is FloatNode {
  if(!record(value)||value.type!=='float'||typeof value.id!=='string'||!value.id||!['figure','table'].includes(value.kind)||typeof value.numbered!=='boolean')return false;
  if(value.texLabel!==undefined&&(typeof value.texLabel!=='string'||!labelPattern.test(value.texLabel)))return false;
  if(!Array.isArray(value.children)||value.children.length!==2)return false;
  // The initial development build stored table captions after their body.
  // Accept that saved shape; FloatKit moves the same caption node on reopen.
  const captionFirst=value.kind==='table'&&value.children[0]?.type==='float_caption';
  const body=value.children[captionFirst?1:0],description=value.children[captionFirst?0:1];
  if(!record(description)||description.type!=='float_caption'||!Array.isArray(description.children)||!description.children.length)return false;
  const inline=(node:unknown):boolean=>record(node)&&(typeof node.text==='string'||['a','inline_equation','tex_reference','tex_label','footnoteReference'].includes(node.type)&&Array.isArray(node.children)&&node.children.length>0&&node.children.every(inline));
  if(!description.children.every(inline))return false;
  if(value.kind==='figure')return record(body)&&body.type==='img'&&validFloatImageUrl(body.url)&&(body.alt===undefined||typeof body.alt==='string')&&Array.isArray(body.children)&&body.children.length===1&&body.children[0]?.text==='';
  return record(body)&&body.type==='table'&&Array.isArray(body.children)&&body.children.length>0&&body.children.every((row:unknown)=>record(row)&&row.type==='tr'&&Array.isArray(row.children)&&row.children.length>0&&row.children.every((cell:unknown)=>record(cell)&&['td','th'].includes(cell.type)&&Array.isArray(cell.children)&&cell.children.length>0));
}
export function floatNumbers(nodes:readonly any[]):Map<string,FloatNumber> {
  const result=new Map<string,FloatNumber>(),counts={figure:0,table:0};
  const walk=(items:readonly any[])=>{for(const node of items){if(node?.type==='float'&&(node.kind==='figure'||node.kind==='table'))result.set(String(node.id),{kind:node.kind,number:node.numbered===false?'':String(++counts[node.kind as FloatKind])});if(Array.isArray(node?.children))walk(node.children);}};
  walk(nodes);return result;
}

/** Immutable grid editing for tests/importers. UI transforms preserve the same cells. */
export function editFloatTable(node:FloatNode,operation:'row-before'|'row-after'|'column-before'|'column-after'|'delete-row'|'delete-column',row:number,column:number):FloatNode {
  if(!validFloatNode(node)||node.kind!=='table')throw Error('Invalid table float.');
  const table=floatBody(node),rows=table.children as TElement[];
  if(!Number.isInteger(row)||row<0||row>=rows.length||!Number.isInteger(column)||column<0||column>=rows[row].children.length)throw Error('Invalid table cell.');
  if(rows.some(item=>item.children.some(c=>Number(c.colSpan||1)!==1||Number(c.rowSpan||1)!==1)))throw Error('Split merged cells before editing this grid.');
  let children=rows.map(item=>({...item,children:[...item.children]}));
  if(operation==='delete-row'){if(rows.length===1)return node;children.splice(row,1);}
  else if(operation==='row-before'||operation==='row-after')children.splice(row+(operation==='row-after'?1:0),0,{type:'tr',children:Array.from({length:rows[row].children.length},cell)});
  else if(operation==='delete-column'){if(rows.some(item=>item.children.length===1))return node;children=children.map(item=>({...item,children:item.children.filter((_,index)=>index!==column)}));}
  else if(operation==='column-before'||operation==='column-after')children=children.map(item=>{const next=[...item.children];next.splice(column+(operation==='column-after'?1:0),0,cell());return {...item,children:next};});
  return {...node,children:[floatCaption(node),{...table,children}]};
}

/** Preserve cell content, including merged cells, rather than flattening tables. */
export function tableLatex(table:any,renderChildren:FloatChildrenRenderer):string {
  if(table?.type!=='table'||!Array.isArray(table.children)||!table.children.length)throw Error('Invalid table.');
  const grid:{body:string;span:number;covered?:boolean}[][]=[];
  let columns=0;
  for(let rowIndex=0;rowIndex<table.children.length;rowIndex++){
    const current=grid[rowIndex]??=[];let column=0;
    for(const c of table.children[rowIndex].children){
      while(current[column])column++;
      const colSpan=Number(c.colSpan||1),rowSpan=Number(c.rowSpan||1);
      if(!Number.isInteger(colSpan)||colSpan<1||!Number.isInteger(rowSpan)||rowSpan<1||colSpan>1000||rowSpan>1000||rowIndex+rowSpan>table.children.length)throw Error('Invalid table span.');
      let body=renderChildren(c.children).trim().replace(/\n{2,}/g,'\\par ');
      if(rowSpan>1)body='\\multirow{'+rowSpan+'}{*}{'+body+'}';
      if(colSpan>1)body='\\multicolumn{'+colSpan+'}{l}{'+body+'}';
      for(let down=0;down<rowSpan;down++)for(let across=0;across<colSpan;across++){
        const target=grid[rowIndex+down]??=[];
        if(target[column+across])throw Error('Overlapping table spans.');
        target[column+across]={body:down===0&&across===0?body:'',span:down===0&&across===0?colSpan:1,covered:down===0&&across>0};
      }
      column+=colSpan;
    }
    columns=Math.max(columns,current.length);
  }
  const rows=grid.map(row=>{
    const cells:string[]=[];for(let column=0;column<columns;column++){const item=row[column];if(!item?.covered)cells.push(item?.body||'');}
    return cells.join(' & ');
  }).join(' \\\\\n');
  return '\\begin{tabular}{'+'l'.repeat(columns)+'}\n'+rows+'\n\\end{tabular}';
}
export function floatLatex(node:FloatNode,renderChildren:FloatChildrenRenderer,renderImage:(image:any)=>string):string {
  if(!validFloatNode(node))throw Error('Invalid float.');
  const captionText=renderChildren(floatCaption(node).children).trim(),content=floatBody(node);
  const body=node.kind==='table'?tableLatex(content,renderChildren):renderImage(content);
  // \label must follow \caption, so it captures this float's counter.
  const description='\\captionof'+(node.numbered?'':'*')+'{'+node.kind+'}{'+captionText+'}'+(node.numbered&&node.texLabel?'\\label{'+node.texLabel+'}':'');
  const contents=node.kind==='table'?'\\captionsetup{position=top}\n'+description+'\n'+body:body+'\n'+description;
  return '\\par\\noindent\n\\begin{minipage}{\\linewidth}\n\\centering\n'+contents+'\n\\end{minipage}\\par\n';
}
const htmlEscape=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
/** Markdown has no portable float type: keep semantic metadata in an HTML figure. */
export function floatMarkdown(node:FloatNode,renderChildren:FloatChildrenRenderer,prefix=''):string {
  if(!validFloatNode(node))throw Error('Invalid float.');
  const metadata=' data-float-kind="'+node.kind+'" data-numbered="'+node.numbered+'"'+(node.texLabel?' id="'+htmlEscape(node.texLabel)+'"':'');
  const content=floatBody(node),description='<figcaption>\n\n'+htmlEscape(prefix)+renderChildren(floatCaption(node).children)+'\n\n</figcaption>';
  const body=node.kind==='figure'?'<img src="'+htmlEscape(String(content.url))+'" alt="'+htmlEscape(String(content.alt||''))+'" />':
    '<table>\n'+content.children.map((row:any)=>'<tr>'+row.children.map((cell:any)=>'<'+cell.type+(cell.colSpan?' colspan="'+Number(cell.colSpan)+'"':'')+(cell.rowSpan?' rowspan="'+Number(cell.rowSpan)+'"':'')+'>\n\n'+renderChildren(cell.children)+'\n\n</'+cell.type+'>').join('')+'</tr>').join('\n')+'\n</table>';
  return '<figure'+metadata+'>\n'+(node.kind==='table'?description+'\n'+body:body+'\n'+description)+'\n</figure>\n';
}

export interface FloatImageAssets {resources:string;setup:string;renderImage:(image:any)=>string}
/** Single-file LuaLaTeX: fixed filenames + hex-only filecontents keep image bytes inert. */
export function collectFloatImageAssets(nodes:readonly any[]):FloatImageAssets {
  let hasObjects=false;
  const urls=new Map<string,{filename:string;hex:string}>();
  const walk=(items:readonly any[])=>{for(const node of items){if(node?.type==='float'||node?.type==='table')hasObjects=true;if(node?.type==='float'&&node.kind==='figure'){
    if(!validFloatNode(node))throw Error('Invalid figure.');
    const url=String(floatBody(node).url);
    if(!/^data:image\/(png|jpeg);base64,/.test(url))throw Error('Remote images must be saved as local PNG/JPEG images before LaTeX export.');
    if(!urls.has(url)){
      const match=url.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
      if(!match)throw Error('Invalid embedded image.');
      let binary:string;try{binary=atob(match[2]);}catch{throw Error('Invalid embedded image.');}
      const signature=match[1]==='png'?'\x89PNG\r\n\x1a\n':'\xff\xd8\xff';
      if(!binary.startsWith(signature))throw Error('The embedded image bytes do not match its PNG/JPEG format.');
      const hex=Array.from(binary,char=>char.charCodeAt(0).toString(16).padStart(2,'0')).join('');
      urls.set(url,{filename:'-vulgar-image-'+(urls.size+1)+(match[1]==='png'?'.png':'.jpg'),hex});
    }
  }if(Array.isArray(node?.children))walk(node.children);}};walk(nodes);
  const resources=[...urls.values()].map(({filename,hex})=>'\\begin{filecontents*}[overwrite]{\\jobname'+filename+'.hex}\n'+hex.match(/.{1,128}/g)!.join('\n')+'\n\\end{filecontents*}\n').join('\n');
  const decoding=[...urls.values()].map(({filename})=>'\\directlua{local input=assert(io.open(tex.jobname.."'+filename+'.hex","r")); local output=assert(io.open(tex.jobname.."'+filename+'","wb")); for line in input:lines() do output:write((line:gsub("..",function(c) return string.char(tonumber(c,16)) end))) end; input:close(); output:close()}').join('\n');
  return {resources,setup:hasObjects?'\\usepackage{graphicx}\n\\usepackage{caption}\n\\usepackage{multirow}\n'+decoding:'',renderImage:image=>{
    const asset=urls.get(String(image.url));if(!asset)throw Error('An image was not included in the LaTeX resources.');
    return '\\includegraphics[width=\\linewidth,keepaspectratio]{\\jobname'+asset.filename+'}';
  }};
}
