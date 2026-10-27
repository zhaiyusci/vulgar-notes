import citeproc from 'citeproc';
import type {CSLItem} from './bibtex-csl';
import {cslLocales,cslStyles} from './csl/assets';
import {isBibliographyStyle,type BibliographyStyle,type BibliographyRun,type FormattedBibliographyEntry} from './bibliography-style';
export {bibliographyStyles,isBibliographyStyle} from './bibliography-style';
export type {BibliographyStyle,BibliographyRun,FormattedBibliographyEntry} from './bibliography-style';

export interface BibliographyFormatInput {key:string;csl?:CSLItem;description?:string}
const cache:{signature:string;result:Map<string,FormattedBibliographyEntry>}[]=[];

const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',thinsp:' ',ensp:' ',emsp:' ',ndash:'–',mdash:'—',hellip:'…'};
function decode(text:string):string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(entity,key:string)=>{
    if(key[0]!=='#')return entities[key]??entity;
    const number=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
    return number>0&&number<=0x10ffff&&!(number>=0xd800&&number<=0xdfff)?String.fromCodePoint(number):'�';
  });
}
function escape(text:string):string {return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
type Marks=Omit<BibliographyRun,'text'>;
const markKeys=['italic','bold','superscript','subscript','smallCaps'] as const;

/**
 * Reduce processor HTML to a fixed set of text marks, without a DOM or HTML
 * execution. CSL numeric margins are omitted: the host owns unified numbering.
 * No source attributes, URLs, arbitrary CSS or executable markup escape here.
 */
function runsFromProcessorHTML(html:string,omitSuperscriptLabel=false):BibliographyRun[] {
  const runs:BibliographyRun[]=[],stack:{tag:string;marks:Marks;hidden:boolean}[]=[];
  const state=()=>stack[stack.length-1]??{marks:{},hidden:false};
  const append=(value:string)=>{
    if(state().hidden)return;
    const text=decode(value).replace(/\s+/gu,' ');if(!text)return;
    const marks=Object.fromEntries(markKeys.filter(key=>state().marks[key]).map(key=>[key,true])) as Marks;
    const previous=runs[runs.length-1];
    if(previous&&markKeys.every(key=>previous[key]===marks[key]))previous.text+=text;
    else runs.push({text,...marks});
  };
  const tags=/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi;
  let offset=0,match:RegExpExecArray|null;
  while((match=tags.exec(html))){
    append(html.slice(offset,match.index));offset=tags.lastIndex;
    if(match[0].startsWith('<!--'))continue;
    const tag=match[0].match(/^<\/?([a-z][\w-]*)/i)![1].toLowerCase();
    if(/^<\//.test(match[0])){
      const index=stack.map(item=>item.tag).lastIndexOf(tag);if(index>=0)stack.splice(index);
      continue;
    }
    const marks={...state().marks};
    if(tag==='i'||tag==='em')marks.italic=true;
    if(tag==='b'||tag==='strong')marks.bold=true;
    if(tag==='sup'){marks.superscript=true;marks.subscript=false;}
    if(tag==='sub'){marks.subscript=true;marks.superscript=false;}
    const style=match[0].match(/\bstyle\s*=\s*["']([^"']*)["']/i)?.[1]||'';
    if(/font-style\s*:\s*italic/i.test(style))marks.italic=true;
    if(/font-style\s*:\s*normal/i.test(style))marks.italic=false;
    if(/font-weight\s*:\s*(?:bold|[7-9]00)/i.test(style))marks.bold=true;
    if(/font-weight\s*:\s*(?:normal|400)/i.test(style))marks.bold=false;
    if(/font-variant\s*:\s*small-caps/i.test(style))marks.smallCaps=true;
    if(/font-variant\s*:\s*normal/i.test(style))marks.smallCaps=false;
    const classes=match[0].match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1].split(/\s+/)||[];
    if(tag==='br')append(' ');
    else if(!/\/$/.test(match[0].slice(0,-1))&&!['img','hr','input','meta','link'].includes(tag))stack.push({tag,marks,hidden:state().hidden||classes.includes('csl-left-margin')});
  }
  append(html.slice(offset));
  while(runs.length&&!runs[0].text.trim())runs.shift();
  // AIP puts its processor-generated numeric label in a leading superscript,
  // rather than a separate csl-left-margin. The host supplies that label.
  if(omitSuperscriptLabel&&runs[0]?.superscript&&/^\d+$/.test(runs[0].text.trim()))runs.shift();
  if(runs.length){runs[0].text=runs[0].text.trimStart();runs[runs.length-1].text=runs[runs.length-1].text.trimEnd();}
  return runs.filter(run=>run.text);
}

function formatted(runs:BibliographyRun[]):FormattedBibliographyEntry {
  const html=runs.map(run=>{
    let text=escape(run.text);
    if(run.italic)text='<i>'+text+'</i>';
    if(run.bold)text='<b>'+text+'</b>';
    if(run.superscript)text='<sup>'+text+'</sup>';
    if(run.subscript)text='<sub>'+text+'</sub>';
    if(run.smallCaps)text='<span style="font-variant:small-caps">'+text+'</span>';
    return text;
  }).join('');
  return {html,text:runs.map(run=>run.text).join(''),runs};
}

/**
 * Format reference-list bodies using bundled official CSL styles/locales.
 * The returned map follows input order; the document host keeps all citation
 * and endnote numbers and list ordering. This does not render inline citations.
 */
export function formatBibliography(entries:readonly BibliographyFormatInput[],style:BibliographyStyle='simple'):Map<string,FormattedBibliographyEntry> {
  if(!isBibliographyStyle(style))throw Error('Unknown reference-list format');
  const signature=JSON.stringify([style,entries.map(entry=>[entry.key,entry.csl,entry.description])]);
  const previous=cache.find(item=>item.signature===signature);if(previous)return previous.result;
  const result=new Map<string,FormattedBibliographyEntry>();
  const inputs=entries.filter(entry=>entry.csl);
  const outputs=new Map<string,FormattedBibliographyEntry>();
  if(style!=='simple'&&inputs.length){
    const items=new Map(inputs.map(entry=>[entry.key,JSON.parse(JSON.stringify({...entry.csl,id:entry.key})) as CSLItem]));
    const xml=style==='gbt7714-2025'?cslStyles.gbt7714:cslStyles[style];
    const processor=new citeproc.Engine({
      retrieveLocale:language=>cslLocales[language as keyof typeof cslLocales]||(language==='en'?cslLocales['en-US']:language==='zh'?cslLocales['zh-CN']:false),
      retrieveItem:key=>items.get(key)!,
    },xml,style==='gbt7714-2025'?'zh-CN':'en-US');
    processor.setOutputFormat('html');processor.updateItems([...items.keys()]);
    const bibliography=processor.makeBibliography();
    if(bibliography)bibliography[1].forEach((html,index)=>{
      const entry=formatted(runsFromProcessorHTML(html,style==='aip'));
      for(const key of bibliography[0].entry_ids[index]||[])outputs.set(String(key),entry);
    });
  }
  for(const entry of entries){
    result.set(entry.key,outputs.get(entry.key)||formatted([{text:entry.description||entry.csl?.title||entry.key}]));
  }
  cache.push({signature,result});if(cache.length>16)cache.shift();
  return result;
}
