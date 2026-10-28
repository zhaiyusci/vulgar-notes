'use client';
import {createPlatePlugin} from 'platejs/react';
import {NodeApi} from 'platejs';
import {FloatCaptionElement,FloatElement} from '@/components/ui/float-node';

export const FloatKit=[
  createPlatePlugin({key:'float',node:{isElement:true,component:FloatElement},handlers:{onKeyDown:({editor,event})=>{
    if(!['Backspace','Delete'].includes(event.key)||!editor.selection||!editor.api.isCollapsed())return;
    const description=editor.api.above({match:node=>node.type==='float_caption'});
    if(description){
      const edge=event.key==='Backspace'?editor.api.start(description[1]):editor.api.end(description[1]);
      const point=editor.selection.anchor;
      if(edge&&edge.offset===point.offset&&edge.path.join('.')===point.path.join('.'))event.preventDefault();
    }
  }}}).overrideEditor(({editor,tf:{normalizeNode}})=>({transforms:{normalizeNode(entry,options){
    const [node,path]=entry;
    if(node.type==='float'){
      // Blocks introduced by paste also stay in the document's main flow.
      if(path.length>1){editor.tf.moveNodes({at:path,to:[path[0]+1]});return;}
      const children=Array.isArray(node.children)?node.children:[];
      const expected=node.kind==='table'?'table':'img';
      const bodyIndex=node.kind==='table'?1:0,captionIndex=node.kind==='table'?0:1;
      if(node.kind==='table'&&children[0]?.type==='table'){
        if(children[1]?.type==='float_caption'){
          // Migrate development documents by moving, never rebuilding, the caption.
          editor.tf.moveNodes({at:[...path,1],to:[...path,0]});return;
        }
        editor.tf.insertNodes({type:'float_caption',children:[{text:''}]},{at:[...path,0]});return;
      }
      if(children[bodyIndex]?.type!==expected){
        // Deleting a body must not delete an already written caption.
        editor.tf.unwrapNodes({at:path});return;
      }
      if(!children[captionIndex]){editor.tf.insertNodes({type:'float_caption',children:[{text:''}]},{at:[...path,captionIndex]});return;}
      if(children[captionIndex].type!=='float_caption'){
        if(children[captionIndex].type==='p'){editor.tf.setNodes({type:'float_caption'},{at:[...path,captionIndex]});return;}
        editor.tf.moveNodes({at:[...path,captionIndex],to:[path[0]+1]});return;
      }
      if(children.length>2){editor.tf.moveNodes({at:[...path,2],to:[path[0]+1]});return;}
    }
    if(node.type==='float_caption'){
      const parent=path.length?NodeApi.get(editor,path.slice(0,-1)):undefined;
      if(parent?.type!=='float'){editor.tf.setNodes({type:'p'},{at:path});return;}
      const children=Array.isArray(node.children)?node.children:[];
      for(let index=0;index<children.length;index++){
        const child=children[index];
        if(typeof child.text!=='string'&&!editor.api.isInline(child)){
          if(child.type==='p'){editor.tf.unwrapNodes({at:[...path,index]});return;}
          editor.tf.moveNodes({at:[...path,index],to:[path[0]+1]});return;
        }
      }
    }
    normalizeNode(entry,options);
  }}})),
  createPlatePlugin({key:'float_caption',node:{isElement:true,component:FloatCaptionElement},handlers:{onKeyDown:({editor,event})=>{
    if(event.key!=='Enter'||event.shiftKey||!editor.selection)return;
    const caption=editor.api.above({match:node=>node.type==='float_caption'});if(!caption)return;
    const parent=caption[1].slice(0,-1);event.preventDefault();
    const next=[...parent.slice(0,-1),parent[parent.length-1]+1];
    editor.tf.withNewBatch(()=>{editor.tf.insertNodes({type:'p',children:[{text:''}]},{at:next});editor.tf.select(editor.api.start(next));});
  }}}),
];
