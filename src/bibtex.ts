import {parse, parseVerbatim, type Creator, type Entry, type VerbatimEntry, type VerbatimLibrary} from '@retorquere/bibtex-parser';
import {bibEntryToCSL,type CSLItem} from './bibtex-csl';

/** The original BibTeX is the document data; parsed fields are only a view. */
export interface BibLibrary {id:string;name:string;source:string}
export interface BibEntry {
  key:string;
  type:string;
  title:string;
  author:string;
  year:string;
  description:string;
  csl?:CSLItem;
  libraryId:string;
  libraryName:string;
  doi?:string;
  url?:string;
}

const citationKeyPattern=/^[\p{L}\p{N}][\p{L}\p{N}\p{M}:._/+\-'‘’]*$/u;
export const validCitationKey=(key:unknown):key is string=>typeof key==='string'&&citationKeyPattern.test(key);

type CachedLibrary=BibLibrary&{entries:BibEntry[];verbatim?:VerbatimLibrary;warnings:readonly string[]};
// Keep source variants: validating a cited-only snapshot must not evict the
// attached full library and force a reparse on the next document edit.
const cache:CachedLibrary[]=[];
const libraryListCache=new WeakMap<readonly BibLibrary[],{snapshot:BibLibrary[];entries:BibEntry[]}>();
const librarySetCache:{snapshot:BibLibrary[];entries:BibEntry[]}[]=[];
const extractionCache:{snapshot:BibLibrary[];keySignature:string;result:BibLibrary[]}[]=[];

function sameLibraries(a:readonly BibLibrary[],b:readonly BibLibrary[]):boolean {
  return a.length===b.length&&a.every((old,index)=>{
    const current=b[index];
    return current&&old.id===current.id&&old.name===current.name&&old.source===current.source;
  });
}

function cachedLibrary(library:BibLibrary):CachedLibrary|undefined {
  return cache.find(item=>item.id===library.id&&item.name===library.name&&item.source===library.source);
}

function libraryShape(value:unknown):BibLibrary {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid BibTeX library');
  const library=value as Partial<BibLibrary>;
  if(typeof library.id!=='string'||!library.id.trim()||typeof library.name!=='string'||!library.name.trim()||typeof library.source!=='string')throw Error('Invalid BibTeX library');
  return {id:library.id,name:library.name,source:library.source};
}

/** Strip markup produced by the parser. Consumers must still render as text. */
function plain(value:unknown):string {
  if(typeof value!=='string')return '';
  return value
    .replace(/<\/?(?:p|br|div|li|h[1-6]|blockquote|ul|ol)\b[^<>]*>/gi,' ')
    .replace(/<\/?(?:a|b|i|em|strong|u|s|sup|sub|span|code|tt|sc)\b[^<>]*>/gi,'')
    .replace(/\s+/gu,' ').trim().normalize('NFC');
}

function creators(value:unknown):string {
  if(!Array.isArray(value))return plain(value);
  return (value as Creator[]).map(creator=>creator.name?plain(creator.name):[
    creator.firstName,creator.prefix,creator.lastName,creator.suffix,
  ].map(plain).filter(Boolean).join(' ')).filter(Boolean).join('; ');
}

function displayEntry(entry:Entry,library:BibLibrary):BibEntry {
  const fields=entry.fields;
  const title=plain(fields.title)||plain(fields.booktitle)||entry.key;
  const author=creators(fields.author)||creators(fields.editor);
  const year=plain(fields.year)||plain(fields.date).match(/^-?\d{4}/)?.[0]||'';
  const publication=plain(fields.journal)||plain(fields.journaltitle)||plain(fields.booktitle)
    ||(Array.isArray(fields.publisher)?fields.publisher.map(plain).join('; '):plain(fields.publisher));
  return {
    key:entry.key,type:entry.type,title,author,year,
    description:[author,title,publication,year].filter(Boolean).join('. '),csl:bibEntryToCSL(entry),
    libraryId:library.id,libraryName:library.name,
    ...(fields.doi?{doi:plain(fields.doi)}:{}),
    ...(fields.url?{url:plain(fields.url)}:{}),
  };
}

// Common .bib exporters spell September "sept", while the upstream scanner
// knows only "sep". Explicit @string declarations still take precedence.
const defaultStrings={SEPT:'09'};

function scannerInput(source:string):{source:string;restore:(value:string)=>string} {
  // Upstream accepts Unicode letters in keys but rejects typographic
  // apostrophes that Biber accepts. Transport them through unused letter
  // sentinels; restore every parsed value/input before exposing any data.
  // This does not rewrite the library or reinterpret its grammar.
  const substitutions:[string,string][]=[];
  let input=source,next=0x3400;
  for(const [original,preferred] of [['‘','ʻ'],['’','ʼ']]){
    if(!source.includes(original))continue;
    let sentinel=preferred;
    while(source.includes(sentinel)||substitutions.some(([,used])=>used===sentinel))sentinel=String.fromCharCode(next++);
    substitutions.push([original,sentinel]);input=input.replaceAll(original,sentinel);
  }
  return {source:input,restore:value=>{
    for(const [original,sentinel] of substitutions)value=value.replaceAll(sentinel,original);
    return value;
  }};
}

function restoreFields<T>(value:T,restore:(value:string)=>string):T {
  if(typeof value==='string')return restore(value) as T;
  if(Array.isArray(value))return value.map(item=>restoreFields(item,restore)) as T;
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[restore(key),restoreFields(item,restore)])) as T;
  return value;
}

