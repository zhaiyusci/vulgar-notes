// SPDX-License-Identifier: GPL-3.0-or-later
// Reproduce the small integration fixes applied to the supplied, pinned bundle.
// This does not run the bundle. The original archive and its build sources are
// distinct from this patch; see licenses/bib-library/NOTICE.md.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const acorn=require('acorn');
const upstreamSHA256='e6611e6e5e88d39fb6c32a75c3f12e46ff92f2bd596657986aa1df5397b92f9c';
function integrate(source){
  if(crypto.createHash('sha256').update(source).digest('hex')!==upstreamSHA256)throw Error('Unexpected bib-library bundle; review the new upstream code before updating this patch.');
  const once=(from,to)=>{if(source.split(from).length!==2)throw Error('Integration marker is not unique: '+from.slice(0,80));source=source.replace(from,to);};
  const fn=(from,next,replacement)=>{const start=source.indexOf('function '+from+'('),end=source.indexOf('function '+next+'(',start);if(start<0||end<start)throw Error('Missing function boundary '+from);source=source.slice(0,start)+replacement+source.slice(end);};
  fn('XQ','ZQ',String.raw`function XQ(e,t){
    const n={...(t??{}),id:t?.id??""},old=t?ZQ(t):null;
    if(!old||(e.type&&e.type!==old.type))n.type=e.type||"misc";
    const field=(name,key,value=e[key])=>{if(old&&e[key]===old[key])return;const v=nv(value);if(v===void 0)delete n[name];else n[name]=v};
    field("title","title");field("container-title","container");field("volume","volume");field("issue","issue");field("page","pages",e.pages.replace(/--/g,"-"));field("publisher","publisher");field("DOI","doi");field("URL","url");field("abstract","abstract");
    if(!old||e.authors!==old.authors){const authors=Qv(e.authors);if(authors.length)n.author=authors.map(a=>({family:a.family,given:a.given??void 0}));else delete n.author}
    if(!old||e.year!==old.year){const year=nv(e.year);if(year&&/^\d{4}$/.test(year))n.issued={"date-parts":[[Number(year)]]};else if(year)n.issued={raw:year};else delete n.issued}
    return n;
  }`);
  fn('UQ','qQ',String.raw`function UQ(e,t){
    const input=e.trim(),valid=/^[\p{L}\p{N}][\p{L}\p{N}\p{M}:._/+\-'‘’]*$/u;
    const n=valid.test(input)?input:input.replace(/\s+/g,"-").replace(/[^\p{L}\p{N}\p{M}:._/+\-'‘’]/gu,"").replace(/^[^\p{L}\p{N}]+/u,"")||"item";
    if(!t.has(n))return n;let i=2;while(t.has(n+"-"+i))i++;return n+"-"+i;
  }`);
  const exportStart=source.indexOf('function Gi('),exportEnd=source.indexOf('var Ic=',exportStart);
  if(exportStart<0||exportEnd<exportStart)throw Error('Missing BibTeX exporter boundary');
  source=source.slice(0,exportStart)+String.raw`function Gi(items){
    if(!items.length)return "";
    return items.map(item=>{
      const record=k6(item),csl={...(record?item.csl:item)},tags=record?item.tags:[],key=csl.id;
      if(typeof key!=="string"||!/^[\p{L}\p{N}][\p{L}\p{N}\p{M}:._/+\-'‘’]*$/u.test(key))throw Error("引用键格式无效："+String(key));
      if(record)delete csl.keyword;
      let value=new fn.default({...csl,"citation-key":key}).format("bibtex").trimEnd();
      if(!/^@[A-Za-z][A-Za-z0-9_-]*\s*\{\s*[^,\r\n]+,/.test(value))throw Error("无法序列化此文献条目。");
      value=value.replace(/^(@[A-Za-z][A-Za-z0-9_-]*\s*\{\s*)[^,\r\n]+,/,(_match,prefix)=>prefix+key+",");
      if(tags.length)value=value.replace(/\n\}\s*$/, "\n\tkeywords = {"+tags.map(Nc).join(", ")+"},\n}");
      return value;
    }).join("\n").replace(/\n{3,}/g,"\n\n").trimEnd()+"\n";
  }`+source.slice(exportEnd);
  // Both copies of the upstream month key have the same value.
  once('january:1,february:2,march:3,april:4,may:5,june:6','january:1,february:2,march:3,april:4,june:6');
  // A .bib file must never invoke Citation.js URL/DOI auto-detection.
  once('return new fn.default(t)}return new fn.default(e)}function Pc(', 'return new fn.default(t,{forceType:"@biblatex/text"})}return new fn.default(e)}function Pc(');
  // Closing a library also stops an open entry editor's lock heartbeat.
  once('disconnectedCallback(){this.#n?.(),this.#n=null}', 'disconnectedCallback(){this.#n?.(),this.#n=null,this.#m&&(clearTimeout(this.#m),this.#m=null),this.#b().catch(()=>{})}dispose(){this.disconnectedCallback()}');
  once('i=typeof n.URL=="string"?n.URL:r?`https://doi.org/${r}`:"",a=', 'i=__vnSafeBibliographyURL(typeof n.URL=="string"?n.URL:r?`https://doi.org/${r}`:""),a=');
  // Localize only the vendor's own UI literals/templates. User titles, keys,
  // abstracts and other stored strings are never passed through this adapter.
  const ownStart=source.indexOf('var JQ=['),ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}),edits=[];
  function walk(node){
    if(node.start>=ownStart){
      const literal=node.type==='Literal'&&typeof node.value==='string'&&(/[\u3400-\u9fff]/.test(node.value)||node.value==='，');
      const template=node.type==='TemplateLiteral'&&node.quasis.some(q=>/[\u3400-\u9fff]/.test(q.value.cooked??''));
      if(literal||template){edits.push({start:node.start,end:node.end});return;}
    }
    for(const [key,value]of Object.entries(node)){
      if(key==='start'||key==='end')continue;
      if(Array.isArray(value)){for(const child of value)if(child&&typeof child==='object')walk(child);}
      else if(value&&typeof value==='object')walk(value);
    }
  }
  walk(ast);
  for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+'__vnBibUI('+source.slice(edit.start,edit.end)+')'+source.slice(edit.end);
  return '// Integrated from the supplied bib-library bundle; see licenses/bib-library/NOTICE.md.\nimport {localizeBibliographyUI as __vnBibUI,safeBibliographyURL as __vnSafeBibliographyURL} from "../bibliography-editor-localization";\n'+source;
}
if(require.main===module){
  const input=process.argv[2];if(!input)throw Error('Usage: node scripts/patch-bib-library.cjs <original bib-library.js> [output]');
  const output=path.resolve(process.argv[3]??'src/generated/bib-library.js');fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,integrate(fs.readFileSync(input,'utf8')));console.log('Integrated bib-library written to '+output);
}
module.exports={integrate,upstreamSHA256};
