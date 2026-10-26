import type {Descendant,Value} from 'platejs';
import type {BibLibrary} from './bibtex';
import {bibliographyItems} from './references';

/** Export endnotes and references in the document's shared numbering order. */
export function bibliographyMarkdown(value:Value,libraries:readonly BibLibrary[],serialize:(value:Value)=>string):string {
  const entries=bibliographyItems(value,libraries);
  const noteNumbers=new Map(entries.filter(entry=>entry.kind==='endnote').map(entry=>[entry.identifier,entry.number||'??']));
  const withoutEntries=(nodes:Descendant[]):Descendant[]=>nodes.flatMap(node=>{
    if(node.type==='bibliography_entry'||node.type==='footnoteDefinition')return [];
    if(node.type==='footnoteReference')return [{text:'['+(noteNumbers.get(String(node.identifier??''))||'??')+']'}];
    return [Array.isArray(node.children)?{...node,children:withoutEntries(node.children as Descendant[])}:node];
  });
  const body=serialize(withoutEntries(value) as Value);
  if(!entries.length)return body;
  const items=entries.map(entry=>{
    // Use the same rich-text and math serializer as the prose. The legacy
    // bibliography_entry rule flattened children to plain text, losing marks
    // and formulas; a paragraph preserves their native Markdown handling.
    const children=withoutEntries(entry.node.children as Descendant[]);
    const content=serialize(entry.kind==='endnote'?children as Value:[{...entry.node,type:'p',children}]).trim();
    return '['+(entry.number||'??')+']'+(entry.kind==='bibliography'?' \\bibitem{'+entry.key+'}':'')+(content?' '+content:'');
  });
  const prose=body.trimEnd();
  return (prose?prose+'\n\n':'')+'## Notes and references\n\n'+items.join('\n\n')+'\n';
}
