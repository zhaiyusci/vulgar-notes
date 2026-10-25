// Narrow interfaces for the upstream #3536 startup patch. No runtime dependency.
export interface FontDef {mathvariant?:string;autoOP?:boolean}
export interface FontEnvironment {
  unicodeMathCommands?:string[];
  font?:string;italicFont?:string;altItalicFont?:string;
  multiLetterIdentifiers?:RegExp;noAutoOP?:boolean;mathStyleGreekLC?:boolean;
}
export interface StyleInput {c:string;C:string;font:string;ifont:string;afont:string;b:boolean}
export type StyleResult=[string,string];
export type StyleFunction=(input:StyleInput)=>StyleResult;
export interface FontParser {
  stack:{env:FontEnvironment};string:string;i:number;
  options:{identifierPattern:RegExp};
  configuration:{
    options:{mathStyle?:string;mathStyleGreekLC?:boolean;mathStyleMathAlphabets?:boolean};
    mathStyle:StyleFunction;addNode(name:string,node:unknown):void;
  };
  GetArgument(name:string):string;
  create(kind:string,name:string,...args:unknown[]):unknown;
  Push(node:unknown):void;
  itemFactory:{create(name:string):unknown};
}
interface TokenMap {
  lookup(name:string):{char:string;_args:unknown[];_func:unknown};
  add(name:string,macro:unknown):void;
  _parser:unknown;
}
interface FontMethods {
  MathFont:(parser:FontParser,name:string,variant:string,italic?:string,altItalic?:string,greekLC?:boolean)=>void;
  SetFont:(parser:FontParser,name:string,font:string)=>void;
}
interface OutputFont {
  defaultVariants:string[][];
  defaultCssFonts:Record<string,[string,boolean,boolean]>;
  VariantSmp:Record<string,(number|undefined|Record<number,number>)[]>;
}
export interface FontInternals {
  input:{tex_ts:{TeX:{OPTIONS:Record<string,unknown>}};tex:{
    ParseMethods:{default:{variable:(p:FontParser,c:string)=>void;lcGreek:(p:FontParser,t:{char:string})=>void;ucGreek:(p:FontParser,t:{char:string})=>void}};
    ParseOptions:{default:{getVariant:Map<string,StyleFunction>}};
    ParseUtil:{ParseUtil:{getFontDef(p:FontParser):FontDef}};
    TexParser:{default:new(text:string,env:FontEnvironment,config:FontParser['configuration'])=>{mml():unknown}};
    TexConstants:{TexConstant:{Variant:Record<string,string>}};
    base:{BaseConfiguration:{BaseConfiguration:{fallback:{character:(p:FontParser,c:string)=>void}}};BaseMethods:{default:FontMethods}};
    MapHandler:{MapHandler:{getMap(name:string):TokenMap}};
    Token:{Macro:new(name:string,func:FontMethods['MathFont'],args:string[])=>unknown};
    NodeUtil:{default:{setProperty(node:unknown,key:string,value:unknown):void}};
  }};
  core:{MmlTree:{OperatorDictionary:{getRange(char:string):[number,number,unknown,string,string?]}}};
  output:{fonts:Record<string,{chtml_ts:Record<string,OutputFont>}>};
}
