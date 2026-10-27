const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {buildSync}=require('esbuild');

// Exercise the actual MarkdownKit, including its rich-text and math rules.
const source=buildSync({stdin:{contents:`
import {createPlateEditor,ParagraphPlugin} from 'platejs/react';
import {BoldPlugin,ItalicPlugin} from '@platejs/basic-nodes/react';
import {EquationPlugin,InlineEquationPlugin} from '@platejs/math/react';
import {MarkdownPlugin} from '@platejs/markdown';
import {MarkdownKit} from './src/components/editor/plugins/markdown-kit';
import {bibliographyMarkdown} from './src/bibliography-markdown';
const editor=createPlateEditor({plugins:[ParagraphPlugin,BoldPlugin,ItalicPlugin,EquationPlugin,InlineEquationPlugin,...MarkdownKit]});
export const serialize=(value)=>editor.getApi(MarkdownPlugin).markdown.serialize({value});
export const exportMarkdown=(value,libraries=[],style='simple')=>bibliographyMarkdown(value,libraries,serialize,style);
`,loader:'ts',resolveDir:path.resolve('.')},bundle:true,format:'cjs',write:false,platform:'node',loader:{'.css':'empty'}}).outputFiles[0].text;
const compiled={exports:{}};
// Dispose scheduled work belonging to this unmounted test editor after use.
const timers=new Set();
const trackTimer=create=>(...args)=>{const timer=create(...args);timers.add(timer);return timer;};
new Function('require','module','exports','setTimeout','setInterval',source)(require,compiled,compiled.exports,trackTimer(setTimeout),trackTimer(setInterval));
test.after(()=>{for(const timer of timers){clearTimeout(timer);clearInterval(timer);}});
const {exportMarkdown,serialize}=compiled.exports;
const paragraph=(...children)=>({type:'p',children});
const manual=(key,...children)=>({type:'bibliography_entry',citeKey:key,children});
const cite=(...keys)=>({type:'tex_reference',command:'cite',keys,children:[{text:''}]});
const formula=(tex,extra={})=>({type:'inline_equation',texExpression:tex,children:[{text:''}],...extra});
const noteRef=identifier=>({type:'footnoteReference',identifier,children:[{text:''}]});
const note=(identifier,...children)=>({type:'footnoteDefinition',identifier,children});
const libraries=[{id:'papers',name:'papers.bib',source:'@book{first,title={First library title}}\n@book{second,title={Second library title}}\n@book{unused,title={UNUSED_ENTRY_MARKER}}'}];

test('selected reference-list formats reach Markdown while rich notes and shared numbers remain intact',()=>{
  const value=[paragraph({text:'Read '},cite('paper'),{text:' and '},noteRef('n')),note('n',paragraph({text:'Keep bold',bold:true},formula('x^2')))];
  const libs=[{id:'lib',name:'paper.bib',source:'@article{paper,author={Doe, Jane},title={A formatted paper},journal={Example Journal},year={2026},volume={7},pages={10--20}}'}];
  const apa=exportMarkdown(value,libs,'apa'),ieee=exportMarkdown(value,libs,'ieee');
  assert.notEqual(apa,ieee);assert.match(apa,/Doe, J\./);assert.match(ieee,/J\. Doe/);
  for(const output of [apa,ieee]){
    assert.match(output,/\[1\] \\bibitem\{paper\}/);assert.match(output,/\[2\] \*\*Keep bold\*\*/);
    assert.ok(output.includes('$x^2$'));assert.match(output,/_Example Journal/);
  }
});

