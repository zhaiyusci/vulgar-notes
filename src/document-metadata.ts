// SPDX-License-Identifier: GPL-3.0-or-later
import type {TElement,Value} from 'platejs';

/** Legacy file metadata. New document details are ordinary rich text in a document_metadata block. */
export interface DocumentAuthor {name:string;affiliation:string;email:string}
export interface DocumentMetadata {title:string;authors:DocumentAuthor[]}
export type MetadataRole='title'|'author'|'affiliation'|'note'|'text';
export type MetadataEntry=TElement&{type:'metadata_entry';role:MetadataRole;id:string;affiliationIds?:string[];noteIds?:string[]};
const metadataRoles:readonly MetadataRole[]=['title','author','affiliation','note','text'];
export const isMetadataRole=(role:unknown):role is MetadataRole=>typeof role==='string'&&metadataRoles.includes(role as MetadataRole);
const referenceIds=(value:unknown):value is string[]=>Array.isArray(value)&&Array.from(value).every(id=>typeof id==='string'&&!!id.trim())&&new Set(value).size===value.length;

/** Relations may be unresolved while editing; malformed relation data is never accepted. */
export function validMetadataEntry(value:unknown):value is MetadataEntry {
  if(!record(value)||value.type!=='metadata_entry'||!isMetadataRole(value.role)||typeof value.id!=='string'||!value.id.trim())return false;
  if(!Array.isArray(value.children)||!value.children.length||!Array.from(value.children).every(child=>record(child)&&typeof child.type==='string'&&Array.isArray(child.children)&&child.children.length>0))return false;
  // Changing an entry's role does not destroy dormant associations from its previous role.
  if(value.affiliationIds!==undefined&&!referenceIds(value.affiliationIds))return false;
  if(value.noteIds!==undefined&&!referenceIds(value.noteIds))return false;
  return true;
}
export const isMetadataEntry=validMetadataEntry;
export function validateMetadataEntry(value:unknown):MetadataEntry {
  if(!validMetadataEntry(value))throw Error('Invalid metadata entry.');
  return value;
}

export function createMetadataEntry(role:MetadataRole):MetadataEntry {
  if(!isMetadataRole(role))throw Error('Invalid metadata entry role.');
  return {type:'metadata_entry',role,id:crypto.randomUUID(),children:[{type:'p',children:[{text:''}]}]};
}

export function metadataEntryText(value:unknown):string {
  if(!record(value))return '';
  if(typeof value.text==='string')return value.text;
  if((value.type==='inline_equation'||value.type==='equation')&&typeof value.texExpression==='string')return value.texExpression;
  if(value.type==='tex_reference'&&Array.isArray(value.keys))return value.keys.join(', ');
  return Array.isArray(value.children)?value.children.map(metadataEntryText).join(''):'';
}
export const isMetadataEntryEmpty=(entry:MetadataEntry)=>!metadataEntryText(entry).trim();

/** Display labels follow the current numbering; persisted associations keep their original IDs and order. */
export function metadataOrderedIds(ids:readonly string[],numbers:ReadonlyMap<string,number>):string[] {
  return [...ids].sort((left,right)=>(numbers.get(left)??Infinity)-(numbers.get(right)??Infinity));
}

/** The metadata reading order is semantic; untyped legacy prose joins the final text group. */
export function metadataRoleOrder(node:unknown):number {
  return record(node)&&node.type==='metadata_entry'&&isMetadataRole(node.role)?metadataRoles.indexOf(node.role):4;
}

