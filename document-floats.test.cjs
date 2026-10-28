const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const compile=(options)=>{const module={exports:{}};new Function('require','module','exports',buildSync({bundle:true,write:false,platform:'node',format:'cjs',target:'es2022',...options}).outputFiles[0].text)(require,module,module.exports);return module.exports;};
const floats=compile({entryPoints:['src/document-floats.ts']});
const {createFigure,createTableFloat,floatBody,floatCaption,validFloatNode,floatNumbers,editFloatTable,tableLatex,floatLatex,floatMarkdown,collectFloatImageAssets}=floats;
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const text=(value)=>({text:value});
const render=nodes=>nodes.map(n=>typeof n.text==='string'?(n.bold?'\\textbf{'+n.text+'}':n.text.replace(/[&%#_]/g,c=>'\\'+c)):n.type==='inline_equation'?'$'+n.texExpression+'$':render(n.children||[])).join('');
const markdown=nodes=>nodes.map(n=>typeof n.text==='string'?(n.bold?'**'+n.text+'**':n.text):n.type==='inline_equation'?'$'+n.texExpression+'$':markdown(n.children||[])).join('');
const setCell=(table,row,column,value)=>{floatBody(table).children[row].children[column].children[0].children=[text(value)];};

test('figures and tables number independently in flow order; unnumbered objects consume no number',()=>{
 const a=createFigure(png),b=createTableFloat(),c=createFigure(png),d=createTableFloat(),e=createFigure(png);c.numbered=false;
 assert.deepEqual([...floatNumbers([a,b,c,d,e]).values()].map(x=>[x.kind,x.number]),[['figure','1'],['table','1'],['figure',''],['table','2'],['figure','2']]);
 assert.equal(floatNumbers([e,d,a,b]).get(a.id).number,'2');
 assert.equal(floatNumbers([{type:'column_group',children:[{type:'column',children:[b,a]}]},e]).get(e.id).number,'2');
 assert.equal('placement' in a,false);
});

test('native figure/table shape validates captions, labels and media before rendering',()=>{
 const figure=createFigure(png,'A plot'),table=createTableFloat(3,4);
 assert.equal(validFloatNode(figure),true);assert.equal(validFloatNode(table),true);
 for(const change of [{kind:'unknown'},{numbered:'true'},{id:''},{texLabel:'x}\\input{secrets'},{children:[figure.children[0]]},{children:[figure.children[0],{type:'p',children:[text('caption')]}]},{children:[{...figure.children[0],url:'javascript:alert(1)'},figure.children[1]]}])assert.equal(validFloatNode({...figure,...change}),false);
 assert.throws(()=>createFigure('file:///C:/private.png'),/HTTP/);
 assert.throws(()=>createFigure('data:image/svg+xml,<svg/>'),/HTTP/);
 assert.throws(()=>createTableFloat(0,2),/dimensions/);
 figure.texLabel='fig:plot_1';assert.equal(validFloatNode(figure),true);
 figure.children[1].children=[{type:'table',children:[text('bad')]}];assert.equal(validFloatNode(figure),false);
});

test('row and column operations keep existing cell content, captions and stable labels',()=>{
 const original=createTableFloat();original.texLabel='tab:measurements';floatCaption(original).children=[text('Caption')];
 setCell(original,0,0,'A');setCell(original,0,1,'B');setCell(original,1,0,'C');setCell(original,1,1,'D');
 const inserted=editFloatTable(original,'row-before',1,0);
 assert.equal(floatBody(inserted).children.length,3);
 assert.equal(render(floatBody(inserted).children[2].children[1].children),'D');
 assert.equal(floatBody(inserted).children[2].children[1],floatBody(original).children[1].children[1]);
 const wide=editFloatTable(inserted,'column-after',0,0);
 assert.equal(floatBody(wide).children[0].children.length,3);
 assert.equal(render(floatBody(wide).children[0].children[2].children),'B');
 const restored=editFloatTable(editFloatTable(wide,'delete-column',0,1),'delete-row',1,0);
 assert.deepEqual(restored,original);assert.equal(floatBody(original).children.length,2);
 assert.equal(floatCaption(restored),floatCaption(original));assert.equal(restored.texLabel,'tab:measurements');
 const single=createTableFloat(1,1);assert.equal(editFloatTable(single,'delete-row',0,0),single);assert.equal(editFloatTable(single,'delete-column',0,0),single);
});

test('LaTeX stays in flow, escapes captions through its serializer and labels only numbered captions',()=>{
 const table=createTableFloat(1,2);setCell(table,0,0,'A&B');setCell(table,0,1,'100%');table.texLabel='tab:test';floatCaption(table).children=[text('a_b & result')];
 const latex=floatLatex(table,render,()=>{throw Error('Not an image');});
 assert.match(latex,/\\begin\{minipage\}\{\\linewidth\}/);assert.match(latex,/A\\&B & 100\\%/);
 assert.match(latex,/\\captionof\{table\}\{a\\_b \\& result\}\\label\{tab:test\}/);
 assert.ok(latex.indexOf('\\captionof')<latex.indexOf('\\begin{tabular}'));
 assert.match(latex,/\\captionsetup\{position=top\}/);
 assert.doesNotMatch(latex,/\\begin\{table\}|\[htbp\]/);
 table.numbered=false;const unnumbered=floatLatex(table,render,()=> '');assert.match(unnumbered,/\\captionof\*\{table\}/);assert.doesNotMatch(unnumbered,/\\label/);assert.equal(table.texLabel,'tab:test');
});

test('LaTeX grid emits covered positions for combined row and column spans',()=>{
 const cell=(value,extra={})=>({type:'td',...extra,children:[{type:'p',children:[text(value)]}]});
 const table={type:'table',children:[{type:'tr',children:[cell('A',{colSpan:2,rowSpan:2}),cell('B')]},{type:'tr',children:[cell('C')]},{type:'tr',children:[cell('D'),cell('E'),cell('F')]}]};
 const latex=tableLatex(table,render);
 assert.match(latex,/\\begin\{tabular\}\{lll\}/);
 assert.match(latex,/\\multicolumn\{2\}\{l\}\{\\multirow\{2\}\{\*\}\{A\}\} & B/);
 assert.match(latex,/\n &  & C/);assert.match(latex,/D & E & F/);
 assert.throws(()=>tableLatex({type:'table',children:[{type:'tr',children:[cell('X',{rowSpan:2})]}]},render),/span/);
});

test('Markdown figure/table retains all rich cell and caption content plus semantic metadata',()=>{
 const table=createTableFloat(1,1);table.texLabel='tab:rich';floatBody(table).children[0].children[0].children[0].children=[{text:'bold',bold:true},{type:'inline_equation',texExpression:'x^2',children:[text('')]}];floatCaption(table).children=[{text:'Caption',bold:true}];
 const result=floatMarkdown(table,markdown);assert.match(result,/data-float-kind="table"/);assert.match(result,/id="tab:rich"/);assert.match(result,/\*\*bold\*\*\$x\^2\$/);assert.match(result,/\*\*Caption\*\*/);assert.doesNotMatch(result,/placement/);
 assert.ok(result.indexOf('<figcaption>')<result.indexOf('<table>'));
 const figure=createFigure('https://example.org/a.png?x=1&y=2','"<safe>');const image=floatMarkdown(figure,markdown);assert.match(image,/x=1&amp;y=2/);assert.match(image,/alt="&quot;&lt;safe&gt;"/);
});

test('single-file LuaLaTeX embeds inert hex image bytes with generated names and deduplicates sources',()=>{
 const figure=createFigure(png),again=createFigure(png),assets=collectFloatImageAssets([figure,again]);
 assert.equal((assets.resources.match(/\\begin\{filecontents\*\}/g)||[]).length,1);
 const hex=assets.resources.match(/\n([0-9a-f\n]+)\\end/)[1].replace(/\n/g,'');
 assert.equal(Buffer.from(hex,'hex').toString('base64'),png.split(',')[1]);
 assert.match(assets.setup,/\\usepackage\{caption\}/);assert.match(assets.setup,/tex.jobname/);assert.doesNotMatch(assets.setup,/%|#/);
 assert.match(assets.renderImage(figure.children[0]),/\\includegraphics.*\\jobname-vulgar-image-1.png/);
 assert.throws(()=>collectFloatImageAssets([createFigure('https://example.org/remote.png')]),/Remote images/);
 assert.throws(()=>collectFloatImageAssets([createFigure('data:image/png;base64,ZmFrZQ==')]),/bytes/);
 assert.throws(()=>assets.renderImage({url:'unexpected'}),/resources/);
});

test('Plate editing keeps the caption container whole and exits to an outside paragraph',()=>{
 const ui=compile({stdin:{contents:"export {createPlateEditor,ParagraphPlugin} from 'platejs/react'; export {ImagePlugin} from '@platejs/media/react'; export {TablePlugin,TableRowPlugin,TableCellPlugin} from '@platejs/table/react'; export {FloatKit} from './src/components/editor/plugins/float-kit';",resolveDir:process.cwd(),sourcefile:'float-fixture.ts'},packages:'external'});
 const figure=createFigure(png);figure.children[1].children=[text('Caption')];
 const editor=ui.createPlateEditor({plugins:[ui.ParagraphPlugin,ui.ImagePlugin,ui.TablePlugin,ui.TableRowPlugin,ui.TableCellPlugin,...ui.FloatKit],value:[figure,{type:'p',children:[text('After')]}]});
 editor.tf.select({path:[0,1,0],offset:7});
 let prevented=false;ui.FloatKit[1].handlers.onKeyDown({editor,event:{key:'Enter',shiftKey:false,preventDefault(){prevented=true;}}});
 assert.equal(prevented,true);assert.equal(editor.children[0].children.length,2);assert.equal(editor.children[1].type,'p');assert.equal(editor.selection.anchor.path[0],1);assert.equal(render(editor.children[2].children),'After');
 editor.tf.select({path:[0,1,0],offset:0});prevented=false;ui.FloatKit[0].handlers.onKeyDown({editor,event:{key:'Backspace',preventDefault(){prevented=true;}}});assert.equal(prevented,true);
 editor.tf.removeNodes({at:[0,1]});assert.equal(editor.children[0].children[1].type,'float_caption');
 editor.tf.removeNodes({at:[0,0]});assert.equal(editor.children.some(n=>n.type==='float'),false);
});

test('legacy table captions migrate to the front without changing the body, caption, label or identity',()=>{
 const ui=compile({stdin:{contents:"export {createPlateEditor,ParagraphPlugin} from 'platejs/react'; export {TablePlugin,TableRowPlugin,TableCellPlugin} from '@platejs/table/react'; export {FloatKit} from './src/components/editor/plugins/float-kit';",resolveDir:process.cwd(),sourcefile:'float-migration-fixture.ts'},packages:'external'});
 const canonical=createTableFloat();canonical.texLabel='tab:retained';floatCaption(canonical).children=[{text:'Rich caption',bold:true}];setCell(canonical,0,0,'A');setCell(canonical,0,1,'B');setCell(canonical,1,0,'C');setCell(canonical,1,1,'D');
 assert.deepEqual(canonical.children.map(child=>child.type),['float_caption','table']);
 const legacy={...canonical,children:[floatBody(canonical),floatCaption(canonical)]};
 assert.equal(validFloatNode(legacy),true);
 assert.equal(floatLatex(legacy,render,()=>''),floatLatex(canonical,render,()=>''));
 assert.equal(floatMarkdown(legacy,markdown),floatMarkdown(canonical,markdown));
 const editor=ui.createPlateEditor({plugins:[ui.ParagraphPlugin,ui.TablePlugin,ui.TableRowPlugin,ui.TableCellPlugin,...ui.FloatKit],value:[legacy,{type:'p',children:[text('After')]}]});
 editor.tf.normalize({force:true});
 const stored=editor.children[0];assert.deepEqual(stored.children.map(child=>child.type),['float_caption','table']);assert.equal(stored.id,canonical.id);assert.equal(stored.texLabel,'tab:retained');
 const withoutIds=node=>JSON.parse(JSON.stringify(node,(key,value)=>key==='id'?undefined:value));
 assert.deepEqual(withoutIds(floatBody(stored)),withoutIds(floatBody(canonical)));
 assert.deepEqual(withoutIds(floatCaption(stored)),withoutIds(floatCaption(canonical)));
 editor.tf.select({path:[0,1,0,0,0,0],offset:0});assert.equal(editor.selection.anchor.path[1],1,'the first cell follows the caption in Slate order');
 editor.tf.select({path:[0,0,0],offset:0});let prevented=false;
 ui.FloatKit[0].handlers.onKeyDown({editor,event:{key:'Backspace',preventDefault(){prevented=true;}}});assert.equal(prevented,true);
 ui.FloatKit[1].handlers.onKeyDown({editor,event:{key:'Enter',shiftKey:false,preventDefault(){}}});assert.equal(editor.selection.anchor.path[0],1);assert.equal(editor.children[0].children[1].type,'table');
 editor.tf.removeNodes({at:[0,0]});assert.deepEqual(editor.children[0].children.map(child=>child.type),['float_caption','table']);
});

test('a figure or table context menu opens once without opening the surrounding block menu',async()=>{
 const {Window}=await import('happy-dom');
 const window=new Window({url:'http://localhost/'});
 const names=['window','document','navigator','Node','Text','Document','ShadowRoot','Element','HTMLElement','SVGElement','HTMLCollection','NodeList','MutationObserver','ResizeObserver','DOMRect','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','KeyboardEvent','CustomEvent','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'];
 const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 for(const name of names){const value=name==='window'?window:['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(name)?window[name].bind(window):window[name];Object.defineProperty(globalThis,name,{value,configurable:true});}
 let root;
 try{
  const ui=compile({stdin:{contents:`
   import React from 'react';
   import {createRoot} from 'react-dom/client';
   import {flushSync} from 'react-dom';
   import {createPlateEditor,createPlatePlugin,ParagraphPlugin,Plate,PlateContent,PlateElement} from 'platejs/react';
   import {BlockMenuPlugin} from '@platejs/selection/react';
   import {BlockMenuKit} from './src/components/editor/plugins/block-menu-kit';
   import {FloatKit} from './src/components/editor/plugins/float-kit';
   import {t} from './src/i18n';
   const Image=createPlatePlugin({key:'img',node:{isElement:true,isVoid:true,component:props=><PlateElement {...props}><span contentEditable={false}>Image</span>{props.children}</PlateElement>}});
   export function mount(element,value){
    const editor=createPlateEditor({plugins:[ParagraphPlugin,Image,...BlockMenuKit,...FloatKit],value});
    const root=createRoot(element);flushSync(()=>root.render(<Plate editor={editor}><PlateContent /></Plate>));
    return {editor,root,plugin:BlockMenuPlugin,labelAction:t('Set label')};
   }
  `,resolveDir:process.cwd(),loader:'tsx'},external:['react','react-dom','react-dom/*','react/jsx-runtime','react-dnd','react-dnd-html5-backend'],loader:{'.css':'empty'}});
  for(const node of [createFigure(png),createTableFloat()]){
   const container=document.createElement('div');document.body.append(container);
   const mounted=ui.mount(container,[node,{type:'p',children:[text('After')]}]);root=mounted.root;
   await new Promise(resolve=>setTimeout(resolve,30));
   const target=document.querySelector('[data-float-id="'+node.id+'"] .document-float-caption');assert.ok(target,'the real FloatCaptionElement was rendered');
   const body=mounted.editor.api.toDOMNode(floatBody(mounted.editor.children[0]));assert.ok(body);
   assert.ok(target.compareDocumentPosition(body)&(node.kind==='table'?Node.DOCUMENT_POSITION_FOLLOWING:Node.DOCUMENT_POSITION_PRECEDING),node.kind+' uses the same caption/body order in DOM and Slate');
   const event=new window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:40,button:2});
   target.dispatchEvent(event);
   // BlockContextMenu defers opening with setTimeout, so wait past that callback.
   await new Promise(resolve=>setTimeout(resolve,50));
   const menus=[...document.querySelectorAll('[role="menu"]')];
   assert.equal(event.defaultPrevented,true,node.kind);
   assert.equal(menus.length,1,node.kind+' has exactly one menu');
   assert.ok(menus[0].textContent.includes(mounted.labelAction),'the menu belongs to the figure/table');
   assert.equal(mounted.editor.getOption(mounted.plugin,'openId'),null,'the surrounding block menu stays closed');
   root.unmount();root=undefined;container.remove();
  }
 }finally{
  root?.unmount();await window.happyDOM.close();
  for(const name of names){const descriptor=originals.get(name);if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
 }
});
