// SPDX-License-Identifier: GPL-3.0-or-later
import citeproc from 'citeproc';
import type {CSLItem} from '../bibtex-csl';

export interface CSLBibliography {ids:string[][];html:string[]}

/** Shared by the web and desktop hosts; callers retain ownership of metadata. */
export function renderCSLBibliography(items:readonly CSLItem[],style:string,locale:string,locales:Record<string,string>):CSLBibliography {
  try{
    // citeproc normalizes and annotates its records. Work on private JSON copies
    // so sorting/disambiguation cannot modify document or library metadata.
    const records=new Map(items.map(item=>[String(item.id),JSON.parse(JSON.stringify(item)) as CSLItem]));
    const processor=new citeproc.Engine({
      retrieveLocale:language=>locales[language]||(language==='en'?locales['en-US']:language==='zh'?locales['zh-CN']:false),
      retrieveItem:id=>{
        const item=records.get(id);
        if(!item)throw Error('Unknown bibliography item');
        return item;
      },
    },style,locale);
    processor.setOutputFormat('html');
    processor.updateItems([...records.keys()]);
    const bibliography=processor.makeBibliography();
    if(!bibliography)return {ids:[],html:[]};
    return {ids:bibliography[0].entry_ids.map(ids=>ids.map(String)),html:bibliography[1]};
  }catch(cause){
    throw Error('The reference formatter could not run.',{cause});
  }
}