/** Move an existing author or affiliation inside its group, retaining every child and association. */
export function reorderMetadataEntries(block:TElement,movingId:string,beforeId:string|null):TElement {
  if(block.type!=='document_metadata')return block;
  const entries=block.children.filter(validMetadataEntry),moving=entries.find(entry=>entry.id===movingId);
  if(!moving||moving.role!=='author'&&moving.role!=='affiliation')return block;
  const siblings=entries.filter(entry=>entry.role===moving.role);
  if(entries.filter(entry=>entry.id===movingId).length!==1||beforeId===movingId||beforeId!==null&&(entries.filter(entry=>entry.id===beforeId).length!==1||!siblings.some(entry=>entry.id===beforeId)))return block;
  const normalized=normalizeMetadataLayout([block])[0] as TElement;
  if(siblings.length===1)return normalized;
  const normalizedMoving=normalized.children.find(entry=>entry.id===movingId)!;
  const children=normalized.children.filter(entry=>entry!==normalizedMoving);
  const lastSibling=children.filter(entry=>entry.type==='metadata_entry'&&entry.role===moving.role).at(-1)!;
  const at=beforeId===null?children.indexOf(lastSibling)+1:children.findIndex(entry=>entry.type==='metadata_entry'&&entry.id===beforeId);
  children.splice(at,0,normalizedMoving);
  return children.every((entry,index)=>entry===normalized.children[index])?normalized:{...normalized,children};
}

/** Stable role groups are the real document order, shared by editing, persistence and export. */
export function normalizeMetadataLayout(value:Value):Value {
  const walk=(nodes:readonly any[]):readonly any[]=>{
    let localChange=false;
    const result=nodes.map(node=>{
      if(!node||typeof node!=='object'||!Array.isArray(node.children))return node;
      let children=walk(node.children);
      if(node.type==='document_metadata'){
        const ordered=[...children].sort((left,right)=>metadataRoleOrder(left)-metadataRoleOrder(right));
        if(ordered.some((entry,index)=>entry!==children[index]))children=ordered;
      }
      if(children===node.children)return node;
      localChange=true;return {...node,children};
    });
    return localChange?result:nodes;
  };
  return walk(value) as Value;
}

/** Compatibility for callers written before all metadata roles were grouped. */
export const normalizeMetadataAuthors=normalizeMetadataLayout;

export interface MetadataIndex {
  entries:MetadataEntry[];titles:MetadataEntry[];authors:MetadataEntry[];affiliations:MetadataEntry[];notes:MetadataEntry[];
  affiliationNumbers:Map<string,number>;noteNumbers:Map<string,number>;
}

/** Relations are local to a block, while visible numbering follows the whole document. */
export function metadataIndex(input:TElement|readonly TElement[]):MetadataIndex {
  const blocks=Array.isArray(input)?input:[input],entries:MetadataEntry[]=[],owners=new Map<MetadataEntry,Set<MetadataEntry>>();
  for(const block of blocks){
    const local=new Set<MetadataEntry>((block.children??[]).filter(validMetadataEntry));
    for(const entry of local){entries.push(entry);owners.set(entry,local);}
  }
  const titles=entries.filter(entry=>entry.role==='title'),authors=entries.filter(entry=>entry.role==='author'),affiliations=entries.filter(entry=>entry.role==='affiliation'),notes=entries.filter(entry=>entry.role==='note');
  const counts=new Map<string,number>();for(const entry of entries)counts.set(entry.id,(counts.get(entry.id)??0)+1);
  const unique=(entry:MetadataEntry)=>counts.get(entry.id)===1;
  const affiliationNumbers=new Map<string,number>(),noteNumbers=new Map<string,number>();
  for(const affiliation of affiliations)if(unique(affiliation)&&!isMetadataEntryEmpty(affiliation))affiliationNumbers.set(affiliation.id,affiliationNumbers.size+1);
  for(const owner of [...titles,...authors]){
    if(isMetadataEntryEmpty(owner)||!unique(owner))continue;
    for(const id of owner.noteIds??[]){
      const note=notes.find(entry=>entry.id===id&&owners.get(owner)?.has(entry));
      if(note&&unique(note)&&!isMetadataEntryEmpty(note)&&!noteNumbers.has(id))noteNumbers.set(id,noteNumbers.size+1);
    }
  }
  return {entries,titles,authors,affiliations,notes,affiliationNumbers,noteNumbers};
}

