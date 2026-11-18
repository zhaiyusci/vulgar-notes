import type {EditorModel,MathNode,Region} from './editor-model';
import {mathRegionLabel,t} from './i18n';

export interface MathTreeView {update(model:EditorModel):void;dispose():void}
interface ItemRow {element:HTMLElement;start:number;end:number}

/** Read-only inspection of the actual editor tree, without parsing its TeX. */
export function createMathTreeView(container:HTMLElement):MathTreeView {
  const document=container.ownerDocument;
  const create=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text?:string)=>{
    const element=document.createElement(tag);element.className=className;
    if(text!==undefined)element.textContent=text;
    return element;
  };
  const root=create('section','math-tree-view');root.setAttribute('aria-label',t('Formula syntax tree'));
  const cursor=create('p','math-tree-cursor'),selection=create('span','math-tree-selection');
  const tree=create('div','math-tree-content'),json=create('details','math-tree-json');
  const raw=create('pre','math-tree-raw');raw.tabIndex=0;raw.setAttribute('aria-label',t('Raw formula tree'));
  json.dataset.treeKey='json';json.append(create('summary','math-tree-summary',t('JSON')),raw);
  root.append(cursor,selection,tree,json);container.append(root);
  const regions=new Map<string,HTMLDetailsElement>(),items=new Map<string,ItemRow[]>();
  const highlighted=new Set<HTMLElement>();
  let previous='',disposed=false;

  function metadata(value:Region|MathNode,excluded:string[]):HTMLElement|undefined {
    const fields=Object.entries(value).filter(([key,field])=>!excluded.includes(key)&&field!==undefined);
    if(!fields.length)return;
    const element=create('span','math-tree-metadata');
    for(const [key,value] of fields){
      if(element.childNodes.length)element.append(document.createTextNode(' '));
      element.append(create('code','math-tree-field',key+': '+JSON.stringify(value)));
    }
    return element;
  }
  function branch(key:string,className:string,title:string,opened:Map<string,boolean>){
    const details=create('details',className);details.dataset.treeKey=key;
    details.open=opened.get(key)??true;
    const summary=create('summary','math-tree-summary',title);details.append(summary);
    return {details,summary};
  }
  function appendRegion(region:Region,parent:HTMLElement,opened:Map<string,boolean>){
    const {details,summary}=branch('region:'+region.id,'math-tree-region',t('Region')+' ',opened);
    details.dataset.regionId=region.id;regions.set(region.id,details);items.set(region.id,[]);
    summary.append(create('span','math-tree-label',mathRegionLabel(region.label)),create('code','math-tree-id',region.id));
    const fields=metadata(region,['id','label','items']);if(fields)summary.append(fields);
    const children=create('div','math-tree-children');details.append(children);parent.append(details);
    if(!region.items.length)children.append(create('span','math-tree-empty',t('Empty region')));
    for(let index=0;index<region.items.length;){
      const item=region.items[index],start=index;
      let row:HTMLElement;
      if(typeof item==='string'){
        const characters:string[]=[];
        while(index<region.items.length&&typeof region.items[index]==='string')characters.push(region.items[index++] as string);
        row=create('div','math-tree-text');
        const indices=index===start+1?'items['+start+']':'items['+start+'…'+(index-1)+']';
        row.append(create('code','math-tree-index',indices),create('span','math-tree-kind',t('Text')),
          create('code','math-tree-value',JSON.stringify(characters.join(''))));
      }else{
        index++;
        const node=branch('node:'+item.id,'math-tree-node',t('Structure')+' ',opened);row=node.details;
        row.dataset.nodeId=item.id;row.dataset.nodeType=item.type;
        node.summary.append(create('code','math-tree-index','items['+start+']'),create('code','math-tree-type',item.type),create('code','math-tree-id',item.id));
        const fields=metadata(item,['id','type','regions']);if(fields)node.summary.append(fields);
        const children=create('div','math-tree-children');row.append(children);
        item.regions.forEach(child=>appendRegion(child,children,opened));
      }
      row.dataset.itemRegion=region.id;row.dataset.itemStart=String(start);row.dataset.itemEnd=String(index);
      items.get(region.id)!.push({element:row,start,end:index});children.append(row);
    }
  }
  function clearHighlights(){
    for(const element of highlighted){
      element.classList.remove('math-tree-active-region','math-tree-current-item','math-tree-selected');
      element.removeAttribute('aria-current');delete element.dataset.cursorOffset;
      delete element.dataset.selectionStart;delete element.dataset.selectionEnd;
    }
    highlighted.clear();
  }
  function mark(element:HTMLElement,className:string){element.classList.add(className);highlighted.add(element);}
  return {
    update(model){
      if(disposed)return;
      // Include live region labels in the view key; JSON below uses the saved
      // root exactly, which intentionally omits these derived display labels.
      const content=JSON.stringify(model.root);
      if(content!==previous){
        const opened=new Map<string,boolean>();
        root.querySelectorAll<HTMLDetailsElement>('details[data-tree-key]').forEach(element=>opened.set(element.dataset.treeKey!,element.open));
        clearHighlights();regions.clear();items.clear();tree.replaceChildren();
        appendRegion(model.root,tree,opened);
        raw.textContent=JSON.stringify(JSON.parse(model.snapshot()).root,null,2);
        previous=content;
      }else clearHighlights();
      const {region,offset,anchor}=model.cursor,start=Math.min(offset,anchor),end=Math.max(offset,anchor);
      const cursorText=t('Cursor: {region}, offset {offset}, anchor {anchor}',{region,offset,anchor});
      if(cursor.textContent!==cursorText)cursor.textContent=cursorText;
      const selectionText=start===end?t('No selection'):t('Selection: [{start}, {end})',{start,end});
      if(selection.textContent!==selectionText)selection.textContent=selectionText;
      const active=regions.get(region);
      if(active){mark(active,'math-tree-active-region');active.setAttribute('aria-current','true');}
      const rows=items.get(region)??[],current=rows.find(row=>offset>=row.start&&offset<row.end)??(offset===model.regions.get(region)?.items.length?rows.at(-1):undefined);
      if(current){mark(current.element,'math-tree-current-item');current.element.dataset.cursorOffset=String(offset);}
      for(const row of rows)if(row.start<end&&row.end>start){
        mark(row.element,'math-tree-selected');row.element.dataset.selectionStart=String(Math.max(start,row.start));row.element.dataset.selectionEnd=String(Math.min(end,row.end));
      }
    },
    dispose(){if(disposed)return;disposed=true;clearHighlights();regions.clear();items.clear();root.remove();},
  };
}
