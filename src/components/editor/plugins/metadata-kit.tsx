// SPDX-License-Identifier: GPL-3.0-or-later
'use client';

import {createPlatePlugin} from 'platejs/react';
import {NodeApi,type TElement} from 'platejs';
import {findMetadataTitle,MetadataElement} from '@/components/ui/metadata-node';
import {MetadataEntryElement} from '@/components/ui/metadata-entry-node';
import {metadataRoleOrder} from '@/document-metadata';

const samePoint=(left:{path:number[];offset:number}|undefined,right:{path:number[];offset:number})=>
  !!left&&left.offset===right.offset&&left.path.join('.')===right.path.join('.');

/** Metadata is ordinary editable rich text grouped separately from the article. */
export const MetadataKit=[
  createPlatePlugin({
    key:'document_metadata',
    node:{isElement:true,isContainer:true,component:MetadataElement},
  }).overrideEditor(({editor,tf:{normalizeNode,deleteBackward,deleteForward}})=>{
    const entryAt=(point:{path:number[];offset:number})=>editor.api.above({at:point,match:node=>node.type==='metadata_entry'});
    const crossesEntry=(direction:'backward'|'forward')=>{
      const selection=editor.selection;if(!selection)return false;
      // An explicit selection expresses deletion intent, including across metadata entries.
      if(!editor.api.isCollapsed())return false;
      const first=entryAt(selection.anchor);
      const point=selection.anchor;
      if(first&&samePoint(direction==='backward'?editor.api.start(first[1]):editor.api.end(first[1]),point))return true;
      // Also protect entry content when deletion starts in the adjacent ordinary paragraph.
      if(!first){
        const block=editor.api.block();
        if(block&&samePoint(direction==='backward'?editor.api.start(block[1]):editor.api.end(block[1]),point)){
          const adjacent=direction==='backward'?editor.api.before(point):editor.api.after(point);
          if(adjacent&&entryAt(adjacent))return true;
        }
      }
      return false;
    };
    return {transforms:{
    deleteBackward(unit){if(!crossesEntry('backward'))deleteBackward(unit);},
    deleteForward(unit){if(!crossesEntry('forward'))deleteForward(unit);},
    normalizeNode(entry,options){
      const [node,path]=entry;
      if(node.type==='document_metadata'||node.type==='metadata_entry'){
        if(node.type==='document_metadata'&&path.length>1){editor.tf.moveNodes({at:path,to:[path[0]+1]});return;}
        if(node.type==='document_metadata'){
          const children=Array.isArray(node.children)?node.children:[];
          const ordered=children.map((child,index)=>({child,index})).sort((left,right)=>metadataRoleOrder(left.child)-metadataRoleOrder(right.child)||left.index-right.index);
          for(let index=0;index<ordered.length;index++)
            if(ordered[index].index!==index){editor.tf.moveNodes({at:[...path,ordered[index].index],to:[...path,index]});return;}
        }
        if(node.type==='metadata_entry'){
          const parent=NodeApi.get(editor,path.slice(0,-1)) as TElement|undefined;
          if(parent?.type!=='document_metadata'){
            editor.tf.wrapNodes({type:'document_metadata',id:crypto.randomUUID(),children:[]},{at:path});return;
          }
          const duplicates=[...NodeApi.nodes(editor)].filter(([other])=>other.type==='metadata_entry'&&other.id===node.id);
          const first=duplicates[0];
          if(typeof node.id!=='string'||!node.id||first&&first[1].join('.')!==path.join('.')){
            editor.tf.setNodes({id:crypto.randomUUID()},{at:path});return;
          }
          if(!['title','author','affiliation','note','text'].includes(String(node.role))){
            editor.tf.setNodes({role:'text'},{at:path});return;
          }
          const title=node.role==='title'?findMetadataTitle(editor.children):undefined;
          if(title&&title[1].join('.')!==path.join('.')){
            editor.tf.setNodes({role:'text'},{at:path});return;
          }
        }
        const children=Array.isArray(node.children)?node.children:[];
        if(!children.length){
          editor.tf.insertNodes({type:'p',children:[{text:''}]},{at:[...path,0]});return;
        }
        const inline=(child:typeof children[number])=>typeof child.text==='string'||editor.api.isInline(child);
        const start=children.findIndex(inline);
        if(start!==-1){
          let end=start+1;
          while(end<children.length&&inline(children[end]))end++;
          // Move nodes, rather than recreating them, to retain text, marks and selection.
          editor.tf.withoutNormalizing(()=>{
            editor.tf.insertNodes({type:'p',children:[]},{at:[...path,start]});
            for(let index=0;index<end-start;index++)
              editor.tf.moveNodes({at:[...path,start+1],to:[...path,start,index]});
          });
          return;
        }
      }
      normalizeNode(entry,options);
    },
  }};}),
  createPlatePlugin({key:'metadata_entry',node:{isElement:true,isContainer:true,component:MetadataEntryElement}}),
];
