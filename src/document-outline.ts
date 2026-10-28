// SPDX-License-Identifier: GPL-3.0-or-later
import type {TElement} from 'platejs';

export interface DocumentOutlineEntry {
  node:TElement;
  path:number[];
  depth:number;
  number:string;
  title:string;
  /** Export-only target, independent of duplicated or missing editor node IDs. */
  anchor:string;
}

/** Visible heading text, including formulas whose Slate child is intentionally empty. */
export function outlineHeadingText(value:unknown):string {
  if(!value||typeof value!=='object')return '';
  const node=value as Record<string,unknown>;
  if(typeof node.text==='string')return node.text;
  if(node.type==='tex_label')return '';
  if(node.type==='equation'||node.type==='inline_equation')return typeof node.texExpression==='string'?node.texExpression:'';
  if(node.type==='tex_reference')return Array.isArray(node.keys)?node.keys.filter(key=>typeof key==='string').join(', '):'';
  return Array.isArray(node.children)?node.children.map(outlineHeadingText).join(''):'';
}

export function outlineHeadingAnchor(path:readonly number[]):string {
  return 'vn-heading-'+path.join('-');
}

/** Numbers and titles are always derived from current document order, never stored in a TOC node. */
export function documentOutline(nodes:readonly unknown[],options:{includeEmpty?:boolean}={}):DocumentOutlineEntry[] {
  const result:DocumentOutlineEntry[]=[],counts=[0,0,0,0,0,0];
  const walk=(children:readonly unknown[],parent:number[])=>children.forEach((raw,index)=>{
    if(!raw||typeof raw!=='object')return;
    const node=raw as Record<string,unknown>,path=[...parent,index];
    // Generated contents and footnotes are not document sections.
    if(node.type==='toc'||node.type==='document_metadata'||node.type==='footnoteDefinition'||node.type==='equation'||node.type==='inline_equation')return;
    if(typeof node.type==='string'&&/^h[1-6]$/.test(node.type)){
      const depth=Number(node.type[1]);counts[depth-1]++;counts.fill(0,depth);
      const title=outlineHeadingText(node).replace(/\s+/g,' ').trim();
      // Empty headings retain their real section number but produce no blank navigation row.
      if(title||options.includeEmpty)result.push({node:node as TElement,path,depth,number:counts.slice(0,depth).join('.'),title,anchor:outlineHeadingAnchor(path)});
    }
    if(Array.isArray(node.children))walk(node.children,path);
  });
  walk(nodes,[]);
  return result;
}

export function escapeOutlineMarkdown(text:string):string {
  return text.replace(/\s+/g,' ').trim().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_[\]|]/g,'\\$&');
}

/** The exporter emits the matching explicit anchors before its rendered headings. */
export function tocMarkdown(nodes:readonly unknown[]):string {
  return documentOutline(nodes).map(item=>'  '.repeat(item.depth-1)+'- ['+item.number+' '+escapeOutlineMarkdown(item.title)+'](#'+item.anchor+')').join('\n');
}
