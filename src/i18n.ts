import zh from './locales/zh-CN.json';

export type Locale='en'|'zh-CN';
const messages:Record<string,string>=zh;
const sourceKeys=new Map(Object.entries(messages).map(([key,value])=>[value,key]));
export const locale:Locale=(()=>{
  try{return localStorage.getItem('editor.locale')==='en'?'en':'zh-CN';}catch{return 'zh-CN';}
})();
/** English message IDs are stable; legacy Chinese UI strings resolve during migration. */
export function t(source:string,values?:Record<string,string|number>):string {
  const shortcut=source.match(/^(.*?)( \(.*\))$/);
  if(shortcut)return t(shortcut[1],values)+shortcut[2];
  const key=sourceKeys.get(source)??source;
  const message=locale==='en'?key:messages[key]??key;
  return values?message.replace(/\{(\w+)\}/g,(token,name)=>Object.hasOwn(values,name)?String(values[name]):token):message;
}
export function mathLabel(entry:{label:string;command?:string;type:string}):string{
  const translated=t(entry.label);
  return locale!=='en'||translated!==entry.label?translated:entry.command||entry.type;
}
/** Region names in older trees stay untouched; only their UI presentation is localized. */
export function mathRegionLabel(label:string):string {
  const matrix=label.match(/^矩阵第(\d+)行第(\d+)列$/);
  if(matrix)return t('Matrix row {row}, column {column}',{row:matrix[1],column:matrix[2]});
  const row=label.match(/^第(\d+)行(内容|条件|表达式|右侧|左侧)$/);
  if(row)return t('Row {row}: {part}',{row:row[1],part:t(row[2])});
  return t(label);
}
export function initLocale(){
  document.documentElement.lang=locale;
  for(const [id,key] of [['mathPanel','Math input'],['formulaLayout','Current formula'],['insertToolbar','Insert'],['textFlow','Body']])document.getElementById(id)?.setAttribute('aria-label',t(key));
  document.title='Vulgar Notes';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n!);});
  document.querySelectorAll<HTMLOptGroupElement>('optgroup[data-i18n-label]').forEach(el=>{el.label=t(el.dataset.i18nLabel!);});
}