function verbatimSource(source:string,name:string):VerbatimLibrary {
  const scanner=scannerInput(source),raw=parseVerbatim(scanner.source,{strings:defaultStrings});
  raw.entries=restoreFields(raw.entries,scanner.restore);
  raw.strings={...defaultStrings,...restoreFields(raw.strings,scanner.restore)};
  raw.preambles=restoreFields(raw.preambles,scanner.restore);
  raw.errors=restoreFields(raw.errors,scanner.restore);
  // Like BibTeX/Biber, an unresolved abbreviation is a recoverable warning;
  // the scanner retains its literal value. Malformed grammar is still fatal.
  const diagnostic=raw.errors.find(error=>!error.error.startsWith('unresolved @string reference '));
  if(diagnostic)throw Error(`Invalid BibTeX in ${JSON.stringify(name)}: ${diagnostic.error}`);
  return raw;
}

function normalizeEntries(source:string,name:string,raw=verbatimSource(source,name)):Entry[] {
  const scanner=scannerInput(source);
  let normalized:Entry[]=[];
  try{
    normalized=restoreFields(parse(scanner.source,{english:false,caseProtection:false,applyCrossRef:true,strings:defaultStrings}).entries,scanner.restore);
  }catch{
    // Bibliographic fields remain usable even when optional LaTeX-to-text
    // normalization cannot interpret a publisher's custom formatting.
  }
  const byKey=new Map(normalized.map(entry=>[entry.key,entry]));
  return raw.entries.map(entry=>byKey.get(entry.key)||{...entry,fields:entry.fields as Entry['fields'],mode:{}});
}

export function parseBibLibrary(value:BibLibrary):BibEntry[] {
  const library=libraryShape(value),cached=cachedLibrary(library);
  if(cached)return cached.entries;

  // Use the Better BibTeX parser for the grammar, strings, names and inheritance.
  // Raw grammar validates the import; normalized fields are display metadata.
  // Unsupported formatting cannot drop an otherwise valid bibliography entry.
  const verbatim=verbatimSource(library.source,library.name);
  const normalized=normalizeEntries(library.source,library.name,verbatim);
  const keys=new Set<string>();
  const entries=normalized.map(entry=>{
    if(!validCitationKey(entry.key))throw Error(`Invalid citation key ${JSON.stringify(entry.key)} in ${JSON.stringify(library.name)}`);
    if(keys.has(entry.key))throw Error(`Duplicate citation key ${JSON.stringify(entry.key)} in ${JSON.stringify(library.name)}`);
    keys.add(entry.key);
    return displayEntry(entry,library);
  });
  // Keep a bounded cache of parsed libraries, without retaining every edit to a
  // raw source. Unchanged libraries are reused across document render passes.
  cache.push({...library,entries,verbatim,warnings:verbatim.errors.map(error=>error.error)});
  if(cache.length>32)cache.shift();
  return entries;
}

