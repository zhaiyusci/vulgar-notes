// SPDX-License-Identifier: GPL-3.0-or-later
import type {TElement} from 'platejs';
import {isMetadataEntryEmpty,metadataIndex,metadataOrderedIds,normalizeMetadataLayout,normalizeDocumentTitles,validMetadataEntry,type MetadataEntry} from './document-metadata';

export interface MetadataAuthblk {packages:string;setup:string;bodyByBlock:Map<TElement,string>}

/** Export native authblk commands, retaining ordinary metadata paragraphs at their document position. */
export function buildMetadataAuthblk(blocks:readonly TElement[],renderChildren:(nodes:readonly any[])=>string):MetadataAuthblk {
  const originalBlocks=blocks;
  blocks=normalizeMetadataLayout(normalizeDocumentTitles([...blocks])) as TElement[];
  const index=metadataIndex(blocks),byId=new Map<string,MetadataEntry>(),local=new Map<MetadataEntry,Set<string>>();
  for(const block of blocks){
    const ids=new Set<string>();
    for(const node of block.children){
      if(node.type!=='metadata_entry')continue;
      if(!validMetadataEntry(node))throw Error('Invalid metadata entry.');
      if(byId.has(node.id))throw Error('Duplicate metadata entry ID: '+node.id);
      byId.set(node.id,node);ids.add(node.id);
    }
    for(const node of block.children)if(validMetadataEntry(node))local.set(node,ids);
  }
  for(const entry of index.entries){
    if(isMetadataEntryEmpty(entry))continue;
    const relations:{ids:readonly string[];role:'affiliation'|'note'}[]=[];
    if(entry.role==='author')relations.push({ids:entry.affiliationIds??[],role:'affiliation'});
    if(entry.role==='title'||entry.role==='author')relations.push({ids:entry.noteIds??[],role:'note'});
    for(const {ids,role} of relations)
      for(const id of ids){
        const target=byId.get(id);
        if(!target||target.role!==role||!local.get(entry)?.has(id))throw Error('Missing metadata '+role+' reference: '+id);
        if(isMetadataEntryEmpty(target))throw Error('Empty metadata '+role+' reference: '+id);
      }
  }
  const titles=index.titles.filter(entry=>!isMetadataEntryEmpty(entry)),authors=index.authors.filter(entry=>!isMetadataEntryEmpty(entry));
  const native=titles.length>0||authors.length>0,usedNotes=new Set<string>();
  const hasAffiliations=authors.length>0&&index.affiliationNumbers.size>0;
  const markedNoteCount=(entry:MetadataEntry)=>(entry.noteIds??[]).filter(id=>index.noteNumbers.has(id)).length;
  const needsMarkGap=(entry:MetadataEntry)=>entry.role==='title'||!hasAffiliations;
  const needsTitling=index.noteNumbers.size>9||[...titles,...authors].some(entry=>needsMarkGap(entry)&&markedNoteCount(entry)>1);
  const text=(entry:MetadataEntry)=>renderChildren(entry.children).trim();
  const noteMarks=(entry:MetadataEntry)=>metadataOrderedIds(entry.noteIds??[],index.noteNumbers).map(id=>{
    const number=index.noteNumbers.get(id);if(number===undefined)return '';
    if(usedNotes.has(id))return '\\protect\\footnotemark['+number+']';
    usedNotes.add(id);return '\\thanks{'+text(byId.get(id)!)+'}';
  }).filter(Boolean).join(needsMarkGap(entry)?'\\thanksgap{1em}':'');
  const bodyByBlock=new Map<TElement,string>();let setup='',packages='';
  if(native){
    packages=(needsTitling?'\\usepackage{titling}\n':'')+'\\usepackage[noblocks]{authblk}\n';
    if(index.noteNumbers.size>9)setup+='\\thanksmarkseries{arabic}\n\\thanksheadextra{[}{]}\n\\thanksfootextra{[}{]}\n';
    setup+='\\title{'+(titles[0]?text(titles[0])+noteMarks(titles[0]):'')+'}\n';
    const authorText=(entry:MetadataEntry)=>text(entry).replace(/\n\s*\n/g,'\\protect\\authorcr ')+noteMarks(entry);
    if(hasAffiliations){
      for(const author of authors){
        const numbers=metadataOrderedIds(author.affiliationIds??[],index.affiliationNumbers).map(id=>index.affiliationNumbers.get(id)).filter(number=>number!==undefined);
        // An explicit space is authblk's native blank marker; [] would inherit an affiliation.
        setup+='\\author['+(numbers.length?numbers.join(','):' ')+']{'+authorText(author)+'}\n';
      }
      for(const affiliation of index.affiliations){const number=index.affiliationNumbers.get(affiliation.id);if(number!==undefined)setup+='\\affil['+number+']{'+text(affiliation)+'}\n';}
    }else setup+='\\author{'+authors.map(authorText).join('\\and\n')+'}\n';
    setup+='\\date{}\n';
  }
  const first=blocks.find(block=>block.children.some(node=>validMetadataEntry(node)&&['title','author'].includes(node.role)&&!isMetadataEntryEmpty(node)));
  for(const [blockIndex,block] of blocks.entries()){
    const parts:string[]=native&&block===first?['\\maketitle']:[];
    for(const node of block.children){
      if(!validMetadataEntry(node)){parts.push(renderChildren([node]));continue;}
      if(native&&(node.role==='title'||node.role==='author'||node.role==='affiliation'&&authors.length>0||node.role==='note'&&usedNotes.has(node.id)))continue;
      parts.push(renderChildren(node.children));
    }
    // The document exporter concatenates fragments directly with the next paragraph.
    bodyByBlock.set(originalBlocks[blockIndex],parts.filter(part=>part.trim()).join('\n\n')+'\n\n');
  }
  return {packages,setup,bodyByBlock};
}