/** Standard LaTeX fnsymbol marks; the entire series switches to [n] beyond nine notes. */
export function metadataNoteSymbol(number:number,totalReferencedNotes=9):string {
  if(!Number.isInteger(number)||number<1)return '??';
  return totalReferencedNotes>9?'['+number+']':(['*','†','‡','§','¶','‖','**','††','‡‡'][number-1]??'['+number+']');
}

export function emptyDocumentMetadata():DocumentMetadata {return {title:'',authors:[]};}

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const hasExactKeys=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const plainText=(value:unknown):value is string=>typeof value==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);

/** Missing metadata is the backwards-compatible representation of an untitled document. */
export function parseDocumentMetadata(value:unknown):DocumentMetadata {
  if(value===undefined)return emptyDocumentMetadata();
  if(!record(value)||!hasExactKeys(value,['title','authors'])||!plainText(value.title)||!Array.isArray(value.authors))
    throw Error('Invalid document metadata.');
  const authors=Array.from(value.authors,author=>{
    if(!record(author)||!hasExactKeys(author,['name','affiliation','email'])||!plainText(author.name)||!plainText(author.affiliation)||!plainText(author.email))
      throw Error('Invalid document metadata.');
    return {name:author.name,affiliation:author.affiliation,email:author.email};
  });
  return {title:value.title,authors};
}

export function cloneDocumentMetadata(metadata:DocumentMetadata):DocumentMetadata {
  return parseDocumentMetadata(metadata);
}

/** Create once per update, so external-store subscribers receive a stable, immutable snapshot. */
export function documentMetadataSnapshot(value:unknown):DocumentMetadata {
  const metadata=parseDocumentMetadata(value);
  for(const author of metadata.authors)Object.freeze(author);
  Object.freeze(metadata.authors);
  return Object.freeze(metadata);
}

export function isDocumentMetadataEmpty(metadata:DocumentMetadata):boolean {
  return !metadata.title.trim()&&metadata.authors.every(author=>!author.name.trim()&&!author.affiliation.trim()&&!author.email.trim());
}

/** Semantic entries retain ordinary editable paragraphs and all their rich text. */
export function createMetadataBlock():TElement {
  return {type:'document_metadata',id:crypto.randomUUID(),children:[createMetadataEntry('title'),createMetadataEntry('author')]};
}

/** Identity is stable across old-file baseline comparisons; this hash is not a security token. */
function legacyMetadataId(metadata:DocumentMetadata):string {
  const source=JSON.stringify(metadata);let hash=0xcbf29ce484222325n;
  for(let index=0;index<source.length;index++)hash=BigInt.asUintN(64,(hash^BigInt(source.charCodeAt(index)))*0x100000001b3n);
  return 'metadata-legacy-'+hash.toString(16).padStart(16,'0');
}

/** Preserve legacy fields in semantic entries without guessing at existing free-form text. */
export function legacyMetadataBlock(metadata:DocumentMetadata):TElement|undefined {
  const checked=parseDocumentMetadata(metadata);
  if(isDocumentMetadataEmpty(checked))return undefined;
  const entries:MetadataEntry[]=[],base=legacyMetadataId(checked);
  const add=(role:MetadataRole,id:string,text:string,bold=false):MetadataEntry=>{
    const entry:MetadataEntry={type:'metadata_entry',role,id,children:[{type:'p',children:[{text,...(bold?{bold:true}:{})}]}]};entries.push(entry);return entry;
  };
  if(checked.title)add('title',base+'-title',checked.title,true);
  checked.authors.forEach((author,index)=>{
    if(!author.name&&!author.affiliation&&!author.email)return;
    const entry=add('author',base+'-author-'+index,author.name,true);
    if(author.affiliation){const affiliation=add('affiliation',base+'-affiliation-'+index,author.affiliation);entry.affiliationIds=[affiliation.id];}
    if(author.email){const note=add('note',base+'-email-'+index,author.email);entry.noteIds=[note.id];}
  });
  return {type:'document_metadata',id:base,children:entries};
}

