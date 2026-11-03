// SPDX-License-Identifier: GPL-3.0-or-later
import type {Descendant} from 'platejs';
import {isFormula,type FormulaNode} from './plate-document';

export type FormulaLocation=readonly [node:FormulaNode,path:readonly number[]];
const empty:readonly FormulaLocation[]=Object.freeze([]);
const nodesCache=new WeakMap<Descendant,readonly FormulaLocation[]>();
const childrenCache=new WeakMap<readonly Descendant[],readonly FormulaLocation[]>();

const location=(node:FormulaNode,path:number[]):FormulaLocation=>Object.freeze([node,Object.freeze(path)]);

function inNode(node:Descendant):readonly FormulaLocation[]{
  const cached=nodesCache.get(node);if(cached)return cached;
  const result:FormulaLocation[]=[];
  if(isFormula(node))result.push(location(node as FormulaNode,[]));
  if(Array.isArray(node.children))for(const [formula,path] of formulaLocations(node.children))result.push(location(formula,[...path]));
  const found=result.length?Object.freeze(result):empty;
  nodesCache.set(node,found);return found;
}

/** Formula paths relative to an immutable Slate children array. Unchanged
 * subtrees retain both their current node references and cached relative paths.
 * Reordering a parent only adds new prefixes; editing prose visits that branch.
 */
export function formulaLocations(value:readonly Descendant[]):readonly FormulaLocation[]{
  const cached=childrenCache.get(value);if(cached)return cached;
  const result:FormulaLocation[]=[];
  value.forEach((node,index)=>{
    for(const [formula,path] of inNode(node))result.push(location(formula,[index,...path]));
  });
  const found=result.length?Object.freeze(result):empty;
  childrenCache.set(value,found);return found;
}
