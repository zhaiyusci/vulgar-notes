const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const bundled=buildSync({stdin:{contents:"export {formulaLocations} from './src/formula-locations';",resolveDir:__dirname,loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',target:'es2022'}).outputFiles[0].text;
const compiled={exports:{}};new Function('module','exports',bundled)(compiled,compiled.exports);
const {formulaLocations}=compiled.exports;
const p=content=>({type:'p',children:Array.isArray(content)?content:[{text:content}]});
const formula=(id,type='inline_equation',extra={})=>({type,id,texExpression:id,numbered:true,children:[{text:''}],...extra});
const paths=value=>formulaLocations(value).map(([node,path])=>[node.id,[...path]]);

test('formula locations retain source-only formulas, nested paths and document order',()=>{
 const a=formula('a'),b=formula('b','equation'),c=formula('source','inline_equation',{texExpression:'\\unsupported{x}'});
 const value=[p([{text:'Before '},a,{text:' after'}]),{type:'blockquote',children:[p('Body'),{type:'table',children:[{type:'tr',children:[{type:'td',children:[p([{text:''},b,{text:''}])]}]}]}]},c];
 assert.deepEqual(paths(value),[['a',[0,1]],['b',[1,1,0,0,0,1]],['source',[2]]]);
 const locations=formulaLocations(value);
 assert.equal(locations[0][0],a);assert.equal(locations[1][0],b);assert.equal(locations[2][0],c);
 assert.ok(Object.isFrozen(locations));
 for(const location of locations){assert.ok(Object.isFrozen(location));assert.ok(Object.isFrozen(location[1]));}
});

test('immutable insertion, movement, deletion, undo, replacement and new roots cannot retain old paths or nodes',()=>{
 const a=formula('a'),b=formula('b'),first=p([{text:''},a,{text:''}]),second={type:'blockquote',children:[p('Body'),p([{text:''},b,{text:''}])]};
 const original=[first,second],initial=formulaLocations(original);
 assert.deepEqual(paths([p('Inserted'),...original]),[['a',[1,1]],['b',[2,1,1]]]);
 assert.deepEqual(paths([second,first]),[['b',[0,1,1]],['a',[1,1]]]);
 const moved={...second,children:[second.children[1],second.children[0]]};
 assert.deepEqual(paths([first,moved]),[['a',[0,1]],['b',[1,0,1]]]);
 assert.deepEqual(paths([p('Removed'),moved]),[['b',[1,0,1]]]);
 assert.equal(formulaLocations(original),initial,'undo to an immutable root can reuse the exact complete result');
 const replacement={...a,snapshot:'replacement snapshot',texExpression:'replacement source'};
 const replaced=[{...first,children:[first.children[0],replacement,first.children[2]]},second];
 assert.equal(formulaLocations(replaced)[0][0],replacement);
 assert.equal(formulaLocations(replaced)[0][0].snapshot,'replacement snapshot');
 assert.equal(formulaLocations(original)[0][0],a,'a replacement must not overwrite a cached older root');
 assert.deepEqual(paths([]),[]);
 const other=formula('other','equation');assert.deepEqual(paths([other]),[['other',[0]]]);
 const empty=[p('Plain')];assert.deepEqual(paths(empty),[]);
 assert.deepEqual(paths([{...empty[0],children:[{text:''},a,{text:''}]}]),[['a',[0,1]]],'inserting into a formerly empty subtree must invalidate its empty result');
});

test('ordinary text edits reuse unchanged subtree caches and repeated children arrays need no traversal',()=>{
 let stableReads=0,rootReads=0;
 const a=formula('cached'),children=[p('Nested'),p([{text:''},a,{text:''}])];
 const stable={type:'blockquote',get children(){stableReads++;return children;}};
 const value=[stable,p('Body')];
 Object.defineProperty(value,0,{get(){rootReads++;return stable;},enumerable:true});
 const initial=formulaLocations(value),afterFirst=stableReads,afterRoot=rootReads;
 assert.ok(afterFirst>0);assert.ok(afterRoot>0);
 assert.equal(formulaLocations(value),initial);assert.equal(rootReads,afterRoot,'same children identity must return its complete cached index');
 assert.deepEqual(paths([stable,p('Edited body')]),[['cached',[0,1,1]]]);
 assert.equal(stableReads,afterFirst,'a prose sibling edit must not read children in the unchanged branch');
 const updated={...a,snapshot:'latest'};
 const updatedBranch={type:'blockquote',children:[children[0],{...children[1],children:[children[1].children[0],updated,children[1].children[2]]}]};
 const current=[updatedBranch,value[1]];
 assert.equal(formulaLocations(current)[0][0],updated);
 assert.equal(formulaLocations(current)[0][0].snapshot,'latest');
 assert.equal(formulaLocations(value)[0][0],a);
});