/** Recoverable source diagnostics, separate from optional display formatting. */
export function bibLibraryWarnings(value:BibLibrary):readonly string[] {
  parseBibLibrary(value);
  return cachedLibrary(value)!.warnings;
}

export function parseBibLibraries(libraries:readonly BibLibrary[]):BibEntry[] {
  if(!Array.isArray(libraries))throw Error('Invalid BibTeX libraries');
  const cached=libraryListCache.get(libraries);
  if(cached&&sameLibraries(cached.snapshot,libraries))return cached.entries;
  const equivalent=librarySetCache.find(item=>sameLibraries(item.snapshot,libraries));
  if(equivalent){libraryListCache.set(libraries,equivalent);return equivalent.entries;}
  const ids=new Set<string>(),keys=new Map<string,string>(),snapshot:BibLibrary[]=[],entries:BibEntry[]=[];
  for(const value of libraries){
    const library=libraryShape(value);
    if(ids.has(library.id))throw Error(`Duplicate BibTeX library id ${JSON.stringify(library.id)}`);
    ids.add(library.id);snapshot.push(library);
    for(const entry of parseBibLibrary(library)){
      const previous=keys.get(entry.key);
      if(previous!==undefined)throw Error(`Duplicate citation key ${JSON.stringify(entry.key)} in ${JSON.stringify(previous)} and ${JSON.stringify(library.name)}`);
      keys.set(entry.key,library.name);entries.push(entry);
    }
  }
  // A crossref parent may be attached in a different .bib file. Parse their
  // common context once so the upstream inheritance rules also see that parent.
  if(libraries.length>1){
    const byId=new Map(libraries.map(library=>[library.id,library]));
    const owners=new Map(entries.map(entry=>[entry.key,byId.get(entry.libraryId)!]));
    const combined=normalizeEntries(libraries.map(library=>library.source).join('\n\n'),libraries.map(library=>library.name).join(', '));
    entries.splice(0,entries.length,...combined.map(entry=>displayEntry(entry,owners.get(entry.key)!)));
  }
  const result={snapshot,entries};
  libraryListCache.set(libraries,result);librarySetCache.push(result);
  if(librarySetCache.length>16)librarySetCache.shift();
  return entries;
}

/** Validate persisted data before changing the open document. */
export function validateBibLibraries(value:unknown):BibLibrary[] {
  if(value===undefined)return [];
  if(!Array.isArray(value))throw Error('Invalid BibTeX libraries');
  const libraries=value.map(libraryShape);
  parseBibLibraries(libraries);
  return libraries;
}

function rawLibrary(library:BibLibrary):VerbatimLibrary {
  parseBibLibrary(library);
  const cached=cachedLibrary(library)!;
  return cached.verbatim??=(verbatimSource(library.source,library.name));
}

/** Expanded grammar values retain raw TeX; no display/CSL normalization occurs. */
export interface CitedBibRecord {
  key:string;
  type:string;
  fields:Record<string,string>;
  preambles:string[];
  libraryId:string;
  libraryName:string;
}
/** Cited-only records suitable for independent transport without @string clashes. */
export function citedBibRecords(libraries:readonly BibLibrary[],keys:readonly string[]):CitedBibRecord[] {
  const result:CitedBibRecord[]=[];
  for(const library of citedBibLibraries(libraries,keys)){
    const raw=rawLibrary(library);
    const preambles=raw.preambles.map(preamble=>{
      const scanner=scannerInput(`@misc{VN_PREAMBLE_PROBE,value=${preamble}}`);
      const expanded=restoreFields(parseVerbatim(scanner.source,{strings:raw.strings}),scanner.restore);
      const error=expanded.errors.find(item=>!item.error.startsWith('unresolved @string reference '));
      const value=expanded.entries[0]?.fields.value;
      if(error||typeof value!=='string')throw Error('Invalid BibTeX preamble in '+JSON.stringify(library.name));
      return value;
    });
    for(const entry of raw.entries)result.push({key:entry.key,type:entry.type,
      fields:Object.fromEntries(Object.entries(entry.fields).sort(([a],[b])=>a<b?-1:a>b?1:0)),
      preambles:[...preambles],libraryId:library.id,libraryName:library.name});
  }
  return result;
}

