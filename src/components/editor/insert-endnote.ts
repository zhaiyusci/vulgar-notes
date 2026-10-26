import {insertFootnote} from '@platejs/footnote';
import {KEYS} from 'platejs';
import type {PlateEditor} from 'platejs/react';

type TextInsertionHost={prepareTextInsertion():void};

/** Both entry points create and focus one editable note in one undo batch. */
export function insertEndnote(editor:PlateEditor,host?:TextInsertionHost):void {
  if(editor.api.isReadOnly())return;
  host?.prepareTextInsertion();
  editor.tf.withNewBatch(()=>{
    if(!editor.selection){
      if(!editor.children.length)editor.tf.insertNodes({type:KEYS.p,children:[{text:''}]});
      editor.tf.select(editor.api.end([]));
    }
    insertFootnote(editor,{focusDefinition:true});
  });
}
