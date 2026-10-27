import type {Creator,Entry} from '@retorquere/bibtex-parser';

/** A display projection; the original BibTeX remains the persisted source. */
export interface CSLName {
  family?:string;given?:string;literal?:string;suffix?:string;
  'non-dropping-particle'?:string;
  'comma-suffix'?:boolean;
}
export interface CSLDate { 'date-parts'?:number[][];literal?:string; }
export interface CSLItem {
  id:string;type:string;title:string;
  author?:CSLName[];editor?:CSLName[];translator?:CSLName[];
  issued?:CSLDate;accessed?:CSLDate;'original-date'?:CSLDate;'event-date'?:CSLDate;
  [field:string]:string|CSLName[]|CSLDate|undefined;
}

const types:Record<string,string>={
  article:'article-journal',book:'book',booklet:'pamphlet',collection:'book',
  proceedings:'book',mvbook:'book',mvcollection:'book',mvproceedings:'book',
  inbook:'chapter',incollection:'chapter',suppbook:'chapter',suppcollection:'chapter',
  inproceedings:'paper-conference',conference:'paper-conference',
  online:'webpage',electronic:'webpage',www:'webpage',
  phdthesis:'thesis',mastersthesis:'thesis',thesis:'thesis',
  techreport:'report',report:'report',manual:'book',unpublished:'manuscript',
  patent:'patent',standard:'standard',dataset:'dataset',software:'software',
  periodical:'periodical',movie:'motion_picture',video:'motion_picture',
  misc:'article',reference:'book',inreference:'entry-encyclopedia',
};

/** The normalized parser exposes rich text as HTML; metadata is plain CSL data. */
function text(value:unknown):string {
  if(Array.isArray(value))return value.map(text).filter(Boolean).join('; ');
  if(typeof value!=='string')return '';
  return value.replace(/<\/?(?:p|br|div|li|h[1-6]|blockquote|ul|ol)\b[^<>]*>/gi,' ')
    .replace(/<\/?(?:a|b|i|em|strong|u|s|sup|sub|span|code|tt|sc)\b[^<>]*>/gi,'')
    .replace(/\s+/gu,' ').trim().normalize('NFC');
}

function names(value:unknown):CSLName[]|undefined {
  if(!Array.isArray(value)){const literal=text(value);return literal?[{literal}]:undefined;}
  const result=(value as Creator[]).map(name=>{
    if(name.name)return {literal:text(name.name)};
    const result:CSLName={};
    if(name.lastName)result.family=text(name.lastName);
    if(name.firstName)result.given=text(name.firstName);
    if(name.prefix)result['non-dropping-particle']=text(name.prefix);
    if(name.suffix)result.suffix=text(name.suffix);
    if(name.juniorcomma)result['comma-suffix']=true;
    return result;
  }).filter(name=>name.literal||name.family||name.given);
  return result.length?result:undefined;
}

const monthNumbers:Record<string,number>={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
function date(value:unknown,month?:unknown,day?:unknown):CSLDate|undefined {
  const literal=text(value);
  if(!literal)return;
  const parts=literal.split('/').map(part=>part.match(/^(-?\d{1,6})(?:-(\d{2})(?:-(\d{2}))?)?$/));
  if(parts.every(Boolean)){
    const dates=parts.map(part=>part!.slice(1).filter(Boolean).map(Number));
    if(dates.length===1&&dates[0].length===1){
      const monthText=text(month).toLowerCase(),monthNumber=Number(monthText)||monthNumbers[monthText.slice(0,3)];
      if(monthNumber>=1&&monthNumber<=12){
        dates[0].push(monthNumber);
        const dayNumber=Number(text(day));if(dayNumber>=1&&dayNumber<=31)dates[0].push(dayNumber);
      }
    }
    if(dates.every(parts=>(parts[1]===undefined||parts[1]>=1&&parts[1]<=12)&&(parts[2]===undefined||parts[2]>=1&&parts[2]<=31)))return {'date-parts':dates};
  }
  return {literal};
}

const languages:Record<string,string>={english:'en',american:'en-US',usenglish:'en-US',british:'en-GB',ukenglish:'en-GB',chinese:'zh-CN',zh:'zh-CN',german:'de-DE',ngerman:'de-DE',french:'fr-FR',japanese:'ja-JP'};

/** Convert structured parser names/fields without reparsing author strings. */
export function bibEntryToCSL(entry:Entry):CSLItem {
  const f=entry.fields;
  const first=(...fields:string[])=>fields.map(key=>text(f[key])).find(Boolean)||'';
  const item:CSLItem={id:entry.key,type:types[entry.type.toLowerCase()]||'article',title:first('title','booktitle')||entry.key};
  const put=(key:string,value:string|CSLDate|CSLName[]|undefined)=>{if(value&&(!Array.isArray(value)||value.length))item[key]=value;};
  put('author',names(f.author));put('editor',names(f.editor));put('translator',names(f.translator));
  put('issued',date(first('date','year'),f.month,f.day));
  put('accessed',date(f.urldate));put('original-date',date(first('origdate','origyear')));put('event-date',date(f.eventdate));
  put('container-title',first('journaltitle','journal','booktitle'));
  put('container-title-short',first('shortjournal','journalabbr','shortjournaltitle'));
  put('title-short',first('shorttitle'));
  put('publisher',first('publisher','institution','school','organization'));
  put('publisher-place',first('location','address'));put('original-publisher',first('origpublisher'));put('original-publisher-place',first('origlocation'));
  put('volume',first('volume'));put('issue',first('issue')||(item.type==='article-journal'?first('number'):''));
  put('number',item.type==='article-journal'?'':first('number'));
  put('number-of-volumes',first('volumes'));put('edition',first('edition'));
  put('page',first('pages').replace(/--/g,'–'));put('number-of-pages',first('pagetotal','numpages'));put('chapter-number',first('chapter'));
  put('collection-title',first('series'));put('collection-number',first('seriesnumber'));
  put('event-title',first('eventtitle','conference'));put('event-place',first('venue'));
  put('DOI',first('doi').replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,''));
  put('URL',first('url')||(first('eprinttype','archiveprefix').toLowerCase()==='arxiv'&&first('eprint')?'https://arxiv.org/abs/'+first('eprint'):''));
  put('ISBN',first('isbn'));put('ISSN',first('issn'));put('note',first('note'));put('abstract',first('abstract'));
  const language=first('langid','language');put('language',languages[language.toLowerCase()]||language);
  put('genre',first('type')||(entry.type==='phdthesis'?'PhD dissertation':entry.type==='mastersthesis'?"Master’s thesis":''));
  put('status',first('pubstate'));
  return item;
}
