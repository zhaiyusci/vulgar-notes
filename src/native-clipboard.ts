// SPDX-License-Identifier: GPL-3.0-or-later
import type {Value} from 'platejs';
import {EditorModel} from './editor-model';
import {parseDocumentEnvelope} from './plate-document';
import {citedBibLibraries,parseBibLibraries,validateBibLibraries,type BibLibrary} from './bibtex';
import {citedReferenceKeys} from './references';
import {parseVerbatim,type VerbatimEntry} from '@retorquere/bibtex-parser';

export const nativeClipboardMime='application/x-vulgar-notes-fragment+json';
export const nativeClipboardAttribute='data-vulgar-notes-fragment';
const maxClipboardLength=50*1024*1024,maxDepth=200;
export interface NativeMathFragment {version:1;kind:'math';snapshot:string}
export interface NativeDocumentFragment {
  version:1;kind:'document';value:Value;bibliographyLibraries?:BibLibrary[];
  /** Dependencies travel separately so an inline selection stays inline. */
  endnoteDefinitions?:Value;
  sourceDocumentId?:string;
}
export type NativeFragment=NativeMathFragment|NativeDocumentFragment;
type ClipboardReader=Pick<DataTransfer,'getData'>;
type ClipboardWriter=Pick<DataTransfer,'setData'>;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Check the complete JSON boundary before calling extensible editor validators. */
function safeJson(value:unknown,depth=0,seen=new Set<object>()):boolean {
  if(depth>maxDepth)return false;
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value!=='object'||seen.has(value))return false;
  seen.add(value);
  const prototype=Object.getPrototypeOf(value);
  const okay=Array.isArray(value)?value.every(child=>safeJson(child,depth+1,seen)):
    prototype!==null&&Object.getPrototypeOf(prototype)!==null?false:
    Object.keys(value).every(key=>!['__proto__','prototype','constructor'].includes(key)&&safeJson((value as Record<string,unknown>)[key],depth+1,seen));
  seen.delete(value);return okay;
}

function validateDocumentFragment(value:unknown):value is Value {
  if(!Array.isArray(value)||!value.length)return false;
  // Slate can copy a text leaf or an inline node without its parent block.
  // Validation gets temporary parents; the actual fragment is never rewritten.
  const roots=value.map(node=>record(node)&&typeof node.text==='string'?{type:'p',children:[node]}:
    record(node)&&node.type==='metadata_entry'?{type:'document_metadata',children:[node]}:node);
  try{
    visit(value,node=>{if(typeof node.snapshot==='string'&&node.snapshot&&!safeJson(JSON.parse(node.snapshot)))throw Error('Invalid snapshot.');});
    parseDocumentEnvelope(JSON.stringify({version:1,value:roots}));return true;
  }catch{return false;}
}

export function validateNativeFragment(value:unknown):NativeFragment|null {
  try{
    if(!record(value)||!safeJson(value)||value.version!==1)return null;
    const serialized=JSON.stringify(value);if(serialized.length>maxClipboardLength)return null;
    if(value.kind==='math'){
      if(typeof value.snapshot!=='string')return null;
      // A snapshot is another JSON boundary, including preserved source nodes.
      if(!safeJson(JSON.parse(value.snapshot)))return null;
      new EditorModel().restore(value.snapshot);
      return {version:1,kind:'math',snapshot:value.snapshot};
    }
    if(value.kind!=='document'||!validateDocumentFragment(value.value))return null;
    if(value.sourceDocumentId!==undefined&&typeof value.sourceDocumentId!=='string')return null;
    const libraries=validateBibLibraries(value.bibliographyLibraries);
    if(value.endnoteDefinitions!==undefined&&(!Array.isArray(value.endnoteDefinitions)||value.endnoteDefinitions.length>0&&!validateDocumentFragment(value.endnoteDefinitions)||
      !(value.endnoteDefinitions as any[]).every(node=>node.type==='footnoteDefinition')))return null;
    // Return detached JSON data; no editor, DOM objects or caller-owned aliases.
    return JSON.parse(JSON.stringify({version:1,kind:'document',value:value.value,
      ...(libraries.length?{bibliographyLibraries:libraries}:{}),
      ...(value.endnoteDefinitions!==undefined?{endnoteDefinitions:value.endnoteDefinitions}:{}),
      ...(value.sourceDocumentId!==undefined?{sourceDocumentId:value.sourceDocumentId}:{})}));
  }catch{return null;}
}

function parseFragment(source:string):NativeFragment|null {
  if(!source||source.length>maxClipboardLength)return null;
  try{return validateNativeFragment(JSON.parse(source));}catch{return null;}
}
function encodedFragment(fragment:NativeFragment):string {
  const bytes=new TextEncoder().encode(JSON.stringify(fragment));
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}

