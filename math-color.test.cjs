const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');
const code=buildSync({stdin:{contents:"export {EditorModel,catalog} from './src/editor-model';export {convertMath} from './src/tex-convert';",resolveDir:__dirname,loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const loaded=new Module(path.join(__dirname,'math-color-test.cjs'),module);loaded.paths=module.paths;loaded._compile(code,loaded.id);
const {EditorModel,convertMath,catalog}=loaded.exports;
const red=content=>`\\textcolor[RGB]{255,0,0}{${content}}`;
const blue=content=>`\\textcolor[RGB]{0,0,255}{${content}}`;
const select=(model,start,end,region=model.root)=>model.setCursor(region.id,end,start);
const colors=model=>[...model.nodes.values()].filter(node=>node.type==='textcolor');

test('color formatting is a hidden native wrapper, not a palette structure or pending font',()=>{
  const definition=catalog.find(entry=>entry.type==='textcolor');assert.equal(definition.hidden,true);assert.equal(definition.commandCandidate,false);
  const model=convertMath('x+y');assert.equal(model.canSetColor(),false);assert.equal(model.setColor('#ff0000'),false);
  for(const source of ['\\textnormal{abc}','\\ce{H2O}','\\future{x}']){
    const raw=convertMath(source),region=raw.root.items[0].regions[0];select(raw,0,region.items.length,region);
    assert.equal(raw.rawInput,true);assert.equal(raw.canSetColor(),false);assert.equal(raw.setColor('#ff0000'),false);
  }
  const empty=convertMath('');assert.equal(empty.canSetColor(),false);
  const standalone=convertMath('\\begin{align}x&=y\\end{align}');select(standalone,0,standalone.root.items.length);
  assert.equal(standalone.canSetColor(),false);
});

test('selected x changes color without changing adjacent +y or coloring future typing',()=>{
  const model=convertMath('x+y');select(model,0,1);const before=model.snapshot();
  assert.equal(model.canSetColor(),true);assert.equal(model.canResetColor(),false);assert.equal(model.setColor('#ff0000'),true);
  assert.equal(model.exportLatex(),red('x')+'+y');assert.deepEqual(model.range,[0,1]);assert.equal(model.cursor.region,model.root.id);
  assert.equal(model.pendingFont,undefined);const colored=model.snapshot();model.undo();assert.equal(model.snapshot(),before);
  model.redo();assert.equal(model.snapshot(),colored);model.move(1);model.insert('z');assert.equal(model.exportLatex(),red('x')+'z+y');
});

test('recoloring a selected fragment replaces its color, and default unwraps only it',()=>{
  const model=convertMath('x+y');select(model,0,1);model.setColor('#ff0000');model.setColor('#0000ff');
  assert.equal(colors(model).length,1);assert.equal(model.exportLatex(),blue('x')+'+y');assert.equal(model.canResetColor(),true);
  assert.equal(model.setColor(null),true);assert.equal(model.exportLatex(),'x+y');assert.deepEqual(model.range,[0,1]);assert.equal(model.canResetColor(),false);
  model.setColor('#000000');assert.equal(model.exportLatex(),'\\textcolor[RGB]{0,0,0}{x}+y');assert.equal(model.canResetColor(),true);
  model.setColor(null);assert.equal(model.exportLatex(),'x+y');
});

test('selection direction and nested mathematical content survive color and undo',()=>{
  const model=convertMath('a+\\frac{x}{y}+z');model.setCursor(model.root.id,2,3);
  const fraction=model.root.items[2],before=model.snapshot();model.setColor('#00ff00');
  assert.equal(model.cursor.offset,2);assert.equal(model.cursor.anchor,3);assert.equal(model.root.items[2].regions[0].items[0],fraction);
  assert.equal(model.exportLatex(),'a+\\textcolor[RGB]{0,255,0}{\\frac{x}{y}}+z');
  model.undo();assert.equal(model.snapshot(),before);model.redo();model.setColor(null);assert.equal(model.exportLatex(),'a+\\frac{x}{y}+z');
});

test('partial reset splits a colored sequence and keeps both surrounding colors',()=>{
  const model=convertMath('\\textcolor{red}{x+y}'),body=model.root.items[0].regions[0];select(model,1,2,body);
  assert.equal(model.canResetColor(),true);model.setColor(null);
  assert.equal(model.exportLatex(),'\\textcolor{red}{x}+\\textcolor{red}{y}');assert.equal(model.cursor.region,model.root.id);assert.deepEqual(model.range,[1,2]);
  model.setColor('#0000ff');assert.equal(model.exportLatex(),'\\textcolor{red}{x}'+blue('+')+'\\textcolor{red}{y}');
});

test('partial recolor does not accumulate wrappers and preserves unselected source colors',()=>{
  const model=convertMath('\\textcolor[rgb]{.8,0,0}{xyz}'),body=model.root.items[0].regions[0];select(model,1,2,body);
  model.setColor('#0000ff');assert.equal(model.exportLatex(),'\\textcolor[rgb]{.8,0,0}{x}'+blue('y')+'\\textcolor[rgb]{.8,0,0}{z}');
  model.setColor('#ff0000');assert.equal(colors(model).length,3);model.setColor(null);
  assert.equal(model.exportLatex(),'\\textcolor[rgb]{.8,0,0}{x}y\\textcolor[rgb]{.8,0,0}{z}');
});

test('nearest color can be changed or removed from a caret without moving it to another mathematical region',()=>{
  const model=convertMath('a+\\textcolor{red}{\\frac{x}{y}}+z'),wrapper=model.root.items[2],numerator=wrapper.regions[0].items[0].regions[0];
  model.setCursor(numerator.id,1);const cursor={...model.cursor};assert.equal(model.canSetColor(),true);
  model.setColor('#0000ff');assert.deepEqual(model.cursor,cursor);assert.equal(model.exportLatex(),'a+'+blue('\\frac{x}{y}')+'+z');
  model.setColor(null);assert.deepEqual(model.cursor,cursor);assert.equal(model.exportLatex(),'a+\\frac{x}{y}+z');
  const plain=convertMath('a+\\textcolor{red}{xyz}+b'),body=plain.root.items[2].regions[0];plain.setCursor(body.id,2);plain.setColor(null);
  assert.equal(plain.cursor.region,plain.root.id);assert.equal(plain.cursor.offset,4);assert.equal(plain.exportLatex(),'a+xyz+b');
});

test('partial inherited reset across a fraction is unavailable and never changes other glyph colors',()=>{
  const model=convertMath('\\textcolor{red}{\\frac{xy}{z}}'),numerator=model.root.items[0].regions[0].items[0].regions[0];select(model,0,1,numerator);
  assert.equal(model.canSetColor(),true);assert.equal(model.canResetColor(),false);const before=model.snapshot(),history=model.undoStack.length;
  assert.equal(model.setColor(null),false);assert.equal(model.snapshot(),before);assert.equal(model.undoStack.length,history);
  model.setColor('#0000ff');assert.equal(model.exportLatex(),'\\textcolor{red}{\\frac{'+blue('x')+'y}{z}}');
  assert.equal(model.canResetColor(),true,'The newly added explicit blue color can be removed independently.');
  model.setColor(null);assert.equal(model.exportLatex(),'\\textcolor{red}{\\frac{xy}{z}}');assert.equal(model.canResetColor(),false);
});

test('nested color-only scopes split without losing the outer color of unselected siblings',()=>{
  const model=convertMath('\\textcolor{red}{a\\textcolor{blue}{xy}b}'),inner=model.root.items[0].regions[0].items[1].regions[0];select(model,0,1,inner);
  model.setColor(null);assert.equal(model.exportLatex(),'\\textcolor{red}{a}x\\textcolor{red}{\\textcolor{blue}{y}b}');
  assert.deepEqual(model.range,[1,2]);
});

test('MathJax RGB/rgb/gray and named textcolor import as editable math, with exact color parameters',()=>{
  for(const source of [red('x+\\frac{a}{b}'),String.raw`\textcolor[rgb]{0.1, .2,1}{x}`,String.raw`\textcolor[gray]{ .5 }{x}`,String.raw`\textcolor[named]{RoyalBlue}{x}`,String.raw`\textcolor{myCustomColor}{x}`]){
    const model=convertMath(source);assert.equal(model.root.items[0].type,'textcolor');assert.equal(model.exportLatex(),source);
    const restored=new EditorModel();restored.restore(model.snapshot());assert.equal(restored.exportLatex(),source);
    assert.equal(convertMath(restored.exportLatex()).exportLatex(),source);
  }
  assert.equal(convertMath(String.raw`\textcolor{red}x`).exportLatex(),String.raw`\textcolor{red}{x}`);
});

test('unknown definitions, unsupported color models, and incomplete color syntax retain their source',()=>{
  for(const source of [String.raw`\definecolor{custom}{rgb}{.1,.2,.3}\textcolor{custom}{x}+y`,String.raw`\textcolor[HTML]{FF0000}{x}`,String.raw`\textcolor[RGB]{256,0,0}{x}`,String.raw`\textcolor[rgb]{.1,2,0}{x}`,String.raw`\textcolor{red}{x`,String.raw`\textcolor{red!50!blue}{x}`]){
    assert.equal(convertMath(source).exportLatex(),source);
  }
});

test('snapshots reject missing or forged color options before replacing a valid formula',()=>{
  const model=convertMath(red('x')),before=model.snapshot();
  for(const color of [undefined,{model:'HTML',value:'ff0000'},{model:'RGB',value:'256,0,0'},{model:'gray',value:'NaN'},{model:'named',value:'red}{x}'}]){
    const data=JSON.parse(before);data.root.items[0].texColor=color;
    assert.throws(()=>model.restore(JSON.stringify(data)));assert.equal(model.snapshot(),before);
  }
  select(model,0,1);assert.equal(model.setColor('red'),false);assert.equal(model.setColor('#fff'),false);assert.equal(model.undoStack.length,0);
});

test('copying inside a colored sequence preserves inherited color in native fragments and TeX',()=>{
  const model=convertMath('\\textcolor{red}{a+\\frac{xy}{z}}'),numerator=model.root.items[0].regions[0].items[2].regions[0];select(model,0,1,numerator);
  assert.equal(model.selectionLatex(),'\\textcolor{red}{x}');
  const copy=new EditorModel();copy.restore(model.selectionSnapshot());assert.equal(copy.exportLatex(),'\\textcolor{red}{x}');
  const target=convertMath('a+b');select(target,0,1);target.replaceFragment(copy.root.items);assert.equal(target.exportLatex(),'\\textcolor{red}{x}+b');
  target.undo();assert.equal(target.exportLatex(),'a+b');target.redo();assert.equal(target.exportLatex(),'\\textcolor{red}{x}+b');
});

test('recoloring a selected nested structure retains contents and replaces nested explicit colors',()=>{
  const model=convertMath('\\frac{\\textcolor{red}{x}}{\\textcolor{blue}{y}}');select(model,0,1);model.setColor('#ff0000');
  assert.equal(model.exportLatex(),red('\\frac{x}{y}'));assert.equal(colors(model).length,1);
  model.setColor(null);assert.equal(model.exportLatex(),'\\frac{x}{y}');
});

test('foreground, background and border coexist and can be changed independently',()=>{
  const model=convertMath('x+y');select(model,0,1);model.setColor('#ff0000');
  model.setColor('#ffff00','background');model.setColor('#0000ff','border');
  const framed=String.raw`\bbox[0px,#FFFF00,outline:1px solid #0000FF]{x}`;
  assert.equal(model.exportLatex(),red(framed)+'+y');assert.equal(model.canResetColor('background'),true);
  assert.equal(model.setColor(null,'background'),true);
  assert.equal(model.exportLatex(),red(String.raw`\bbox[0px,outline:1px solid #0000FF]{x}`)+'+y');
  assert.equal(model.root.items[0].texBackground,undefined);model.setColor('#ffff00','background');
  model.setColor('#00ff00','text');assert.equal(model.exportLatex(),'\\textcolor[RGB]{0,255,0}{'+framed+'}+y');
  model.setColor('#eeeeee','background');assert.match(model.exportLatex(),/\\bbox\[0px,#EEEEEE,outline:1px solid #0000FF\]/);assert.match(model.exportLatex(),/\\textcolor\[RGB\]\{0,255,0\}/);
  model.setColor(null,'border');assert.equal(model.exportLatex(),'\\textcolor[RGB]{0,255,0}{\\bbox[0px,#EEEEEE]{x}}+y');
  assert.equal(model.canResetColor('background'),true);model.setColor(null,'background');assert.equal(model.exportLatex(),'\\textcolor[RGB]{0,255,0}{x}+y');
  model.setColor(null);assert.equal(model.exportLatex(),'x+y');
});

test('new mathematical borders have no fill and later typing stays outside the decoration',()=>{
  const model=convertMath('x+y');select(model,0,1);model.setColor('#ff0000','border');
  assert.equal(model.exportLatex(),String.raw`\bbox[0px,outline:1px solid #FF0000]{x}+y`);
  assert.equal(model.root.items[0].texBackground,undefined);
  model.setColor('#0000ff','border');assert.equal([...model.nodes.values()].filter(node=>node.type==='math-decoration').length,1);
  assert.equal(model.root.items[0].texBackground,undefined);model.move(1);model.insert('z');assert.equal(model.exportLatex(),String.raw`\bbox[0px,outline:1px solid #0000FF]{x}z+y`);
});

test('mathematical decorations preserve nested mathematical objects, caret, snapshots and undo',()=>{
  const model=convertMath('a+\\frac{x}{y}+z');select(model,2,3);const before=model.snapshot(),fraction=model.root.items[2];
  model.setColor('#ffff00','background');const after=model.snapshot();assert.equal(model.root.items[2].regions[0].items[0],fraction);
  const restored=new EditorModel();restored.restore(after);assert.equal(restored.exportLatex(),model.exportLatex());
  model.undo();assert.equal(model.snapshot(),before);model.redo();assert.equal(model.snapshot(),after);
  const numerator=model.root.items[2].regions[0].items[0].regions[0];model.setCursor(numerator.id,1);const cursor={...model.cursor};
  model.setColor('#ff0000','text');assert.deepEqual(model.cursor,cursor);assert.match(model.exportLatex(),/\\textcolor\[RGB\]\{255,0,0\}/);
  model.setColor(null,'text');assert.deepEqual(model.cursor,cursor);assert.doesNotMatch(model.exportLatex(),/\\textcolor/);assert.match(model.exportLatex(),/\\bbox/);
  model.setColor(null,'background');assert.deepEqual(model.cursor,cursor);assert.equal(model.exportLatex(),'a+\\frac{x}{y}+z');
});

test('a box cannot lose background on only part of its contents',()=>{
  const model=convertMath(String.raw`\colorbox{yellow}{$xyz$}`),body=model.root.items[0].regions[0];select(model,1,2,body);
  assert.equal(model.canResetColor('background'),false);const before=model.snapshot();assert.equal(model.setColor(null,'background'),false);assert.equal(model.snapshot(),before);
  select(model,0,3,body);assert.equal(model.canResetColor('background'),true);model.setColor(null,'background');assert.equal(model.exportLatex(),'xyz');assert.deepEqual(model.range,[0,3]);
});

test('copy inside a box retains background, frame and nearest foreground without copying siblings',()=>{
  const model=convertMath(String.raw`\textcolor{red}{\fcolorbox{blue}{yellow}{$\textstyle x+\frac{ab}{c}$}}`);
  const box=model.root.items[0].regions[0].items[0],numerator=box.regions[0].items[2].regions[0];select(model,0,1,numerator);
  const expected=String.raw`\textcolor{red}{\fcolorbox{blue}{yellow}{$\textstyle a$}}`;
  assert.equal(model.selectionLatex(),expected);const fragment=new EditorModel();fragment.restore(model.selectionSnapshot());assert.equal(fragment.exportLatex(),expected);
  const target=convertMath('z');target.setCursor(target.root.id,1);target.replaceFragment(fragment.root.items);assert.equal(target.exportLatex(),'z'+expected);
});

test('native mathematical boxes import their actual style while text and mixed bodies stay source',()=>{
  for(const source of [String.raw`\colorbox{yellow}{$\frac{x}{y}$}`,String.raw`\colorbox[rgb]{1,.5,0}{$\displaystyle \frac{x}{y}$}`,String.raw`\fcolorbox[RGB]{12,34,56}[gray]{.5}{$\scriptstyle x$}`]){
    const model=convertMath(source);assert.ok(['colorbox','fcolorbox'].includes(model.root.items[0].type));assert.equal(model.exportLatex(),source);
  }
  for(const source of [String.raw`\colorbox{yellow}{roman text}`,String.raw`\colorbox{yellow}{text $x$ and more}`,String.raw`\fcolorbox{red}{yellow}{\frac{x}{y}}`]){
    const model=convertMath(source);assert.equal(model.root.items[0].type,'source-tex');assert.equal(model.exportLatex(),source);
  }
});

test('native framed boxes retain their text-mode semantics and required background after editing',()=>{
  const source=String.raw`\fcolorbox{blue}{yellow}{$\displaystyle \frac{x}{y}$}`;
  const model=convertMath(source);select(model,0,1);
  assert.equal(model.root.items[0].type,'fcolorbox');assert.equal(model.exportLatex(),source);
  assert.equal(model.canResetColor('background'),false);
  const before=model.snapshot();assert.equal(model.setColor(null,'background'),false);assert.equal(model.snapshot(),before);
  model.setColor('#ff0000','border');assert.equal(model.root.items[0].type,'fcolorbox');
  assert.equal(model.exportLatex(),String.raw`\fcolorbox[RGB]{255,0,0}[named]{yellow}{$\displaystyle \frac{x}{y}$}`);
  model.setColor(null,'border');assert.equal(model.root.items[0].type,'colorbox');
  assert.equal(model.exportLatex(),String.raw`\colorbox{yellow}{$\displaystyle \frac{x}{y}$}`);
});

test('copy and recolor retain nested background and border-only decorations',()=>{
  const model=convertMath(String.raw`\bbox[0px,#FFFF00]{\bbox[0px,outline:1px solid #FF0000]{ab}+c}`);
  const outer=model.root.items[0],inner=outer.regions[0].items[0],contents=inner.regions[0];
  select(model,0,1,contents);
  const expected=String.raw`\bbox[0px,#FFFF00]{\bbox[0px,outline:1px solid #FF0000]{a}}`;
  assert.equal(model.selectionLatex(),expected);
  const copied=new EditorModel();copied.restore(model.selectionSnapshot());assert.equal(copied.exportLatex(),expected);
  model.setCursor(contents.id,1);model.setColor('#0000ff','border');
  assert.equal(inner.texBorder.value,'0,0,255');assert.equal(outer.texBorder,undefined);
  assert.equal(outer.texBackground.value,'255,255,0');assert.equal(inner.texBackground,undefined);
});

test('mathematical decorations survive snapshots and LaTeX round trips as editable structures',()=>{
  const withoutIds=node=>JSON.parse(JSON.stringify(node,(key,value)=>key==='id'?undefined:value));
  for(const fixture of [
    {background:'#ffff00',expected:String.raw`\bbox[0px,#FFFF00]{\frac{x}{y}}`},
    {border:'#ff0000',expected:String.raw`\bbox[0px,outline:1px solid #FF0000]{\frac{x}{y}}`},
    {background:'#ffff00',border:'#0000ff',foreground:'#ff0000',expected:red(String.raw`\bbox[0px,#FFFF00,outline:1px solid #0000FF]{\frac{x}{y}}`)}
  ]){
    const model=convertMath(String.raw`\frac{x}{y}`);select(model,0,1);
    if(fixture.foreground)model.setColor(fixture.foreground);
    if(fixture.background)model.setColor(fixture.background,'background');
    if(fixture.border)model.setColor(fixture.border,'border');
    assert.equal(model.root.items[0].type,'math-decoration');assert.equal(model.root.items[0].texBoxStyle,undefined);
    assert.equal(model.exportLatex(),fixture.expected);
    const restored=new EditorModel();restored.restore(model.snapshot());assert.equal(restored.snapshot(),model.snapshot());
    const converted=convertMath(model.exportLatex());assert.equal(converted.exportLatex(),fixture.expected);
    assert.deepEqual(withoutIds(converted.root.items),withoutIds(model.root.items));
    const numerator=converted.root.items[0].regions[0].items[0].regions[0];converted.setCursor(numerator.id,1);converted.insert('z');
    assert.match(converted.exportLatex(),/\\frac\{xz\}\{y\}/);
  }
});

test('copying inside mathematical decorations retains all colors and excludes surrounding siblings',()=>{
  for(const borderOnly of [false,true]){
    const model=convertMath(String.raw`x+\frac{ab}{c}`);select(model,0,model.root.items.length);
    model.setColor('#ff0000');if(!borderOnly)model.setColor('#ffff00','background');model.setColor('#0000ff','border');
    const decoration=model.root.items[0],numerator=decoration.regions[0].items[2].regions[0];select(model,0,1,numerator);
    const expected=red(borderOnly?String.raw`\bbox[0px,outline:1px solid #0000FF]{a}`:String.raw`\bbox[0px,#FFFF00,outline:1px solid #0000FF]{a}`);
    assert.equal(model.selectionLatex(),expected);
    const copied=new EditorModel();copied.restore(model.selectionSnapshot());assert.equal(copied.exportLatex(),expected);
    assert.equal(copied.root.items[0].type,'math-decoration');assert.equal(!!copied.root.items[0].texBackground,!borderOnly);
    assert.equal(convertMath(model.selectionLatex()).exportLatex(),expected);
    const target=convertMath('z');target.setCursor(target.root.id,1);target.replaceFragment(copied.root.items);assert.equal(target.exportLatex(),'z'+expected);
    target.undo();assert.equal(target.exportLatex(),'z');target.redo();assert.equal(target.exportLatex(),'z'+expected);
  }
});

test('mathematical decoration snapshots reject empty or invalid channel metadata',()=>{
  const model=convertMath('x');select(model,0,1);model.setColor('#ff0000','border');const before=model.snapshot();
  for(const corrupt of [
    node=>delete node.texBorder,
    node=>node.texBorder={model:'RGB',value:'256,0,0'},
    node=>node.texBackground={model:'RGB',value:'0,-1,0'},
    node=>node.texColor={model:'HTML',value:'FF0000'},
    node=>node.texBoxStyle='textstyle'
  ]){
    const data=JSON.parse(before);corrupt(data.root.items[0]);
    assert.throws(()=>model.restore(JSON.stringify(data)));assert.equal(model.snapshot(),before);
  }
  model.setColor('#ffff00','background');model.setColor(null,'border');assert.equal(model.root.items[0].type,'math-decoration');
  assert.equal(model.root.items[0].texBorder,undefined);model.setColor(null,'background');assert.equal(model.exportLatex(),'x');
});

test('color declarations cover the remainder of their own group, argument and table cell',()=>{
  const fixtures=[
    [String.raw`x\color{red}y+z`,String.raw`x\textcolor{red}{y+z}`],
    [String.raw`{\color{red}x}+y`,String.raw`{\textcolor{red}{x}}+y`],
    [String.raw`\color{red}{x}+y`,String.raw`\textcolor{red}{{x}+y}`],
    [String.raw`{\color{red}x\color{blue}y}z`,String.raw`{\textcolor{red}{x\textcolor{blue}{y}}}z`],
    [String.raw`\frac{\color{red}a+b}{c+d}+z`,String.raw`\frac{\textcolor{red}{a+b}}{c+d}+z`],
    [String.raw`\begin{aligned}\color{red}a&=b\\c&=d\end{aligned}`,String.raw`\begin{aligned}\textcolor{red}{a}&=b\\c&=d\end{aligned}`]
  ];
  for(const [source,expected]of fixtures)assert.equal(convertMath(source).exportLatex(),expected);
  for(const source of [String.raw`\color{red}\definecolor{custom}{rgb}{.1,.2,.3}\textcolor{custom}{x}`,String.raw`\left(\color{red}x\right)+z`,String.raw`\left(\color{red}x\middle|y\right)`,String.raw`\bigl(\color{red}x\bigr)+z`,String.raw`\sin(\color{red}x)+z`,String.raw`{\color{red}x\atop y}+z`]){
    const model=convertMath(source);assert.equal(model.root.items[0].type,'source-tex');assert.equal(model.exportLatex(),source);
  }
});

test('box metadata is validated and cannot be attached to unrelated structures',()=>{
  const model=convertMath(String.raw`\colorbox{red}{$x$}`),before=model.snapshot();
  for(const corrupt of [node=>delete node.texBackground,node=>node.texBackground={model:'RGB',value:'999,0,0'},node=>node.texBorder={model:'',value:'red'},node=>node.texBoxStyle='unknown']){
    const data=JSON.parse(before);corrupt(data.root.items[0]);assert.throws(()=>model.restore(JSON.stringify(data)));assert.equal(model.snapshot(),before);
  }
  const ordinary=convertMath(String.raw`\frac{x}{y}`),data=JSON.parse(ordinary.snapshot());data.root.items[0].texBackground={model:'',value:'red'};assert.throws(()=>ordinary.restore(JSON.stringify(data)));
});

test('source confirmation is part of the last keystroke and leaves the caret after a bounded color command',()=>{
  const model=convertMath('a+b');model.setCursor(model.root.id,1);
  for(const ch of String.raw`\textcolor{red}{x`)model.replaceInput(...model.range,ch);
  const before=model.snapshot();model.replaceInput(...model.range,'}');const recorded=model.undoStack.length;
  const converted=convertMath(model.projection()),sourceSnapshot=converted.snapshot(),convertedIds=new Set(converted.nodes.keys());
  assert.equal(model.commitSourceInput(converted.root.items),true);assert.equal(model.undoStack.length,recorded);
  assert.equal(model.exportLatex(),String.raw`a\textcolor{red}{x}+b`);assert.equal(model.cursor.region,model.root.id);assert.equal(model.cursor.offset,2);
  assert.equal(converted.snapshot(),sourceSnapshot);assert.equal([...model.nodes.keys()].some(id=>convertedIds.has(id)),false);
  const after=model.snapshot();model.undo();assert.equal(model.snapshot(),before);model.redo();assert.equal(model.snapshot(),after);
  model.replaceInput(...model.range,'z');assert.equal(model.exportLatex(),String.raw`a\textcolor{red}{x}z+b`);
});

test('source declaration confirmation colors the old suffix without replacing its node identities',()=>{
  const model=convertMath(String.raw`a+\frac{b}{c}`),fraction=model.root.items[2],fractionId=fraction.id,denominatorId=fraction.regions[1].id;
  model.setCursor(model.root.id,1);for(const ch of String.raw`\color{red}xy`)model.replaceInput(...model.range,ch);
  const before=model.snapshot(),recorded=model.undoStack.length,converted=convertMath(model.projection());
  assert.equal(model.commitSourceInput(converted.root.items,true),true);assert.equal(model.undoStack.length,recorded);
  assert.equal(model.exportLatex(),String.raw`a\textcolor{red}{xy+\frac{b}{c}}`);
  assert.equal(model.current,model.root.items[1].regions[0]);assert.equal(model.cursor.offset,2);
  assert.equal(model.current.items[3],fraction);assert.equal(model.nodes.get(fractionId),fraction);assert.equal(model.regions.get(denominatorId),fraction.regions[1]);
  const after=model.snapshot();model.replaceInput(...model.range,'z');assert.equal(model.exportLatex(),String.raw`a\textcolor{red}{xyz+\frac{b}{c}}`);
  model.undo();assert.equal(model.snapshot(),after);
  // Confirmation itself adds no extra undo stop with the completed raw source.
  model.undo();assert.notEqual(model.snapshot(),before);assert.equal(model.projection(),String.raw`\color{red}x`);
});

test('a declaration completed after its color parameter enters the empty run before the old suffix',()=>{
  const model=convertMath('x+y');model.setCursor(model.root.id,1);
  for(const ch of String.raw`\color{blue`)model.replaceInput(...model.range,ch);const before=model.snapshot();
  model.replaceInput(...model.range,'}');assert.equal(model.commitSourceInput(convertMath(model.projection()).root.items,true),true);
  assert.equal(model.cursor.offset,0);assert.equal(model.projection(),'+y');model.replaceInput(...model.range,'z');
  assert.equal(model.exportLatex(),String.raw`x\textcolor{blue}{z+y}`);model.undo();model.undo();assert.equal(model.snapshot(),before);
});

test('declaration confirmation respects numerator, denominator and surrounding formula boundaries',()=>{
  const model=convertMath(String.raw`\frac{a+b}{c+\sqrt{d}}+z`),fraction=model.root.items[0],numerator=fraction.regions[0],denominator=fraction.regions[1],radical=denominator.items[2];
  model.setCursor(denominator.id,1);for(const ch of String.raw`\color{blue}`)model.replaceInput(...model.range,ch);
  assert.equal(model.commitSourceInput(convertMath(model.projection()).root.items,true),true);model.replaceInput(...model.range,'x');
  assert.equal(model.exportLatex(),String.raw`\frac{a+b}{c\textcolor{blue}{x+\sqrt{d}}}+z`);
  assert.equal(fraction.regions[0],numerator);assert.equal(model.current.items[2],radical);assert.equal(model.root.items.at(-1),'z');
});

test('source confirmation rejects invalid state or fragments without changing content, cursor or history',()=>{
  const color=convertMath(String.raw`\textcolor{red}{x}`).root.items;
  const unchanged=(model,items=color,declaration=false)=>{
    const before=model.snapshot(),undos=[...model.undoStack],redos=[...model.redoStack];
    assert.equal(model.commitSourceInput(items,declaration),false);assert.equal(model.snapshot(),before);assert.deepEqual(model.undoStack,undos);assert.deepEqual(model.redoStack,redos);
  };
  unchanged(convertMath('x'));
  const text=convertMath(String.raw`\textnormal{abc}`);text.setCursor(text.root.items[0].regions[0].id,3);unchanged(text);
  const model=convertMath('');for(const ch of String.raw`\textcolor{red}{x}`)model.replaceInput(...model.range,ch);
  const raw=model.current;model.setCursor(raw.id,raw.items.length-1);unchanged(model);
  model.setCursor(raw.id,raw.items.length,raw.items.length-1);unchanged(model);
  model.setCursor(raw.id,raw.items.length);
  for(const invalid of [[],[{}],[color[0],color[0]],convertMath(String.raw`\begin{align}x&=y\end{align}`).root.items])unchanged(model,invalid);
  unchanged(model,['x'],true);unchanged(model,[...color,'x'],true);unchanged(model,convertMath(String.raw`\frac{x}{y}`).root.items,true);
  const forged=JSON.parse(JSON.stringify(color));delete forged[0].texColor;unchanged(model,forged);
  const cyclic=[];cyclic.push(cyclic);unchanged(model,cyclic);
});

test('imported colors and their script scope retain native MathJax MathML',async()=>{
  const {pathToFileURL}=require('node:url');
  const root=pathToFileURL(path.dirname(require.resolve('mathjax/node-main.cjs'))+'/').href.replace(/\/$/,'');
  const mathjax=await require('mathjax').init({loader:{paths:{mathjax:root},load:['input/tex','[tex]/color']},tex:{packages:{'[+]':['color']}},startup:{typeset:false}});
  const mml=async source=>{
    const result=await mathjax.tex2mmlPromise(source,{display:false});assert.doesNotMatch(result,/<merror\b/,source);
    return result.replace(/\sdata-latex(?:-[\w-]+)?="[^"]*"/g,'').replace(/>\s+</g,'><').trim();
  };
  for(const source of [String.raw`a\textcolor{red}{+}b`,String.raw`\textcolor[RGB]{20,40,90}{x+y}^{2}`,String.raw`\textcolor[rgb]{.1,.2,.3}{\frac{x}{y}}`,String.raw`\textcolor[gray]{.5}{x}_{i}`,String.raw`\textcolor{red}{x\textcolor{blue}{y}z}`,String.raw`\color{red}{x}+y`,String.raw`\colorbox{yellow}{$\textstyle \frac{x}{y}$}`,String.raw`\fcolorbox[RGB]{214,39,40}[rgb]{0,1,0}{$\frac{x}{y}$}`]){
    assert.equal(await mml(convertMath(source).exportLatex()),await mml(source),source);
  }
});
