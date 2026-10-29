// SPDX-License-Identifier: GPL-3.0-or-later
import {ElementApi,KEYS,createSlatePlugin,type InsertNodesOptions,type SlateEditor} from 'platejs';

/** Plate stores equation nodes; our independent MathJax editor owns rendering. */
export function insertEquation(editor:SlateEditor,options?:InsertNodesOptions):void {
  editor.tf.insertNodes({type:editor.getType(KEYS.equation),texExpression:'',children:[{text:''}]},options);
}

export function insertInlineEquation(editor:SlateEditor,texExpression?:string,options?:InsertNodesOptions):void {
  const source=texExpression??(editor.selection?editor.api.string(editor.selection):'');
  editor.tf.insertNodes({type:editor.getType(KEYS.inlineEquation),texExpression:source,children:[{text:''}]},options);
}

function mathNodePlugin<K extends typeof KEYS.equation|typeof KEYS.inlineEquation>(key:K,isInline:boolean){
  return createSlatePlugin({
    key,
    node:{isElement:true,isVoid:true,isInline},
    parsers:{html:{deserializer:{toNodeProps:({element})=>({texExpression:element.getAttribute('data-slate-tex-expression')??''})}}},
  }).overrideEditor(({editor,type,tf:{normalizeNode}})=>({transforms:{normalizeNode(entry){
    const [node,path]=entry;
    if(ElementApi.isElement(node)&&node.type===type&&typeof node.texExpression!=='string'){
      const value=node.texExpression;
      const source=typeof value==='number'||typeof value==='boolean'?String(value):'';
      editor.tf.setNodes({texExpression:source},{at:path});return;
    }
    return normalizeNode(entry);
  }}}));
}

export const BaseEquationPlugin=mathNodePlugin(KEYS.equation,false).extendEditorTransforms(({editor})=>({
  insert:{equation:(options?:InsertNodesOptions)=>insertEquation(editor,options)},
}));
export const BaseInlineEquationPlugin=mathNodePlugin(KEYS.inlineEquation,true).extendEditorTransforms(({editor})=>({
  insert:{inlineEquation:(source?:string,options?:InsertNodesOptions)=>insertInlineEquation(editor,source,options)},
}));