/** Include only generated/sanitized fallback HTML, never external untrusted markup. */
export function nativeClipboardHtml(fragment:NativeFragment,fallbackHtml:string):string {
  const checked=validateNativeFragment(fragment);if(!checked)throw Error('Invalid native clipboard fragment.');
  return '<span '+nativeClipboardAttribute+'="'+encodedFragment(checked)+'">'+fallbackHtml+'</span>';
}

/** HTML is inspected as an inert string. No DOM is created and no HTML is executed. */
export function readNativeClipboard(data:ClipboardReader):NativeFragment|null {
  try{const direct=data.getData(nativeClipboardMime);if(direct)return parseFragment(direct);}catch{/* Clipboard MIME may be unavailable. */}
  try{
    const html=data.getData('text/html');if(html.length>maxClipboardLength*2)return null;
    const marker=/\bdata-vulgar-notes-fragment\s*=\s*(["'])([A-Za-z0-9+/=]+)\1/i.exec(html);
    if(!marker||marker[2].length>Math.ceil(maxClipboardLength*4/3)+4)return null;
    const binary=atob(marker[2]),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
    return parseFragment(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{return null;}
}
export function hasNativeClipboard(data:ClipboardReader):boolean {
  try{if(data.getData(nativeClipboardMime))return true;}catch{/* Try the portable marker. */}
  try{return /\bdata-vulgar-notes-fragment\s*=/i.test(data.getData('text/html'));}catch{return false;}
}
export function writeNativeClipboard(data:ClipboardWriter,fragment:NativeFragment):boolean {
  const checked=validateNativeFragment(fragment);if(!checked)return false;
  try{data.setData(nativeClipboardMime,JSON.stringify(checked));return true;}catch{return false;}
}

const visit=(nodes:readonly any[],action:(node:any)=>void)=>{
  for(const node of nodes){action(node);if(Array.isArray(node.children))visit(node.children,action);if(Array.isArray(node.caption))visit(node.caption,action);}
};

/** Copy bibliography/endnote dependencies, not unrelated parts of the document. */
export function captureDocumentFragment(value:Value,libraries:readonly BibLibrary[]=[],sourceValue?:Value,sourceDocumentId?:string):NativeDocumentFragment {
  const definitions=new Map<string,any[]>(),selectedDefinitions=new Set<string>();
  visit(value,node=>{if(node.type==='footnoteDefinition'&&typeof node.identifier==='string')selectedDefinitions.add(node.identifier);});
  visit(sourceValue??value,node=>{if(node.type==='footnoteDefinition'&&typeof node.identifier==='string')definitions.set(node.identifier,[...(definitions.get(node.identifier)??[]),node]);});
  const extras:any[]=[],seen=new Set<string>();
  const include=(node:any)=>{
    if(node.type!=='footnoteReference'||typeof node.identifier!=='string'||seen.has(node.identifier))return;
    seen.add(node.identifier);if(selectedDefinitions.has(node.identifier))return;
    const matching=definitions.get(node.identifier);
    if(matching?.length===1){extras.push(matching[0]);visit(matching[0].children,include);}
  };visit(value,include);
  const referenced=citedReferenceKeys([...value,...extras] as Value);
  const fragment=validateNativeFragment({version:1,kind:'document',value,
    bibliographyLibraries:citedBibLibraries(libraries,referenced),
    ...(extras.length?{endnoteDefinitions:extras}:{}),...(sourceDocumentId?{sourceDocumentId}:{})});
  if(!fragment||fragment.kind!=='document')throw Error('Invalid native clipboard fragment.');return fragment;
}

export interface CloneDocumentFragmentOptions {sameDocument?:boolean;existingLibraries?:readonly BibLibrary[]}
const freshId=()=>'clipboard-'+crypto.randomUUID();
function uniqueKey(key:string,used:Set<string>):string {
  if(!used.has(key)){used.add(key);return key;}
  let suffix=2;while(used.has(key+'-copy'+suffix))suffix++;
  const next=key+'-copy'+suffix;used.add(next);return next;
}

/** Duplicate identity is never copied; links are redirected only to copied targets. */
export function cloneDocumentFragment(fragment:NativeDocumentFragment,existingValue:Value,options:CloneDocumentFragmentOptions={}):NativeDocumentFragment {
  const checked=validateNativeFragment(fragment);if(!checked||checked.kind!=='document')throw Error('Invalid native clipboard fragment.');
  if(options.sameDocument&&checked.endnoteDefinitions){
    const existingNotes=new Map<string,number>();
    visit(existingValue,node=>{if(node.type==='footnoteDefinition'&&typeof node.identifier==='string')existingNotes.set(node.identifier,(existingNotes.get(node.identifier)??0)+1);});
    checked.endnoteDefinitions=checked.endnoteDefinitions.filter(node=>existingNotes.get(String(node.identifier))!==1);
  }
  const all=[...checked.value,...checked.endnoteDefinitions??[]];
  const usedLabels=new Set<string>(),usedNotes=new Set<string>();
  visit(existingValue,node=>{if(typeof node.texLabel==='string')usedLabels.add(node.texLabel);if(node.type==='footnoteDefinition'&&typeof node.identifier==='string')usedNotes.add(node.identifier);});
  const counts=new Map<string,number>(),noteCounts=new Map<string,number>(),metadataCounts=new Map<string,number>();
  visit(all,node=>{
    if(typeof node.texLabel==='string')counts.set(node.texLabel,(counts.get(node.texLabel)??0)+1);
    if(node.type==='footnoteDefinition'&&typeof node.identifier==='string')noteCounts.set(node.identifier,(noteCounts.get(node.identifier)??0)+1);
    if(node.type==='metadata_entry'&&typeof node.id==='string')metadataCounts.set(node.id,(metadataCounts.get(node.id)??0)+1);
  });
  const labels=new Map<string,string>(),notes=new Map<string,string>(),metadata=new Map<string,string>();
  for(const [key,count] of counts)if(count===1)labels.set(key,uniqueKey(key,usedLabels));
  for(const [key,count] of noteCounts)if(count===1)notes.set(key,uniqueKey(key,usedNotes));
  for(const [key,count] of metadataCounts)if(count===1)metadata.set(key,freshId());
  visit(all,node=>{
    if(typeof node.type==='string')node.id=node.type==='metadata_entry'?(metadata.get(node.id)??freshId()):freshId();
    if(typeof node.texLabel==='string'&&labels.has(node.texLabel))node.texLabel=labels.get(node.texLabel);
    if(node.type==='tex_reference'&&['ref','eqref'].includes(node.command))node.keys=node.keys.map((key:string)=>labels.get(key)??key);
    for(const field of ['affiliationIds','noteIds','authorIds'])if(Array.isArray(node[field]))node[field]=node[field].map((id:string)=>metadata.get(id)??id);
    if(['footnoteDefinition','footnoteReference'].includes(node.type)&&notes.has(node.identifier))node.identifier=notes.get(node.identifier);
  });
  checked.bibliographyLibraries=mergeClipboardLibraries(checked,existingValue,options.existingLibraries??[]);
  return checked;
}

function rawLibrary(library:BibLibrary){
  return parseVerbatim(library.source,{strings:{SEPT:'09'}});
}
const dependencyFields=['crossref','xref','xdata','entryset','related'];
const signature=(entry:VerbatimEntry)=>JSON.stringify([entry.type.toLowerCase(),Object.entries(entry.fields).sort(([a],[b])=>a.localeCompare(b))]);
function semanticSignature(entry:VerbatimEntry,records:Map<string,VerbatimEntry>,seen=new Set<string>()):string {
  if(seen.has(entry.key))return 'cycle:'+entry.key;
  const next=new Set(seen);next.add(entry.key);
  return JSON.stringify([signature(entry),dependencyFields.flatMap(field=>(entry.fields[field]??'').split(',').map(key=>key.trim()).filter(Boolean).map(key=>{
    const dependency=records.get(key);return [key,dependency?semanticSignature(dependency,records,next):null];
  }))]);
}

/** Return only added libraries. Existing sources and entries are never overwritten. */
function mergeClipboardLibraries(fragment:NativeDocumentFragment,existingValue:Value,existing:readonly BibLibrary[]):BibLibrary[] {
  const incoming=fragment.bibliographyLibraries??[];if(!incoming.length)return [];
  const currentEntries=parseBibLibraries(existing),incomingEntries=parseBibLibraries(incoming);
  const usedKeys=new Set<string>(),existingRecords=new Map<string,VerbatimEntry>();
  visit(existingValue,node=>{if(node.type==='bibliography_entry'&&typeof node.citeKey==='string')usedKeys.add(node.citeKey);});
  const existingKeys=new Set(currentEntries.map(entry=>entry.key));for(const key of existingKeys)usedKeys.add(key);
  for(const library of existing)for(const entry of rawLibrary(library).entries){usedKeys.add(entry.key);existingRecords.set(entry.key,entry);}
  const raws=incoming.map(library=>({library,raw:rawLibrary(library)})),renames=new Map<string,string>(),skip=new Set<string>();
  const incomingRecords=new Map(raws.flatMap(({raw})=>raw.entries.map(entry=>[entry.key,entry] as const)));
  // Reserve all incoming names first, so a collision suffix cannot steal another record's real key.
  for(const entry of incomingEntries)usedKeys.add(entry.key);
  if(raws.some(({raw})=>raw.errors.length)&&incomingEntries.some(entry=>existingKeys.has(entry.key)||hasManualEntry(existingValue,entry.key)))
    throw Error('Cannot safely merge this clipboard bibliography.');
  for(const {raw} of raws)for(const entry of raw.entries){
    const previous=existingRecords.get(entry.key);
    if(previous&&semanticSignature(previous,existingRecords)===semanticSignature(entry,incomingRecords)){skip.add(entry.key);continue;}
    if(existingKeys.has(entry.key)||hasManualEntry(existingValue,entry.key))renames.set(entry.key,uniqueKey(entry.key,usedKeys));
  }
  // Cross-library @string definitions share a BibTeX namespace. If adding sources
  // would redefine one, expand incoming fields with the parser before merging.
  const strings=new Map<string,string>();
  for(const library of existing)for(const [name,value] of Object.entries(rawLibrary(library).strings))strings.set(name.toLowerCase(),value);
  const conflictingStrings=raws.some(({raw})=>Object.entries(raw.strings).some(([name,value])=>strings.has(name.toLowerCase())&&strings.get(name.toLowerCase())!==value));
  const usedIds=new Set(existing.map(library=>library.id)),added:BibLibrary[]=[];
  for(const {library,raw} of raws){
    const kept=raw.entries.filter(entry=>!skip.has(entry.key));
    if(!incomingEntries.some(entry=>entry.libraryId===library.id&&!skip.has(entry.key)))continue;
    // Preambles may define global TeX macros used by either bibliography.
    // There is no generally safe namespace rewrite for arbitrary TeX here.
    if(existing.length&&raw.preambles.length)throw Error('Cannot safely merge a clipboard bibliography with a TeX preamble.');
    const rebuild=conflictingStrings||renames.size>0||kept.length!==raw.entries.length;
    let source=library.source;
    if(rebuild){
      // Recoverable parser warnings can travel unchanged, but not be silently
      // normalized while resolving a citation or macro namespace collision.
      if(raw.errors.length)throw Error('Cannot safely merge this clipboard bibliography.');
      const entries=kept.map(entry=>{
        const fields=Object.entries(entry.fields).map(([name,value])=>{
          if(dependencyFields.includes(name.toLowerCase()))value=value.split(',').map(key=>renames.get(key.trim())??key.trim()).join(', ');
          return '  '+name+' = {'+value+'}';
        });
        return '@'+entry.type+'{'+(renames.get(entry.key)??entry.key)+',\n'+fields.join(',\n')+'\n}';
      });
      const preambles=raw.preambles.map(expression=>{
        const probe=parseVerbatim('@misc{clipboard_probe,value='+expression+'}',{strings:raw.strings});
        const expanded=probe.entries[0]?.fields.value;if(probe.errors.length||expanded===undefined)throw Error('Cannot safely merge this clipboard bibliography.');
        return '@preamble{{'+expanded+'}}';
      });
      source=[...preambles,...entries].join('\n\n')+'\n';
      // Verify serialization kept every raw field and dependency exactly.
      const verified=rawLibrary({...library,source});
      if(verified.errors.length||verified.entries.length!==kept.length||verified.entries.some((entry,index)=>{
        const original=kept[index],expected={...original,key:renames.get(original.key)??original.key,fields:{...original.fields}};
        for(const name of Object.keys(expected.fields))if(dependencyFields.includes(name.toLowerCase()))expected.fields[name]=expected.fields[name].split(',').map(key=>renames.get(key.trim())??key.trim()).join(', ');
        return entry.key!==expected.key||signature(entry)!==signature(expected);
      }))throw Error('Cannot safely merge this clipboard bibliography.');
    }
    let id=library.id;if(usedIds.has(id))id=freshId();usedIds.add(id);
    added.push({...library,id,source});
  }
  const all=[...fragment.value,...fragment.endnoteDefinitions??[]];
  visit(all,node=>{if(node.type==='tex_reference'&&node.command==='cite')node.keys=node.keys.map((key:string)=>renames.get(key)??key);});
  parseBibLibraries([...existing,...added]);return added;
}
function hasManualEntry(value:Value,key:string):boolean {
  let found=false;visit(value,node=>{if(node.type==='bibliography_entry'&&node.citeKey===key)found=true;});return found;
}