/**
 * Runtime libraries retain the full attached sources for the citation picker.
 * Native document snapshots contain only cited raw records, their crossref/
 * xdata parents, and the declarations needed to interpret those records.
 * Missing citation keys stay unresolved without copying unrelated records.
 */
export function citedBibLibraries(libraries:readonly BibLibrary[],keys:readonly string[]):BibLibrary[] {
  const keySignature=JSON.stringify([...new Set(keys.filter(validCitationKey))].sort());
  const cached=extractionCache.find(item=>item.keySignature===keySignature&&sameLibraries(item.snapshot,libraries));
  if(cached)return cached.result;
  parseBibLibraries(libraries);

  type RawRecord={entry:VerbatimEntry;library:BibLibrary;raw:VerbatimLibrary};
  const records=new Map<string,RawRecord>(),selected=new Set<string>();
  const perLibrary=new Map<string,{library:BibLibrary;raw:VerbatimLibrary;entries:VerbatimEntry[]}>();
  for(const library of libraries){
    const raw=rawLibrary(library);
    perLibrary.set(library.id,{library,raw,entries:[]});
    for(const entry of raw.entries)records.set(entry.key,{entry,library,raw});
  }
  const include=(key:string)=>{
    if(selected.has(key))return;
    const record=records.get(key);
    if(!record)return;
    selected.add(key);
    for(const dependency of [record.entry.fields.crossref,record.entry.fields.xdata]){
      if(typeof dependency==='string')for(const parent of dependency.split(',').map(value=>value.trim()).filter(Boolean))include(parent);
    }
  };
  keys.forEach(include);
  // Preserve source order, independently of the order in which citations occur.
  for(const [key,{entry,library}] of records)if(selected.has(key))perLibrary.get(library.id)!.entries.push(entry);

  const result:BibLibrary[]=[];
  for(const {library,raw,entries} of perLibrary.values()){
    if(!entries.length)continue;
    const names=Object.keys(raw.strings),sentinels:Record<string,string>={};
    const marker='VN_BIB_STRING_'+names.length+'_';
    names.forEach((name,index)=>{sentinels[name]=`${marker}${index}_END`;});
    const used=new Set<string>();
    const expressions=[...entries.map(entry=>entry.input),...raw.preambles.map(preamble=>`@misc{VN_PREAMBLE_PROBE,value=${preamble}}`)];
    for(const expression of expressions){
      // Let the established scanner resolve bare string tokens. Braced/quoted
      // mentions of the same word must not be mistaken for macro references.
      const probeInput=scannerInput(expression);
      const probe=parseVerbatim(probeInput.source,{strings:sentinels});
      for(const value of Object.values(probe.entries[0]?.fields||{})){
        names.forEach((name,index)=>{if(value.includes(`${marker}${index}_END`))used.add(name);});
      }
    }
    const declarations=names.filter(name=>used.has(name)).map(name=>`@string{${name}={${raw.strings[name]}}}`);
    const preambles=raw.preambles.map(preamble=>`@preamble{${preamble}}`);
    result.push({id:library.id,name:library.name,source:[...declarations,...preambles,...entries.map(entry=>entry.input)].join('\n\n')+'\n'});
  }
  extractionCache.push({snapshot:libraries.map(library=>({...library})),keySignature,result});
  if(extractionCache.length>16)extractionCache.shift();
  return result;
}
