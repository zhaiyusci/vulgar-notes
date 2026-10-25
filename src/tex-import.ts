import {EditorModel,catalog,symbols,type MathItem,type Region,type MathNode} from './editor-model';

/** Conservative import: unsupported TeX stays source-only instead of being corrupted. */
export function importMath(source:string):EditorModel|null {
  let i=0,serial=100000;
  const region=(items:MathItem[],label='内容'):Region=>({id:'r'+ ++serial,label,items});
  const node=(type:string,args:MathItem[][]):MathNode=>({id:'n'+ ++serial,type,regions:args.map((items,j)=>region(items,catalog.find(d=>d.type===type)?.labels[j]))});
  const skip=()=>{while(/\s/.test(source[i]||'')&&i<source.length)i++;};
  const argument=():MathItem[]=>{skip();if(source[i]==='{'){i++;const items=sequence('}');return items;}return atom();};
  const atom=():MathItem[]=>{
    skip();const ch=source[i++];if(!ch)throw Error('Missing argument');
    if(ch==='\\'){
      const name=/^[A-Za-z]+/.exec(source.slice(i))?.[0];if(!name)throw Error('Unsupported escape');i+=name.length;
      const symbol=symbols.find(d=>d.command==='\\'+name);
      if(symbol)return [{id:'n'+ ++serial,type:symbol.type,atom:true,regions:[]}];
      if(name==='sqrt'){
        skip();let index:MathItem[]|undefined;
        if(source[i]==='['){i++;index=sequence(']');}
        const body=argument();return [node(index?'nthroot':'sqrt',index?[body,index]:[body])];
      }
      const def=catalog.find(d=>d.command==='\\'+name||d.type===name);
      if(!def||def.font||def.raw||def.operator||def.matrixEnvironment||def.rowEnvironment||!def.labels.length)throw Error('Unsupported command');
      return [node(def.type,def.labels.map(()=>argument()))];
    }
    if(ch==='{')return sequence('}');
    if(/[{}_^]/.test(ch))throw Error('Unexpected delimiter');
    return [ch];
  };
  const sequence=(end?:string):MathItem[]=>{
    const items:MathItem[]=[];
    while(i<source.length){
      skip();if(i>=source.length)break;
      if(end&&source[i]===end){i++;return items;}
      let term=atom();skip();
      while(source[i]==='^'||source[i]==='_'){
        const upper=source[i++]==='^',arg=argument(),base=term[0];
        if(term.length===1&&typeof base!=='string'&&((upper&&base.type==='subscript')||(!upper&&base.type==='power'))){term=[node('sup',[base.regions[0].items,upper?base.regions[1].items:arg,upper?arg:base.regions[1].items])];}
        else term=[node(upper?'power':'subscript',[term,arg])];
        skip();
      }
      items.push(...term);
    }
    if(end)throw Error('Unclosed group');return items;
  };
  try{const model=new EditorModel();model.root=region(sequence());model.index();model.setCursor(model.root.id,0);return model;}catch{return null;}
}
