const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const compiled=buildSync({stdin:{contents:`export * from './src/tex-import-environments'; export {EditorModel,structureTex} from './src/editor-model';`,resolveDir:__dirname},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const loaded={exports:{}};new Function('module','exports','require',compiled)(loaded,loaded.exports,require);
const api=loaded.exports;
let serial=20000000;
const region=items=>({id:'r'+ ++serial,label:'',items});
const factory=(type,regions,dimensions)=>({id:'n'+ ++serial,type,regions,...dimensions});
const raw=source=>region(source?[factory('source-tex',[region(Array.from(source))])]:[]);
const parse=source=>api.parseTexEnvironment(source,0,raw,factory);
const content=node=>api.structureTex(node,r=>r.items.map(item=>typeof item==='string'?item:content(item)).join(''));
const cellSources=node=>node.regions.map(r=>r.items.map(item=>typeof item==='string'?item:content(item)).join(''));
function restore(node){
  const model=new api.EditorModel(),root=region([node]);
  model.restore(JSON.stringify({version:2,root,cursor:{region:root.id,offset:1,anchor:1}}));
  assert.equal(model.exportLatex(),content(node));return model;
}

test('matrix dimensions follow arbitrary rows and columns, preserving empty cells',()=>{
  const source=String.raw`\begin{pmatrix}a&b&c\\d&e\\f&&g\end{pmatrix}+tail`;
  const result=parse(source);
  assert.equal(result.node.type,'matrix');assert.equal(result.node.rows,3);assert.equal(result.node.columns,3);
  assert.equal(source.slice(result.next),'+tail');
  assert.deepEqual(cellSources(result.node),['a','b','c','d','e','','f','','g']);
  assert.equal(content(result.node),String.raw`\begin{pmatrix}a&b&c\\d&e&\\f&&g\end{pmatrix}`);
  restore(result.node);
});

test('nested environments, braces and escaped alignment symbols never split outer cells',()=>{
  const source=String.raw`\begin{bmatrix}\text{a\&b}&\begin{pmatrix}x&y\\z&w\end{pmatrix}\\\frac{a}{b}&q\end{bmatrix}`;
  const result=parse(source);
  assert.equal(result.node.rows,2);assert.equal(result.node.columns,2);
  assert.deepEqual(cellSources(result.node),[String.raw`\text{a\&b}`,String.raw`\begin{pmatrix}x&y\\z&w\end{pmatrix}`,String.raw`\frac{a}{b}`,'q']);
  assert.equal(content(result.node),source);restore(result.node);
});

test('comments hide row markers, end tags and alignment tabs without losing their source',()=>{
  const source='\\begin{matrix}a% & \\\\ \\end{matrix}\n&b\\\\c&d\\end{matrix}';
  const result=parse(source);
  assert.equal(result.node.rows,2);assert.equal(result.node.columns,2);
  assert.equal(cellSources(result.node)[0],'a% & \\\\ \\end{matrix}\n');
  assert.equal(content(result.node),source);
});

test('each unambiguous matrix environment maps to its existing catalog representation',()=>{
  for(const [env,type] of Object.entries({matrix:'plainmatrix',pmatrix:'matrix',bmatrix:'bmatrix',Bmatrix:'Bmatrix',vmatrix:'determinant',Vmatrix:'normmatrix',smallmatrix:'smallmatrix',psmallmatrix:'psmallmatrix',bsmallmatrix:'bsmallmatrix',Bsmallmatrix:'Bsmallmatrix',vsmallmatrix:'vsmallmatrix',Vsmallmatrix:'Vsmallmatrix'})){
    const source='\\begin{'+env+'}a&b\\\\c&d\\end{'+env+'}',result=parse(source);
    assert.equal(result.node.type,type);assert.equal(content(result.node),source);restore(result.node);
  }
});

test('matrix alignment variants and all-left array specifications preserve their options',()=>{
  for(const [env,align,type] of [['pmatrix*','l','pmatrixl'],['pmatrix*','r','pmatrixr'],['bmatrix*','l','bmatrixl'],['bmatrix*','r','bmatrixr']]){
    const source='\\begin{'+env+'}['+align+']a&b\\\\c&d\\end{'+env+'}',result=parse(source);
    assert.equal(result.node.type,type);assert.equal(content(result.node),source);restore(result.node);
  }
  for(const suffix of ['', '[c]']){
    const result=parse('\\begin{pmatrix*}'+suffix+'a&b\\end{pmatrix*}');
    assert.equal(result.node.type,'matrix');assert.equal(content(result.node),String.raw`\begin{pmatrix}a&b\end{pmatrix}`);
  }
  const source=String.raw`\begin{array}{lll}a&b&c\\d&e\end{array}`,result=parse(source);
  assert.equal(result.node.columns,3);assert.equal(content(result.node),String.raw`\begin{array}{lll}a&b&c\\d&e&\end{array}`);
  restore(result.node);
});

test('cases, aligned and gathered accept dynamic row counts with their established column grammar',()=>{
  for(const env of ['cases','rcases','dcases','drcases','aligned']){
    const result=parse('\\begin{'+env+'}a&x\\\\b&y\\\\c\\end{'+env+'}');
    assert.equal(result.node.rows,3);assert.equal(result.node.columns,2);
    assert.deepEqual(cellSources(result.node),['a','x','b','y','c','']);restore(result.node);
  }
  for(const env of ['gathered','lgathered','rgathered','multlined']){
    const source='\\begin{'+env+'}a\\\\b\\\\c\\end{'+env+'}',result=parse(source);
    assert.equal(result.node.rows,3);assert.equal(result.node.columns,1);assert.equal(content(result.node),source);restore(result.node);
  }
  const alignedat=String.raw`\begin{alignedat}{1}a&=b\\c&=d\\e&=f\end{alignedat}`;
  assert.equal(content(parse(alignedat).node),alignedat);restore(parse(alignedat).node);
  for(const align of ['l','c']){
    const source='\\begin{subarray}{'+align+'}a\\\\b\\\\c\\end{subarray}',result=parse(source);
    assert.equal(result.node.type,'subarray'+align);assert.equal(content(result.node),source);restore(result.node);
  }
});

test('a final row terminator does not invent an extra row; intentional intermediate empty rows remain',()=>{
  const result=parse(String.raw`\begin{matrix}a\\\\b\\\end{matrix}`);
  assert.deepEqual(cellSources(result.node),['a','','b']);assert.equal(result.node.rows,3);
  assert.equal(parse(String.raw`\begin{matrix}a\cr b\end{matrix}`).node.rows,2);
});

test('unsupported grid syntax is preserved through null rather than partly interpreted',()=>{
  for(const source of [
    String.raw`\begin{array}{lr}a&b\end{array}`,
    String.raw`\begin{array}{|ll|}a&b\end{array}`,
    String.raw`\begin{alignedat}{2}a&b&c&d\end{alignedat}`,
    String.raw`\begin{aligned}[t]a&b\end{aligned}`,
    String.raw`\begin{gathered}a&b\end{gathered}`,
    String.raw`\begin{cases}a&b&c\end{cases}`,
    String.raw`\begin{matrix}a\\[2pt]b\end{matrix}`,
    String.raw`\begin{matrix}a\\*b\end{matrix}`,
    String.raw`\begin{matrix}\hline a&b\end{matrix}`,
    String.raw`\begin{matrix}\multicolumn{2}{c}{x}\end{matrix}`,
    String.raw`\begin{substack}a\\b\end{substack}`,
    String.raw`\begin{custom}a&b\end{custom}`,
  ])assert.equal(parse(source),null,source);
  const source=String.raw`\begin{custom}a&\begin{other}b\\c\end{other}\end{custom}+tail`,bounds=api.scanTexEnvironment(source,0);
  assert.equal(source.slice(0,bounds.next),source.slice(0,-5));assert.equal(source.slice(bounds.next),'+tail');
});

test('invalid balancing cannot be repaired by moving an end tag or inventing braces',()=>{
  for(const source of [String.raw`\begin{matrix}a\end{bmatrix}`,String.raw`\begin{matrix}{a\end{matrix}`,String.raw`\begin{matrix}a}\end{matrix}`,String.raw`\begin{matrix}a`,String.raw`\begin{matrix}\verb|&|\end{matrix}`]){
    assert.equal(api.scanTexEnvironment(source,0),null);assert.equal(parse(source),null);
  }
  assert.equal(api.parseTexEnvironment(String.raw`\begin{matrix}x\end{matrix}`,0,()=>null,factory),null);
});

test('scalable matching delimiters map only equivalent catalog structures',()=>{
  for(const [left,right,type] of [['(',')','parens'],['[',']','brackets'],['\\{','\\}','braces'],['|','|','abs'],['\\lvert','\\rvert','abs'],['\\|','\\|','norm'],['\\lVert','\\rVert','norm'],['\\langle','\\rangle','angles'],['\\lfloor','\\rfloor','floor'],['\\lceil','\\rceil','ceil'],['\\{','.','leftBrace'],['.','\\}','rightBrace'],['.','|','evaluation'],['/','/','slashFence'],['\\backslash','\\backslash','backslashFence']]){
    const source='\\left'+left+' x \\right'+right+'+tail',result=api.parseTexDelimiter(source,0,raw,factory);
    assert.equal(result.node.type,type,source);assert.equal(source.slice(result.next),'+tail');
    assert.deepEqual(cellSources(result.node),[' x ']);restore(result.node);
  }
});

test('nested fences and environments remain inside the same delimiter body',()=>{
  const source=String.raw`\left[\begin{matrix}a&b\\c&d\end{matrix}+\left(x\right)\right]+tail`;
  const result=api.parseTexDelimiter(source,0,raw,factory);
  assert.equal(result.node.type,'brackets');assert.equal(source.slice(result.next),'+tail');
  assert.equal(content(result.node),source.slice(0,-5).replace(String.raw`\left[`,String.raw`\left[ `));
  restore(result.node);
});

test('unknown or mixed delimiter pairs stay intact for whole-fragment source fallback',()=>{
  for(const source of [String.raw`\left(x\right]`,String.raw`\left.x\right.`,String.raw`\left\lmoustache x\right\rmoustache`,String.raw`\left\langle x\middle|y\right\rangle`]){
    const bounds=api.scanTexDelimiter(source,0);assert.equal(bounds.next,source.length);
    assert.equal(api.parseTexDelimiter(source,0,raw,factory),null);
  }
  for(const source of [String.raw`\left(x`,String.raw`\left(x}\right)`,String.raw`\left({x\right)}`])assert.equal(api.scanTexDelimiter(source,0),null);
});

test('three real aligned equations from the Pal paper preserve four editable cells each',()=>{
  // Transcribed from Pal and Makri, J. Phys. Chem. Lett. 2026, 17, 440–448,
  // equations 2, 7 and 8. Inline fixtures make this independent of local PDFs.
  const equations=[
    {number:2,tex:String.raw`\begin{aligned}\hat{H}_{\mathrm{sb}}&=\sum_i\left(\frac{\lvert\hat{\mathbf{p}}_i\rvert^2}{2m}+\frac{1}{2}m\omega_i^2\lvert\hat{\mathbf{q}}_i\rvert^2-c_i\mathbf{q}_i^{\mathrm{T}}\cdot\hat{\mathbf{s}}\right),\\\hat{\mathbf{s}}&=d\sum_{\alpha=1}^{n}\boldsymbol{\sigma}_{\alpha}\lvert\varphi_{\alpha}\rangle\langle\varphi_{\alpha}\rvert\end{aligned}`},
    {number:7,tex:String.raw`\begin{aligned}\tilde{\rho}_{\alpha'\alpha''}(t)&\equiv Z_{\mathrm{b}}^{-1}\operatorname{Tr}_{\mathrm{b}}\langle\varphi_{\alpha'}\rvert e^{-i\hat{H}t/\hbar}\lvert\varphi_1\rangle\langle\varphi_1\rvert e^{-\beta\hat{H}_{\mathrm{b}}}e^{i\hat{H}t/\hbar}\lvert\varphi_{\alpha''}\rangle,\\&\alpha',\alpha''=1,\ldots,n\end{aligned}`},
    {number:8,tex:String.raw`\begin{aligned}P_{\alpha}(t)&\equiv Z_{\mathrm{b}}^{-1}\operatorname{Tr}_{\mathrm{b}}\langle\Phi_{\alpha}\rvert e^{-i\hat{H}t/\hbar}\lvert\varphi_1\rangle\langle\varphi_1\rvert e^{-\beta\hat{H}_{\mathrm{b}}}e^{i\hat{H}t/\hbar}\lvert\Phi_{\alpha}\rangle,\\&\alpha=\mathrm{g}_1,\ldots,\mathrm{g}_{m_{\mathrm{g}}},\mathrm{e}_1,\ldots,\mathrm{e}_{n-m_{\mathrm{g}}}\end{aligned}`},
  ];
  assert.equal(equations.length,3);
  for(const equation of equations){
    const result=parse(equation.tex);assert.ok(result,'Equation '+equation.number);
    assert.equal(result.next,equation.tex.length);assert.equal(result.node.type,'aligned');
    assert.equal(result.node.rows,2);assert.equal(result.node.columns,2);assert.equal(result.node.regions.length,4);
    assert.equal(content(result.node),equation.tex);restore(result.node);
  }
});
