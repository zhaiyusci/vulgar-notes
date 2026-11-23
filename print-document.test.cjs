const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const Module=require('node:module');
const {buildSync}=require('esbuild');
const {Window}=require('happy-dom');
const mod=new Module(path.resolve('.print-document-test.cjs'),module);mod.paths=module.paths;
mod._compile(buildSync({entryPoints:['src/print-document.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text,mod.id);
const {printGeometry,printStyles,preparePrintTables,defaultPrintOptions,collectPrintMath}=mod.exports;

test('print typography and pagination are available without reading editor styles',()=>{
  const css=printStyles(defaultPrintOptions);
  for(const rule of ['[data-metadata-role="title"]','[data-metadata-role="affiliation"]',
    '.metadata-author-flow','.slate-p','thead','.inline-formula.display-formula'])assert.ok(css.includes(rule),rule);
  assert.match(css,/\[data-metadata-role="affiliation"\].*?font-size:\s*\.9em/);
  assert.doesNotMatch(css,/\.metadata-add-button|\.document-home-action/);
});

test('math collection only inspects rendered formulas and embeds their used fonts',async t=>{
  const window=new Window();t.after(()=>window.happyDOM.abort());
  const doc=window.document;
  doc.head.innerHTML='<style>.outside{background:url(sidebar.png)}</style><style id="MJX-CHTML-styles">'+
    '.used::before{content:"x"}.unused::before{content:"y"}'+
    '@font-face{font-family:UsedFace;src:url(used.woff2)}@font-face{font-family:UnusedFace;src:url(unused.woff2)}</style>';
  doc.body.innerHTML='<main><p class="outside">Prose</p><span data-export-math-source="x"><mjx-container><mjx-c class="used"></mjx-c></mjx-container></span></main>';
  const root=doc.querySelector('main'),paragraph=root.firstChild;
  root.cloneNode=()=>assert.fail('Cloned the whole document when collecting math');
  window.getComputedStyle=element=>{
    assert.ok(element.closest('mjx-container'));
    return {fontFamily:'UsedFace'};
  };
  const css=await collectPrintMath(doc,root,{embedCss:async css=>css});
  assert.match(css,/\.used::?before/);
  assert.match(css,/used\.woff2/);
  assert.doesNotMatch(css,/unused|sidebar/i);
  assert.equal(root.firstChild,paragraph);
  assert.ok(root.querySelector('mjx-c.used'));
});

test('print geometry uses physical paper dimensions and rejects impossible or injected settings',()=>{
  const portrait=printGeometry(defaultPrintOptions);
  assert.equal(portrait.widthMm,210);assert.equal(portrait.heightMm,297);
  assert.ok(Math.abs(portrait.contentWidth-642.519685)<.001);
  const landscape=printGeometry({...defaultPrintOptions,paper:'letter',landscape:true});
  assert.equal(landscape.widthMm,279.4);assert.equal(landscape.heightMm,215.9);
  for(const bad of [{paper:'a4; color:red'},{marginMm:NaN},{marginMm:0},{marginMm:41},{landscape:'true'},{pageNumbers:1}])
    assert.throws(()=>printGeometry({...defaultPrintOptions,...bad}),/Invalid PDF page settings/);
  assert.match(printStyles(defaultPrintOptions),/@page\{size:210mm 297mm;margin:20mm/);
  assert.match(printStyles(defaultPrintOptions),/content:counter\(page\)/);
  assert.doesNotMatch(printStyles({...defaultPrintOptions,pageNumbers:false}),/counter\(page\)/);
});

test('wide saved tables retain column ratios and semantic repeated headers without changing row contents',t=>{
  const window=new Window();t.after(()=>window.happyDOM.abort());
  window.document.body.innerHTML='<article><figure class="document-float" data-float-kind="table"><div class="overflow-x-auto"><table style="width:1000px"><colgroup><col style="width:250px"><col style="width:750px"></colgroup><tbody><tr><th>Key</th><th>Result</th></tr><tr><th>Subkey</th><th>Unit</th></tr><tr><td style="min-width:200px">A</td><td><a href="#eq-1">(1)</a></td></tr></tbody></table></div></figure></article>';
  const root=window.document.querySelector('article');
  preparePrintTables(root,640);
  const table=root.querySelector('table');
  assert.equal(table.style.width,'640px');
  assert.deepEqual([...table.querySelectorAll('col')].map(col=>col.style.width),['25%','75%']);
  assert.equal(table.tHead.querySelectorAll('tr').length,2);assert.equal(table.tBodies[0].querySelectorAll('tr').length,1);
  assert.equal(table.rows.length,3);assert.equal(table.querySelector('a').getAttribute('href'),'#eq-1');
  assert.equal(table.querySelector('td').style.minWidth,'');
  assert.ok(table.parentElement.classList.contains('print-table-wrapper'));
  assert.equal(root.classList.contains('print-table-wrapper'),false);
  preparePrintTables(root,640);
  assert.equal(table.tHead.querySelectorAll('tr').length,2,'Preparing again must not duplicate headers');
});

test('data rows are not promoted to headers and a short table keeps its width',t=>{
  const window=new Window();t.after(()=>window.happyDOM.abort());
  window.document.body.innerHTML='<article><table style="width:300px"><tbody><tr><td>1</td><td>2</td></tr></tbody></table></article>';
  preparePrintTables(window.document.querySelector('article'),640);
  const table=window.document.querySelector('table');
  assert.equal(table.tHead,null);assert.equal(table.style.width,'300px');assert.equal(table.rows[0].textContent,'12');
});
