const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {pathToFileURL}=require('node:url');
const {build}=require('esbuild');

test('the actual editor region renderer preserves MathJax alignment and argument lookahead',async t=>{
  // Initialize the actual local MathJax Node loader before adding the DOM used
  // by the editor. There are no network resources or rendering stand-ins.
  const policyBundle=await build({stdin:{contents:"export * from './src/mathjax-extension-policy';export {installUnicodeFonts} from './src/mathjax-unicode-fonts';export {installMathDelimiters} from './src/install-math-delimiters';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false});
  const policyModule=new Module(path.resolve('.mathjax-editor-render-policy-test.cjs'),module);policyModule.paths=module.paths;policyModule._compile(policyBundle.outputFiles[0].text,policyModule.id);
  const policy=policyModule.exports,url=directory=>pathToFileURL(path.resolve(directory)).href,plain=value=>JSON.parse(JSON.stringify(value));
  const runtime=await require('mathjax').init({
    loader:{paths:{mathjax:url('node_modules/mathjax'),fonts:url('node_modules/@mathjax'),'mathjax-bboldx-extension':url('node_modules/@mathjax/mathjax-bboldx-font-extension')},load:['input/tex','output/chtml',...policy.mathJaxExtensionLoads]},
    tex:{packages:{'[+]':plain(policy.mathJaxTexPackages),'[-]':plain(policy.mathJaxDisabledTexPackages)},require:plain(policy.mathJaxRequireOptions),textmacros:{packages:{'[+]':['textcomp']}},tags:'cases',mathStyle:'TeX',mathStyleGreekLC:true,mathStyleMathAlphabets:true},
    startup:{typeset:false,output:'chtml',ready(){policy.installUnicodeFonts(globalThis.MathJax._);policy.installMathDelimiters(globalThis.MathJax._);globalThis.MathJax.startup.defaultReady();}}
  });
  const {Window}=await import('happy-dom'),window=new Window({url:'http://localhost/'});
  window.document.write('<!doctype html><html><body><div id="preview"><div id="textFlow"><span id="formula"></span></div><textarea id="mathInput" hidden></textarea></div><div id="mathPanel"><div id="insertToolbar"></div><div class="document-actions"><select id="formulaLayout"></select></div></div><div id="error"></div><div id="pendingFontHint"></div><div id="structureCount"></div></body></html>');
  for(const key of ['innerWidth','innerHeight','window','document','navigator','sessionStorage','localStorage','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','HTMLDialogElement','Document','DocumentFragment','MutationObserver','ResizeObserver','DOMParser','Range','Event','CustomEvent','KeyboardEvent','ClipboardEvent','DOMRect','HTMLDivElement','HTMLSpanElement','NodeFilter','ShadowRoot'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  globalThis.getComputedStyle=window.getComputedStyle.bind(window);globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);window.ready=false;
  // The browser API returns a native DOM node. Node MathJax's LiteAdaptor
  // returns its own tree instead; parse the actual CHTML into HappyDOM without
  // changing the TeX parser, rendering, errors or the production preflight.
  const chtml=runtime.tex2chtmlPromise.bind(runtime);
  runtime.tex2chtmlPromise=async(...args)=>new DOMParser().parseFromString(runtime.startup.adaptor.outerHTML(await chtml(...args)),'text/html').body.firstElementChild;
  const result=await build({stdin:{contents:"export {regionTex,prepareRegionTex,renderFormulaDocument} from './src/editor-ui';export {convertMath} from './src/tex-convert';export {EditorModel,catalog,symbols} from './src/editor-model';export {formulaEntries,formulaLayouts} from './src/formula-layouts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'actual-region-renderer-export',setup(builder){
    builder.onLoad({filter:/src[\\/]editor-ui\.ts$/},args=>{
      let source=fs.readFileSync(args.path,'utf8');
      if(process.env.MATHJAX_EDITOR_REPRO_GROUPED_CASES==='1'){
        const before=source;source=source.replace(/  \/\/ A numbered-cases body[\s\S]*?(?=  const descriptive=)/,'');assert.notEqual(source,before,'Reproduce the previous grouped cases-body rendering in memory');
      }
      return {contents:source+`
export {regionTex};
export async function prepareRegionTex(editor:EditorModel){model=editor;await validateChemistry();}
export async function renderFormulaDocument(editors:EditorModel[],active=-1){
  const previous={flow,model,formula,editing};
  const mount=elementById('textFlow',HTMLElement);
  const entries=editors.map((editor,index)=>{const element=document.createElement('span');element.dataset.mathId='test-'+index;element.dataset.display='true';element.dataset.numbered='true';mount.append(element);return {element,model:editor};});
  flow={entries:()=>entries,isDisplay:()=>true,isNumbered:()=>true} as DocumentHost;
  model=editors[Math.max(0,active)];formula=entries[Math.max(0,active)].element;editing=active>=0;
  try{await renderCurrent();if(lastRenderFailure)throw lastRenderFailure;return entries.map(entry=>entry.element.outerHTML);}
  finally{for(const entry of entries)entry.element.remove();({flow,model,formula,editing}=previous);}
}
`,loader:'ts',resolveDir:path.dirname(args.path)};
    });
  }}]});
  const compiled=new Module(path.resolve('.mathjax-editor-render-test.cjs'),module);compiled.paths=module.paths;const originalTimeout=globalThis.setTimeout;
  globalThis.setTimeout=(callback,delay,...args)=>{const timer=originalTimeout(callback,delay,...args);if(delay===10000)timer.unref();return timer;};
  try{compiled._compile(result.outputFiles[0].text,compiled.id);}finally{globalThis.setTimeout=originalTimeout;}
  const api=compiled.exports;
  await t.test('component buttons and their variants never create equation numbers',async()=>{
    const visible=[...api.catalog,...api.symbols].filter(entry=>!entry.hidden&&!entry.legacy);
    assert.equal(document.querySelector('#insertToolbar button[data-insert="multlined"]'),null,'The unsupported numbered multlined preview is not an insertion button');
    const commandModel=new api.EditorModel();commandModel.root.items=[];commandModel.index();commandModel.setCursor(commandModel.root.id,0);commandModel.insert('\\multli');
    assert.equal(commandModel.commandCandidates().some(entry=>entry.name==='multlined'),false,'The same retired component must not remain in command completion');
    assert.equal(api.formulaEntries.find(entry=>entry.kind==='multline')?.defaultType,'formula-multline','Long equations remain available through the whole-formula entry');
    assert.ok(visible.some(entry=>entry.type==='aligned')&&visible.some(entry=>entry.type==='gathered'),'Ordinary unnumbered inner alignment structures remain components');
    for(const entry of visible){
      const sample=entry.atom?entry.tex:entry.render(entry.previewArgs||entry.labels.map(()=>String.raw`\class{math-placeholder}{\phantom{0}}`));
      runtime.texReset(0);
      const output=await runtime.tex2mmlPromise('\\displaystyle '+sample,{display:false});
      assert.doesNotMatch(output,/<merror\b/,'The visible component or variant must render: '+entry.type+'\n'+sample+'\n'+output);
      assert.doesNotMatch(output,/<mlabeledtr\b|id="mjx-eqn:/,'A component or its variant cannot create a formula number: '+entry.type+'\n'+sample);
    }
  });
  const samples=[
    ['numbered cases',String.raw`\begin{numcases}{f(x)=}x&positive\\-x&otherwise\end{numcases}`],
    ['subnumbered cases',String.raw`\begin{subnumcases}{f(x)=}\frac{a}{b}&positive\\\sqrt{x}&otherwise\end{subnumcases}`],
    ['numbered cases mixed condition',String.raw`\begin{numcases}{f(x)=}x&if $x\le0$ 中文\\-x&otherwise $x>0$ 其他\end{numcases}`],
    ['subnumbered cases mixed condition',String.raw`\begin{subnumcases}{g(x)=}\frac{a}{b}&if $\alpha\le0$ 中文\\\sqrt{x}&otherwise $x>0$ 其他\end{subnumcases}`],
    ['large operator scripts',String.raw`\sum_{n=0}^{N}a_n`],
    ['operator without limits',String.raw`\sum x+\int f(x)`],
    ['forced operator limits',String.raw`\prod\limits_{n=0}^{N}a_n`],
    ['sideset operator',String.raw`\sideset{_{a}^{b}}{_{c}^{d}}\prod x`],
    ['derivative lookahead',String.raw`\dv[2]{x}{t}`],
    ['partial derivative lookahead',String.raw`\pdv{x}{y}{z}`],
    ['physics nested delimiter',String.raw`\qty(\frac{a}{b}+x)`],
    ['physics inner product',String.raw`\braket{a}{b}`],
    ['physics expectation',String.raw`\expval{\frac{a}{b}}`],
    ['physics principal values',String.raw`\pv \int f(x)+\PV \int f(x)`],
    ['physics residue fences',String.raw`\Res[\frac{a}{b}]+\Res{\frac{c}{d}}`],
    ['nested fraction and indexed radical',String.raw`\frac{\sqrt[3]{x+1}}{a+\frac{b}{c}}`],
    ['native aligned grid',String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`],
    ['native matrix grid',String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`],
    ['native cases grid',String.raw`\begin{cases}x&x>0\\-x&x<0\end{cases}`],
    ['layout wrappers',String.raw`\mathrel{\frac{a}{b}}+\smash[t]{x}+\phantom{y}`],
    ['mathchoice',String.raw`\mathchoice{a}{b}{c}{d}`],
    ['prescript',String.raw`\prescript{a}{b}{x}`],
    ['descriptive text',String.raw`\textnormal{eq 中文 \% \_}`],
    ['long arrow',String.raw`\xrightarrow[n]{m}`]
  ];
  for(const [name,source] of samples)await t.test(name,async()=>{
    runtime.texReset();const baseline=await runtime.tex2mmlPromise(source,{display:true});assert.doesNotMatch(baseline,/<merror\b/,'The original fixture must be valid MathJax source: '+source+'\n'+baseline);
    const model=api.convertMath(source);assert.equal([...model.nodes.values()].some(node=>node.type==='source-tex'),false,'This sample must exercise native rendering, rather than show escaped source as text: '+source);
    await api.prepareRegionTex(model);
    const rendered=api.regionTex(model.root,model,false);assert.match(rendered,/\\class\{math-region region-/);assert.match(rendered,/\\class\{math-item item-/);
    // tex2mml accepts the math body, whereas the document renderer supplies
    // display delimiters. Retain that actual \[...\] envelope for diagnostics.
    const display='\\['+rendered+'\\]';runtime.texReset();
    const output=await runtime.tex2mmlPromise(display.slice(2,-2),{display:true});
    assert.doesNotMatch(output,/<merror\b/,source+'\n'+display+'\n'+output);
    assert.match(output,/class="[^"]*math-region/,'MathJax must retain the editor region markers');assert.match(output,/class="[^"]*math-item/,'MathJax must retain the editor item markers');
    for(const tag of ['mfrac','msqrt','mroot','msub','msup','msubsup','munder','mover','munderover','mtable','mtr','mlabeledtr','mtd','mmultiscripts','menclose']){
      const pattern=new RegExp('<'+tag+'\\b','g'),count=value=>(value.match(pattern)||[]).length;
      assert.equal(count(output),count(baseline),'Editor class wrappers must preserve the '+tag+' structure of the original source');
    }
    if(name.includes('mixed condition')){
      const tokens=value=>{const result=[],names=new Set(['mi','mn','mo','mtext','ms']),visit=node=>{if(names.has(node.localName))result.push([node.localName,node.textContent]);for(const child of node.children??[])visit(child);};visit(new DOMParser().parseFromString(value,'text/xml').documentElement);return result;};
      assert.deepEqual(tokens(output),tokens(baseline),'Condition spaces, descriptive text and embedded math must retain their actual rendered tokens');
      assert.ok(tokens(output).some(([type,value])=>type==='mo'&&value==='≤'),'The condition contains a rendered mathematical inequality, not the characters of its source');
      assert.ok(tokens(output).some(([type,value])=>type==='mtext'&&value.includes('中文')));assert.ok(tokens(output).some(([type,value])=>type==='mtext'&&/if[\s\u00a0]/.test(value)),'The space after if remains in the text column');
      assert.ok([...model.nodes.values()].some(node=>node.type==='case-text'),'The description has its own raw text representation rather than unsupported source');
      assert.equal(model.exportLatex().replace(/\s*(&|\\\\)\s*/g,'$1'),source.replace(/\s*(&|\\\\)\s*/g,'$1'),'Export preserves embedded-math delimiters and condition text');
    }
    if(name.includes('cases')||name.includes('grid'))assert.match(output,/<mtable\b/,'The alignment remains a table, not flattened text');
  });
  // Exercise the document renderer itself, including its native numbering
  // reset for each formula. Only adapt Node MathJax's DOM boundary: the source
  // envelope, marker placement and counter seed all come from renderCurrent.
  const renderedDocuments=[];
  runtime.typesetClear=()=>{};
  runtime.typesetPromise=async elements=>{
    for(const element of elements){
      const envelope=element.textContent??'';
      if(!envelope.trim())continue;
      const inline=envelope.startsWith('\\(')&&envelope.endsWith('\\)');
      const bracket=envelope.startsWith('\\[')&&envelope.endsWith('\\]');
      const source=inline||bracket?envelope.slice(2,-2):envelope;
      const output=await runtime.tex2chtmlPromise(source,{display:!inline});
      element.replaceChildren(output);
      if(element.id==='renderStage')renderedDocuments.push({source,html:output.outerHTML});
    }
  };
  Object.defineProperty(document.getElementById('textFlow'),'clientWidth',{value:900,configurable:true});
  const visibleTags=html=>[...new DOMParser().parseFromString(html,'text/html').querySelectorAll('[id^="mjx-eqn:"]')]
    .filter(element=>!element.closest('mjx-mphantom'))
    .map(element=>decodeURIComponent(element.id.slice('mjx-eqn:'.length)));
  const blank=()=>{const model=new api.EditorModel();model.root.items=[];model.index();model.setCursor(model.root.id,0);return model;};
  const initialized=type=>{const model=blank();assert.equal(model.initializeFormula(type),true);return model;};
  const nextEquation=()=>{const model=blank();model.insert('k=1');return model;};
  await t.test('offered matrices and multiline blocks remain internal when nested inside a fraction',async()=>{
    const innerBlocks=api.catalog.filter(entry=>!entry.hidden&&!entry.legacy&&(entry.matrixEnvironment||entry.rowEnvironment));
    assert.ok(innerBlocks.some(entry=>entry.type==='aligned'));
    assert.ok(innerBlocks.some(entry=>entry.type==='gathered'));
    assert.ok(innerBlocks.some(entry=>entry.type==='cases'));
    assert.ok(innerBlocks.every(entry=>entry.scope!=='formula'),'Whole-formula entries do not belong to the component palette');
    for(const entry of innerBlocks){
      const model=blank();model.insert('q+');model.insertStructure('frac');
      const fraction=model.root.items[2];model.insertStructure(entry.type);
      const block=fraction.regions[0].items[0];
      assert.equal(block.type,entry.type);
      block.regions.forEach((cell,index)=>{model.setCursor(cell.id,0);model.insert(String.fromCharCode(97+index%26));});
      model.setCursor(fraction.regions[1].id,0);model.insert('z');
      model.setCursor(block.regions[0].id,1);
      const source=model.exportLatex();
      runtime.texReset(0);
      const native=await runtime.tex2mmlPromise(source,{display:false});
      assert.doesNotMatch(native,/<merror\b|<mlabeledtr\b|id="mjx-eqn:/,'The native inner block must be a valid unnumbered expression: '+entry.type+'\n'+source);
      await api.prepareRegionTex(model);
      runtime.texReset(0);
      const marked=await runtime.tex2mmlPromise(api.regionTex(model.root,model,true),{display:false});
      assert.doesNotMatch(marked,/<merror\b|<mlabeledtr\b|id="mjx-eqn:/,'Editing markers must not turn a nested block into a standalone display: '+entry.type);
      const tokens=mathml=>[...new DOMParser().parseFromString(mathml,'text/xml').querySelectorAll('mi,mn,mo,mtext')].map(element=>[element.localName,element.textContent]);
      assert.deepEqual(tokens(marked),tokens(native),'Nesting must preserve every cell and surrounding expression: '+entry.type);
      for(const tag of ['mfrac','mtable','mtr','mtd']){
        const count=mathml=>(mathml.match(new RegExp('<'+tag+'\\b','g'))||[]).length;
        assert.equal(count(marked),count(native),'The inner '+tag+' structure must remain intact: '+entry.type);
      }
      const output=await api.renderFormulaDocument([model,nextEquation()],0);
      assert.deepEqual(output.map(visibleTags),[['1'],['2']],'The containing equation alone owns its number: '+entry.type);
      assert.doesNotMatch(output.join(''),/mjx-merror/);
    }
  });
  const fill=model=>{
    const node=model.root.items[0],layout=model.formulaLayout().formula;
    if(layout.kind==='cases'){
      model.setCursor(node.regions[0].id,0);model.insert('Z=');
      const body=node.regions[1].items[0];
      body.regions.forEach((cell,index)=>{model.setCursor(cell.id,0);model.insert(index%2?'x>0':index?'y':'x');});
    }else node.regions.forEach((cell,index)=>{model.setCursor(cell.id,0);model.insert(layout.kind==='align'?(index%2?'=b':'a'):'x+y');});
  };
  for(const entry of api.formulaEntries)await t.test('empty whole-formula entry: '+entry.kind,async()=>{
    const model=initialized(entry.defaultType);
    const output=await api.renderFormulaDocument([model,nextEquation()]);
    assert.deepEqual(output.map(visibleTags),[['1'],['2']],'An empty entry owns exactly one number; the next document formula starts at two');
    assert.match(output[0],/math-placeholder/,'Empty editable slots remain visible');
    assert.doesNotMatch(output.join(''),/mjx-merror/);
  });
  for(const layout of api.formulaLayouts)await t.test('native document numbering: '+layout.type,async()=>{
    for(const content of ['empty','filled']){
      const model=initialized(layout.type);if(content==='filled')fill(model);
      renderedDocuments.length=0;
      const output=await api.renderFormulaDocument([model,nextEquation()]);
      const expected=layout.numbering==='none'?[]:layout.numbering==='rows'?['1','2']:layout.numbering==='subrows'?['1a','1b']:['1'];
      const next=layout.numbering==='none'?'1':layout.numbering==='rows'?'3':'2';
      assert.deepEqual(output.map(visibleTags),[expected,[next]],content+' '+layout.type+' must not acquire an extra outer tag');
      assert.doesNotMatch(output.join(''),/mjx-merror/,content+' '+layout.type);
      runtime.texReset(0);
      const exported=await runtime.tex2chtmlPromise(model.exportLatex(),{display:true});
      assert.doesNotMatch(exported.outerHTML,/mjx-merror/);
      assert.deepEqual(visibleTags(exported.outerHTML),expected,'The exported source must retain every real row and number, even an empty final row: '+model.exportLatex());
      // The first render is already a complete environment; the editor must
      // leave its numbering to MathJax rather than wrap it in another equation.
      assert.equal((renderedDocuments[0].source.match(/\\begin\{(?:equation|equation\*)\}/g)||[]).length,layout.environment.startsWith('equation')?1:0);
    }
  });
  await t.test('old separate lhs and numbered cases become one legal entry without duplicate document numbers',async()=>{
    const legacy=initialized('numcases'),node=legacy.root.items[0],body=node.regions[1].items[0];
    const originalIds=[node.id,...node.regions.map(region=>region.id),body.id,...body.regions.map(region=>region.id)];
    legacy.root.items=['Z','=',node];
    const snapshot=legacy.snapshot(),restored=blank();restored.restore(snapshot);
    const migrated=restored.root.items[0],migratedBody=migrated.regions[1].items[0];
    assert.deepEqual([migrated.id,...migrated.regions.map(region=>region.id),migratedBody.id,...migratedBody.regions.map(region=>region.id)],originalIds);
    assert.equal(restored.root.items.length,1);assert.deepEqual(migrated.regions[0].items,['Z','=']);
    const before=api.convertMath(String.raw`\begin{aligned}a&=x+y\\&+z+w\end{aligned}`);
    for(const position of [migrated.regions[0],migratedBody.regions[0],migratedBody.regions[2]]){
      restored.setCursor(position.id,0);
      const output=await api.renderFormulaDocument([before,restored,nextEquation()],1);
      assert.deepEqual(output.map(visibleTags),[['1'],['2','3'],['4']],'Moving the caret cannot add a tag or consume a number');
      assert.match(output[1],/math-caret/);
      assert.doesNotMatch(output.join(''),/mjx-merror/);
    }
  });
  await t.test('row edits and numbering changes keep the following document number correct',async()=>{
    for(const type of ['formula-align-rows','formula-gather-rows','numcases']){
      const model=initialized(type);fill(model);
      const node=model.root.items[0],table=type==='numcases'?node.regions[1].items[0]:node;
      assert.equal(model.editTable(table.id,table.regions[0].id,'rowAfter'),true);
      const inserted=await api.renderFormulaDocument([model,nextEquation()]);
      assert.deepEqual(inserted.map(visibleTags),[['1','2','3'],['4']],type+' inserted row');
      assert.equal(model.editTable(table.id,table.regions[table.columns].id,'deleteRow'),true);
      const deleted=await api.renderFormulaDocument([model,nextEquation()]);
      assert.deepEqual(deleted.map(visibleTags),[['1','2'],['3']],type+' deleted row');
    }
    const model=initialized('formula-cases');fill(model);const node=model.root.items[0];
    for(const [type,tags,next] of [
      ['numcases',['1','2'],'3'],['subnumcases',['1a','1b'],'2'],
      ['formula-cases-unnumbered',[],'1'],['formula-cases',['1'],'2'],
    ]){
      assert.equal(model.switchVariant(node.id,type),true);
      renderedDocuments.length=0;
      const output=await api.renderFormulaDocument([model,nextEquation()]);
      assert.deepEqual(output.map(visibleTags),[tags,[next]],'Switch to '+type);
      assert.doesNotMatch(output.join(''),/mjx-merror/);
      for(const source of [renderedDocuments[0].source,model.exportLatex()]){
        runtime.texReset(0);
        const mathml=await runtime.tex2mmlPromise(source,{display:true});
        const xml=new DOMParser().parseFromString(mathml,'text/xml');
        assert.ok([...xml.querySelectorAll('mo')].some(element=>element.textContent==='>'),'Numbering changes must keep the condition inequality mathematical, not turn it into descriptive text: '+type);
      }
    }
  });
  await window.happyDOM.close();
});
