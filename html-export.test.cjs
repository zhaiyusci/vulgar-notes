const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');
const compiled=build({entryPoints:['src/html-export.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).then(result=>{
  const mod=new Module(path.resolve('.html-export-test.cjs'),module);mod.paths=module.paths;
  mod._compile(result.outputFiles[0].text,path.resolve('.html-export-test.cjs'));return mod.exports;
});
async function view(t,body,styles=''){
  const {Window}=await import('happy-dom');
  const window=new Window({url:'https://example.org/editor/index.html',settings:{disableCSSFileLoading:true}});
  window.document.write('<!doctype html><html lang="zh-CN" class="dark" data-color-scheme="catppuccin-mocha"><head><title>Original title</title><style>'+styles+'</style></head><body><div id="plateMount"><div class="document-zoom-surface" data-editor-zoom="150" style="zoom:1.5">'+body+'</div></div></body></html>');
  t.after(()=>window.happyDOM.abort());
  return {window,document:window.document,root:window.document.querySelector('.document-zoom-surface')};
}
function output(window,html){return new window.DOMParser().parseFromString(html,'text/html');}

test('HTML export retains rendered mathematics, metadata, figures, tables and references without changing live content or selection',async t=>{
  const {exportRenderedHtml}=await compiled;
  const h=await view(t,`
    <article id="textFlow" data-slate-editor="true" contenteditable="true" role="textbox" aria-multiline="true" aria-readonly="false" aria-label="Body">
      <section class="document-metadata"><div class="document-metadata-marker">Metadata +</div><div class="metadata-author-flow">
        <div class="document-metadata-entry metadata-entry-author" data-slate-node="element"><div class="metadata-entry-controls">Drag / edit</div><div class="metadata-entry-main"><sup class="metadata-entry-markers">1,*</sup><div class="metadata-entry-body">张三</div></div></div>
      </div></section>
      <p><span data-slate-node="text"><span data-slate-string="true">Actual prose </span></span><span class="math-inline-node" data-formula-selected="true"><span contenteditable="false" class="math-mount-wrapper"><span class="inline-formula flow-selected" aria-label="Editable inline equation"><mjx-container jax="CHTML" role="math" aria-label="x divided by y"><mjx-math><mjx-mfrac class="math-active-region"><mjx-num><mjx-c class="math-selected font-warning">x</mjx-c></mjx-num><mjx-den><mjx-c>y</mjx-c></mjx-den></mjx-mfrac><mjx-mspace class="math-caret"></mjx-mspace></mjx-math></mjx-container></span></span><span data-slate-spacer="true">INVISIBLE SPACER</span></span></p>
      <p><span data-slate-zero-width="n">&#xfeff;<br></span></p><span data-slate-placeholder="true">Placeholder text</span>
      <figure class="document-float"><img src="data:image/png;base64,AA==" alt="Diagram"><figcaption class="document-float-caption"><span class="document-float-number">Figure 1.</span> Actual caption</figcaption></figure>
      <div data-slate-node="element" class="-ml-2"><table style="width:108px"><colgroup><col style="width:8px"><col style="width:100px"></colgroup><tbody><tr><td contenteditable="false"><button>Drag</button></td><td data-slate-node="element"><em>Cell</em><div class="group/resize">Resize</div></td></tr></tbody></table></div>
    </article><section class="bibtex-bibliography"><ol><li id="bibtex-paper">[1] <i>Actual reference</i></li></ol></section>
  `,'mjx-c::before{content:"x"} .metadata-author-flow>[data-slate-node="element"]{flex:0 0 100%}');
  const range=h.document.createRange();range.selectNodeContents(h.root.querySelector('[data-slate-string]'));
  h.window.getSelection().addRange(range);
  const before=h.root.outerHTML,selection=h.window.getSelection().toString();
  const html=await exportRenderedHtml(h.root,{title:'A <paper> & results'}),doc=output(h.window,html);
  assert.equal(h.root.outerHTML,before);assert.equal(h.window.getSelection().toString(),selection);
  assert.equal(doc.title,'A <paper> & results');assert.equal(doc.documentElement.lang,'zh-CN');
  assert.equal(doc.documentElement.dataset.colorScheme,'catppuccin-mocha');assert.ok(doc.documentElement.classList.contains('dark'));
  assert.ok(doc.querySelector('mjx-mfrac > mjx-num'));assert.ok(doc.querySelector('mjx-mfrac > mjx-den'));
  assert.equal(doc.querySelector('.metadata-entry-markers').textContent,'1,*');assert.match(doc.body.textContent,/张三/);
  assert.match(doc.querySelector('figcaption').textContent,/Figure 1\. Actual caption/);
  assert.equal(doc.querySelector('table').rows[0].cells.length,1);assert.equal(doc.querySelectorAll('table col').length,1);
  assert.equal(doc.querySelector('table').style.width,'100px');assert.equal(doc.querySelector('table').parentElement.classList.contains('-ml-2'),false);
  assert.equal(doc.querySelector('td em').textContent,'Cell');assert.ok(doc.getElementById('bibtex-paper'));
  assert.equal(doc.querySelector('[contenteditable],button,[data-slate-spacer],[data-slate-placeholder],[data-slate-zero-width],.math-caret,.metadata-entry-controls,.document-metadata-marker,[class~="group/resize"]'),null);
  assert.equal(doc.querySelector('.math-active-region,.math-selected,.flow-selected,.font-warning,[data-formula-selected]'),null);
  assert.equal(doc.querySelector('[role="textbox"],[aria-multiline],[aria-readonly]'),null,'static prose must not be announced as an editable text box');
  assert.equal(doc.querySelector('.inline-formula').hasAttribute('aria-label'),false);
  assert.equal(doc.querySelector('mjx-container').getAttribute('role'),'math');
  assert.equal(doc.querySelector('mjx-container').getAttribute('aria-label'),'x divided by y','keep MathJax expression semantics');
  assert.ok(doc.querySelector('.metadata-author-flow > [data-slate-node="element"]'),'retain layout-only selectors used by metadata CSS');
  assert.equal(doc.querySelector('.document-zoom-surface').style.zoom,'');
  assert.match(doc.querySelector('style').textContent,/\.document-zoom-surface\s*\{\s*zoom:\s*1\s*!important/);
  assert.match(doc.querySelector('style').textContent,/metadata-entry-grouped\s*\{\s*display:\s*block\s*!important/);
});

test('CSSOM-only MathJax rules and sheet-relative fonts become embedded data; repeated assets are fetched once',async t=>{
  const {exportRenderedHtml}=await compiled;
  const h=await view(t,'<p>Equation <mjx-container><mjx-c class="MJX-NCM-I"></mjx-c></mjx-container></p><img src="../images/plot.png"><div style="background-image:url(../images/plot.png)">Panel</div>',
    '@font-face{font-family:MJX-NCM-I;src:url("../fonts/NewCM.woff2") format("woff2")}');
  const sheet=h.document.styleSheets[0];Object.defineProperty(sheet,'href',{value:'https://example.org/assets/css/math.css'});
  h.root.querySelector('img').removeAttribute('src');h.root.querySelector('img').setAttribute('srcset','../images/other.png 2x');
  Object.defineProperty(h.root.querySelector('img'),'currentSrc',{value:'https://example.org/images/plot.png'});
  sheet.insertRule('mjx-c.MJX-NCM-I::before{font-family:MJX-NCM-I;content:"x"}',sheet.cssRules.length);
  sheet.insertRule('@font-face{font-family:SidebarOnly;src:url("../fonts/Sidebar.woff2")}',sheet.cssRules.length);
  // Happy DOM does not resolve pseudo-element styles. Supply the same computed
  // family a browser returns for the actual CSSOM-only MathJax glyph above.
  const computed=h.window.getComputedStyle.bind(h.window);
  h.window.getComputedStyle=(element,pseudo)=>{
    const style=computed(element,pseudo);
    return pseudo==='::before'&&element.matches('mjx-c.MJX-NCM-I')
      ?new Proxy(style,{get:(target,key)=>key==='fontFamily'?'MJX-NCM-I':Reflect.get(target,key)}):style;
  };
  assert.doesNotMatch(h.document.querySelector('style').textContent,/mjx-c\.MJX/,'fixture must exercise CSSOM, not style textContent');
  const requests=[];
  const html=await exportRenderedHtml(h.root,{fetchResource:async url=>{requests.push(url);return new Blob([url],{type:url.endsWith('.woff2')?'font/woff2':'image/png'});}});
  assert.deepEqual(requests.sort(),['https://example.org/assets/fonts/NewCM.woff2','https://example.org/images/plot.png']);
  const doc=output(h.window,html),css=doc.querySelector('style').textContent;
  assert.match(css,/mjx-c\.MJX-NCM-I::before/);assert.match(css,/data:font\/woff2;base64,/);
  assert.doesNotMatch(css,/@font-face[^}]*SidebarOnly/,'sidebar fonts must not be exported or fetched');
  assert.match(doc.querySelector('img').src,/^data:image\/png;base64,/);assert.match(doc.querySelector('[style*="background-image"]').getAttribute('style'),/data:image\/png;base64,/);
  assert.doesNotMatch(html,/https:\/\/example\.org\/(?:assets\/fonts|images)/);
  assert.equal(doc.querySelector('script,link'),null,'export requires no MathJax or application runtime');
});

test('TOC, cross-references, citations and endnotes use exact static targets while empty label anchors survive',async t=>{
  const {exportRenderedHtml}=await compiled;
  const h=await view(t,`<nav class="document-toc"><button class="document-toc-link" data-heading-path="2">1 Same title</button><button class="document-toc-link" data-heading-path="4">2 Same title</button></nav>
    <h2>Same title</h2><h2>Same title</h2><span class="tex-label-anchor"><button class="tex-label-marker">eq:a</button></span>
    <span class="tex-reference-content">(1)</span><span class="tex-reference-content">[2]</span><button class="tex-reference-content">[3]</button>
    <ol><li id="bibtex-paper">Paper</li><li data-bibliography-key="endnote:n">Note</li></ol>`);
  const headings=h.root.querySelectorAll('h2'),refs=h.root.querySelectorAll('.tex-reference-content'),label=h.root.querySelector('.tex-label-anchor'),note=h.root.querySelector('[data-bibliography-key]');
  const html=await exportRenderedHtml(h.root,{targets:[{element:headings[0],id:'vn-heading-2'},{element:headings[1],id:'vn-heading-4'},{element:label,id:'equation-a'},{element:note,id:'note-n'}],
    links:[{element:refs[0],href:'#equation-a'},{element:refs[1],href:'#bibtex-paper'},{element:refs[2],href:'#note-n'}]});
  const doc=output(h.window,html);
  assert.deepEqual(Array.from(doc.querySelectorAll('a')).map(a=>a.getAttribute('href')),['#vn-heading-2','#vn-heading-4','#equation-a','#bibtex-paper','#note-n']);
  assert.equal(doc.getElementById('equation-a').textContent,'');assert.equal(doc.querySelector('.tex-label-marker'),null);
  for(const anchor of doc.querySelectorAll('a'))assert.ok(doc.getElementById(anchor.getAttribute('href').slice(1)));
  assert.equal(h.root.querySelectorAll('a').length,0,'link conversion must not mutate live nodes');
});

test('static export strips active content and event attributes while preserving safe document links and non-interactive values',async t=>{
  const {exportRenderedHtml}=await compiled;
  const h=await view(t,`<p onclick="alert(1)">Prose<script>window.evil=1</script><iframe src="https://evil.example/"></iframe><object data="evil"></object>
    <a href="javascript:alert(1)" onmouseover="alert(2)">Bad</a><a href="https://doi.org/10/example" target="_blank" ping="https://evil.example/">DOI</a></p>
    <textarea>Saved value</textarea><input type="checkbox"><button>Retained number</button>`);
  h.root.querySelector('textarea').value='Current caption 中文';h.root.querySelector('input').checked=true;
  const html=await exportRenderedHtml(h.root),doc=output(h.window,html);
  assert.equal(doc.querySelector('script,iframe,object,embed,textarea,input,button'),null);
  assert.equal(doc.querySelector('[onclick],[onmouseover],[ping]'),null);
  assert.equal(doc.querySelector('a').hasAttribute('href'),false);
  assert.equal(doc.querySelectorAll('a')[1].getAttribute('rel'),'noopener noreferrer');
  assert.match(doc.body.textContent,/Current caption 中文/);assert.match(doc.body.textContent,/☑/);assert.match(doc.body.textContent,/Retained number/);
  assert.match(doc.querySelector('meta[http-equiv]').content,/default-src 'none'/);
});

test('unavailable fonts or images reject export explicitly and keep the live editor intact',async t=>{
  const {exportRenderedHtml}=await compiled;
  const h=await view(t,'<img src="images/missing.png"><p>Keep this document</p>');
  const before=h.root.outerHTML;
  await assert.rejects(exportRenderedHtml(h.root,{fetchResource:async()=>{throw Error('Denied');}}),/Unable to embed.*images\/missing\.png.*Denied/);
  assert.equal(h.root.outerHTML,before);
  h.root.querySelector('img').remove();
  h.document.querySelector('style').sheet.insertRule('@font-face{font-family:Missing;src:url(fonts/missing.woff2)}',0);
  h.root.style.fontFamily='Missing';
  await assert.rejects(exportRenderedHtml(h.root,{fetchResource:async()=>{throw Error('Font unavailable');}}),/Unable to embed.*fonts\/missing\.woff2/);
});

test('imported stylesheets retain their own URL bases and media conditions without leaving network imports',async t=>{
  const {exportRenderedHtml}=await compiled;
  const h=await view(t,'<p>Offline text</p>');
  h.root.style.fontFamily='Imported';
  const child={href:'https://example.org/shared/type/fonts.css',cssRules:[{type:5,cssText:'@font-face{font-family:Imported;src:url(../woff2/Imported.woff2)}'}]};
  const parent={href:'https://example.org/assets/main.css',cssRules:[{type:3,styleSheet:child,media:{mediaText:'screen'}}]};
  Object.defineProperty(h.document,'styleSheets',{value:[parent]});
  const requests=[];
  const html=await exportRenderedHtml(h.root,{fetchResource:async url=>{requests.push(url);return new Blob(['font'],{type:'font/woff2'});}});
  assert.deepEqual(requests,['https://example.org/shared/woff2/Imported.woff2']);
  assert.match(html,/@media screen\{/);assert.doesNotMatch(html,/@import/);assert.match(html,/data:font\/woff2;base64,/);
});

test('canvas pixels are copied and CSS content cannot break out of the exported style element',async t=>{
  const {exportRenderedHtml}=await compiled;
  const h=await view(t,'<canvas width="120" height="80" class="diagram"></canvas>');
  h.root.querySelector('canvas').toDataURL=()=> 'data:image/png;base64,cGl4ZWxz';
  h.document.querySelector('style').sheet.insertRule('.quote::before{content:"</style><script>evil()</script>"}',0);
  const html=await exportRenderedHtml(h.root),doc=output(h.window,html),image=doc.querySelector('img.diagram');
  assert.equal(image.getAttribute('src'),'data:image/png;base64,cGl4ZWxz');assert.equal(image.getAttribute('width'),'120');assert.equal(image.getAttribute('height'),'80');
  assert.equal(doc.querySelector('canvas,script'),null);assert.match(doc.querySelector('style').textContent,/<\\\/style>/);
  assert.ok(h.root.querySelector('canvas'));
});

test('exported formulas use native MathJax menus without a custom source dialog or editor placeholders',async t=>{
 const {exportRenderedHtml}=await compiled;
 const h=await view(t,'<p>Text <span class="inline-formula"><mjx-container role="math"><mjx-mrow class="math-region region-r1"><mjx-mspace class="math-boundary boundary-start"></mjx-mspace><mjx-mi>x</mjx-mi><mjx-mrow class="math-placeholder" title="Edit empty slot">□</mjx-mrow><mjx-mspace class="math-caret"></mjx-mspace></mjx-mrow></mjx-container></span></p>');
 const formula=h.root.querySelector('.inline-formula'),before=h.root.outerHTML;
 const source='\\frac{x}{y} + \\textnormal{</script><script>notExecuted()</script> & "quoted"}';
 const fetched=[];
 const html=await exportRenderedHtml(h.root,{lang:'en',formulas:[{element:formula,source}],fetchResource:async url=>{fetched.push(url);return new Blob(['window.MathJax={options:{enableMenu:true}}'],{type:'text/javascript'});}}),doc=output(h.window,html);
 const exported=doc.querySelector('[data-export-math-source]');
 assert.equal(exported.getAttribute('data-export-math-source'),'\\('+source+'\\)');assert.equal(exported.getAttribute('data-slate-tex-expression'),source);
 assert.equal(exported.hasAttribute('role'),false);assert.equal(exported.hasAttribute('tabindex'),false);
 assert.deepEqual(fetched,['https://example.org/editor/mathjax-export-config.js']);
 assert.equal(doc.querySelectorAll('script').length,2);assert.equal(doc.querySelector('script').textContent.includes('notExecuted()'),false);
 const nonce=doc.querySelector('script').getAttribute('nonce');assert.match(nonce,/^[a-f0-9]{32}$/);assert.ok(doc.querySelector('meta[http-equiv]').content.includes("script-src 'nonce-"+nonce+"'"));
 assert.match(doc.querySelector('script[src]').src,/mathjax@4\.1\.3\/tex-chtml\.js$/);
 assert.equal(doc.querySelector('dialog,[data-reader-source],[data-formula-source],[contenteditable],.math-placeholder,.math-boundary,.math-caret'),null);
 assert.doesNotMatch(doc.querySelector('main').textContent,/□/);assert.equal(h.root.outerHTML,before);
});
