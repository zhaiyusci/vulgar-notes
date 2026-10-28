// SPDX-License-Identifier: GPL-3.0-or-later
import commandData from './mathjax-command-data.json';
import {mathJaxExtensionPolicy} from './mathjax-extension-policy';

export interface MathJaxSyntax {
  kind:'symbol'|'macro-expansion'|'handler-defined';
  arity?:number;
  optionalDefault?:unknown;
}
export interface MathJaxCommandDefinition {
  package:string;
  context:'math'|'text';
  handler:string;
  map:string;
  kind:'character'|'delimiter'|'command'|'macro'|'environment';
  args?:unknown[];
  character?:string;
  attributes?:Record<string,unknown>|null;
  syntax:MathJaxSyntax;
  configured:boolean;
}
export interface MathJaxCommand {
  name:string;
  packages:string[];
  configured:boolean;
  definitions:MathJaxCommandDefinition[];
}
export const mathjaxCommands=commandData.commands as unknown as readonly MathJaxCommand[];
export const mathjaxEnvironments=commandData.environments as unknown as readonly MathJaxCommand[];
export const mathjaxCommandVersion=commandData.mathjaxVersion;
const byName=new Map(mathjaxCommands.map(command=>[command.name,command]));
const excludedPackages=new Set(mathJaxExtensionPolicy.filter(entry=>entry.state==='excluded').map(entry=>entry.name));
const excluded=(definition:MathJaxCommandDefinition)=>excludedPackages.has(definition.package.replace(/^text-/,''));
const duplicateBlackboardWeight=(command:MathJaxCommand)=>command.packages.includes('bboldx')&&(/^(?:bfbb)/.test(command.name)||['mathbfbb','imathbfbb','jmathbfbb'].includes(command.name));

export function findMathjaxCommand(name:string):MathJaxCommand|undefined {
  return byName.get(name.replace(/^\\/,''));
}
/** A configured definition always takes priority over another package's alias. */
export function mathjaxCommandDefinition(command:MathJaxCommand,configuredOnly=true):MathJaxCommandDefinition|undefined {
  const active=command.definitions.find(definition=>definition.configured&&definition.context==='math'&&!excluded(definition));
  return active??(configuredOnly?undefined:command.definitions.find(definition=>definition.context==='math'&&!excluded(definition)));
}
/** These are runtime CharacterMap tokens, not guessed no-argument macros. */
export function mathjaxSymbolCommands(configuredOnly=true):readonly (MathJaxCommand&{definition:MathJaxCommandDefinition;character:string})[] {
  return mathjaxCommands.flatMap(command=>{
    if(!/^[A-Za-z]+$/.test(command.name)||duplicateBlackboardWeight(command)||configuredOnly&&!command.configured)return [];
    const definition=mathjaxCommandDefinition(command,configuredOnly);
    if(!definition?.character||definition.syntax.kind!=='symbol'||!['character','delimiter'].includes(definition.kind))return [];
    return [{...command,definition,character:definition.character}];
  });
}
/** No inferred arity: unknown handler grammar starts with its exact command. */
export function mathjaxSourceTemplate(name:string,configuredOnly=true):string|undefined {
  const command=findMathjaxCommand(name),definition=command&&mathjaxCommandDefinition(command,configuredOnly);
  if(!command||!definition)return;
  const syntax=definition.syntax;
  const count=syntax.kind==='macro-expansion'?Math.max(0,(syntax.arity??0)-(syntax.optionalDefault===undefined?0:1)):0;
  return '\\'+command.name+'{}'.repeat(count);
}
/** Source candidates remain source components until a converter proves support. */
export function mathjaxSourceCommands(configuredOnly=true):readonly MathJaxCommand[] {
  return mathjaxCommands.filter(command=>/^[A-Za-z]+$/.test(command.name)&&!duplicateBlackboardWeight(command)&&(!configuredOnly||command.configured)&&!!mathjaxCommandDefinition(command,configuredOnly));
}