/** A document has one semantic title; later title content is retained as ordinary text. */
export function normalizeDocumentTitles(value:Value):Value {
  let hasTitle=false;
  const walk=(nodes:readonly any[],inMetadata:boolean):readonly any[]=>{
    let changed=false;
    const next=nodes.map(node=>{
      if(!node||typeof node!=='object')return node;
      const inside=inMetadata||node.type==='document_metadata';let updated=node;
      if(inside&&node.type==='metadata_entry'&&node.role==='title'){
        if(hasTitle)updated={...node,role:'text'};
        else hasTitle=true;
      }
      if(Array.isArray(node.children)){
        const children=walk(node.children,inside);
        if(children!==node.children)updated={...updated,children};
      }
      if(updated!==node)changed=true;
      return updated;
    });
    return changed?next:nodes;
  };
  return walk(value,false) as Value;
}

/** Migration never replaces an existing block; both sources may contain unique information. */
export function migrateDocumentMetadata(value:Value,metadata?:DocumentMetadata):Value {
  const legacy=metadata===undefined?undefined:legacyMetadataBlock(metadata);
  if(!legacy)return normalizeMetadataLayout(normalizeDocumentTitles([...value]));
  const ids=new Set<string>();
  const collect=(nodes:readonly any[])=>{for(const node of nodes){if(typeof node?.id==='string')ids.add(node.id);if(Array.isArray(node?.children))collect(node.children);}};
  collect(value);
  const base=String(legacy.id);let candidate=base,suffix=2;
  const mappedId=(id:string)=>candidate+id.slice(base.length);
  while(ids.has(candidate)||legacy.children.some(entry=>typeof entry.id==='string'&&ids.has(mappedId(entry.id))))candidate=base+'-'+suffix++;
  const children=legacy.children.map(entry=>validMetadataEntry(entry)?{...entry,id:mappedId(entry.id),
    ...(entry.affiliationIds?{affiliationIds:entry.affiliationIds.map(mappedId)}:{}),...(entry.noteIds?{noteIds:entry.noteIds.map(mappedId)}:{})}:entry);
  return normalizeMetadataLayout(normalizeDocumentTitles([{...legacy,id:candidate,children},...value]));
}

/** Metadata is plain text, never an opportunity to introduce TeX commands. */
const textLatex=(text:string):string=>text.replace(/[\\{}$%#&_~^\r\n\t]/g,char=>({
  '\\':'\\textbackslash{}','~':'\\textasciitilde{}','^':'\\textasciicircum{}',
  '\r':' ','\n':' ','\t':' ',
} as Record<string,string>)[char]??'\\'+char);

/** Legacy structured-metadata export; new blocks are serialized from the Slate tree. */
export function metadataLatex(metadata:DocumentMetadata):{setup:string;body:string} {
  const checked=parseDocumentMetadata(metadata);
  if(isDocumentMetadataEmpty(checked))return {setup:'',body:''};
  const authors=checked.authors.map(author=>[author.name,author.affiliation,author.email]
    .filter(part=>part.trim()).map(textLatex).join('\\\\\n')).filter(Boolean).join('\\and\n');
  return {
    setup:'\\title{'+textLatex(checked.title)+'}\n\\author{'+authors+'}\n\\date{}\n',
    body:'\\maketitle\n',
  };
}

/** Legacy structured-metadata export. JSON strings are safe YAML-compatible scalars. */
export function metadataMarkdown(metadata:DocumentMetadata):string {
  const checked=parseDocumentMetadata(metadata);
  if(isDocumentMetadataEmpty(checked))return '';
  return '---\ntitle: '+JSON.stringify(checked.title)+'\nauthors: '+JSON.stringify(checked.authors)+'\n---\n\n';
}