test('manual and cited library entries share one final Markdown bibliography in reference-number order',()=>{
  const value=[paragraph({text:'Opening prose '},cite('second','first')),
    manual('manualA',{text:'Manual entry A'}),paragraph({text:'Later prose '},cite('second')),
    manual('manualB',{text:'Manual entry B'}),paragraph({text:'Final prose.'})];
  const before=JSON.stringify({value,libraries}),md=exportMarkdown(value,libraries);
  assert.equal((md.match(/^## Notes and references$/gm)||[]).length,1);
  const heading=md.indexOf('## Notes and references');
  for(const text of ['Opening prose','Later prose','Final prose.'])assert.ok(md.indexOf(text)<heading,text);
  const keys=[...md.matchAll(/\\bibitem\{([^}]+)\}/g)].map(match=>match[1]);
  assert.deepEqual(keys,['second','first','manualA','manualB']);
  assert.deepEqual([...md.matchAll(/^\[(\d+)\] /gm)].map(match=>match[1]),['1','2','3','4']);
  assert.ok(md.indexOf('Manual entry A')>heading);assert.ok(md.indexOf('Second library title')>heading);
  assert.doesNotMatch(md,/UNUSED_ENTRY_MARKER/);
  assert.equal(JSON.stringify({value,libraries}),before);
});

test('manual bibliography keeps rich marks and inline or display formula serialization',()=>{
  const value=[paragraph({text:'Body.'}),manual('rich',{text:'Bold',bold:true},{text:' and '},{text:'italic',italic:true},
    {text:' with '},formula('x^2'),{text:' and display '},formula('y^2',{display:true,numbered:false}),{text:' after.'})];
  const md=exportMarkdown(value);
  assert.equal((md.match(/^## Notes and references$/gm)||[]).length,1);
  assert.match(md,/\\bibitem\{rich\} \*\*Bold\*\* and _italic_/);
  assert.ok(md.includes('$x^2$'),md);
  assert.ok(md.includes('$$\ny^2\n$$'),md);
  assert.match(md,/after\./);
});

test('manual-only documents also collect their bibliography after all prose',()=>{
  const value=[manual('manual',{text:'Manual source.'}),paragraph({text:'Prose following the original entry.'})];
  const md=exportMarkdown(value);
  assert.ok(md.indexOf('Prose following')<md.indexOf('## Notes and references'));
  assert.match(md,/## Notes and references\n\n\[1\] \\bibitem\{manual\} Manual source\./);
});

test('uncited libraries add no empty heading and ordinary prose keeps its existing serialization',()=>{
  const value=[paragraph({text:'Only prose ',bold:true},{text:'without citations.'})];
  const md=exportMarkdown(value,libraries);
  assert.equal(md,serialize(value));assert.doesNotMatch(md,/Bibliography|bibitem|UNUSED_ENTRY_MARKER/);
});

test('a bibliography-only document starts directly with its one heading',()=>{
  const md=exportMarkdown([manual('only',{text:'The only entry.'})]);
  assert.ok(md.startsWith('## Notes and references\n\n[1] \\bibitem{only}'));
});

test('endnotes and references share first-occurrence numbers, with repeated note markers and rich note content',()=>{
  const value=[note('first-note',paragraph({text:'Rich note ',bold:true},formula('x^2'),{text:' cites '},cite('first'))),
    paragraph({text:'Note '},noteRef('first-note'),{text:'; library '},cite('second'),{text:'; repeated '},noteRef('first-note')),
    manual('manual',{text:'Uncited manual source.'}),
    note('second-note',paragraph({text:'Second note.'})),
    note('orphan',paragraph({text:'Orphan note retained.'})),
    paragraph({text:'Another note '},noteRef('second-note'))];
  const before=JSON.stringify(value),md=exportMarkdown(value,libraries),[body,tail]=md.split('## Notes and references');
  assert.equal((md.match(/^## Notes and references$/gm)||[]).length,1);
  assert.equal((body.replace(/\\/g,'').match(/\[1\]/g)||[]).length,2);
  assert.ok(body.replace(/\\/g,'').includes('[4]'));
  assert.doesNotMatch(body,/Rich note|Second note\.|Orphan note retained/);
  assert.match(tail,/\[1\] \*\*Rich note/);assert.ok(tail.includes('$x^2$'));
  assert.match(tail,/\[2\] \\bibitem\{first\}/);assert.match(tail,/\[3\] \\bibitem\{second\}/);
  assert.match(tail,/\[4\] Second note\./);assert.match(tail,/\[5\] \\bibitem\{manual\}/);
  assert.match(tail,/\[6\] Orphan note retained\./);
  assert.doesNotMatch(md,/\[\^|^## Bibliography|UNUSED_ENTRY_MARKER/m);
  assert.equal(JSON.stringify(value),before);
});
