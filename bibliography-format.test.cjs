const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {buildSync}=require('esbuild');
const bundled=buildSync({stdin:{contents:"export * from './src/bibliography-format';export * from './src/bibtex-csl';export {cslStyles,cslLocales} from './src/csl/assets';export {parse} from '@retorquere/bibtex-parser';",resolveDir:__dirname},bundle:true,write:false,platform:'browser',format:'cjs',target:'es2022'}).outputFiles[0].text;
const compiled={exports:{}};new Function('module','exports',bundled)(compiled,compiled.exports);
const {bibEntryToCSL,formatBibliography,bibliographyStyles,isBibliographyStyle,parse,cslStyles,cslLocales}=compiled.exports;
const sample={key:'smith',description:'Jane Smith. A useful discovery. 2024.',csl:{id:'smith',type:'article-journal',title:'A useful discovery',author:[{given:'Jane',family:'Smith'},{given:'John',family:'Doe'}],issued:{'date-parts':[[2024]]},'container-title':'Journal of Testing',volume:'12',issue:'3',page:'123–130',DOI:'10.1000/example'}};

test('BibTeX projection keeps structured names, corporate authors, dates and publication metadata',()=>{
 const [normalized]=parse(String.raw`@article{paper,
 title={On {NASA} and \textbf{G\"odel}},author={Smith, Jane and Ludwig van Beethoven and {World Health Organization}},
 date={2024-09-02},urldate={2025-01-03},journal={Journal of Testing},shortjournal={J Test},
 volume={12},number={3},pages={123--130},publisher={Research Press},address={London},
 doi={https://doi.org/10.1000/example},url={https://example.test/article},langid={english}
 }`,{english:false,caseProtection:false}).entries;
 const item=bibEntryToCSL(normalized);
 assert.equal(item.id,'paper');assert.equal(item.type,'article-journal');assert.equal(item.title,'On NASA and Gödel');
 assert.deepEqual(item.author,[{family:'Smith',given:'Jane'},{family:'Beethoven',given:'Ludwig','non-dropping-particle':'van'},{literal:'World Health Organization'}]);
 assert.deepEqual(item.issued,{'date-parts':[[2024,9,2]]});assert.deepEqual(item.accessed,{'date-parts':[[2025,1,3]]});
 assert.equal(item['container-title'],'Journal of Testing');assert.equal(item['container-title-short'],'J Test');
 assert.equal(item.volume,'12');assert.equal(item.issue,'3');assert.equal(item.page,'123–130');
 assert.equal(item.DOI,'10.1000/example');assert.equal(item.URL,'https://example.test/article');assert.equal(item.language,'en');
 assert.equal(normalized.fields.pages,'123–130','projection does not mutate the parser record');
});

test('BibTeX projection covers Chinese names, editors, inherited chapters and thesis dates',()=>{
 const entries=parse(String.raw`@collection{parent,title={Collected work},publisher={University Press},year=2020,editor={Doe, Jane}}
 @incollection{child,title={A chapter},author={张三 and 李四},pages={4--9},crossref={parent}}
 @phdthesis{thesis,title={研究},author={{王小明}},school={示例大学},year=2023,month=sep,langid={chinese}}`,{english:false,caseProtection:false,applyCrossRef:true}).entries;
 const chapter=bibEntryToCSL(entries.find(entry=>entry.key==='child'));
 assert.equal(chapter.type,'chapter');assert.equal(chapter['container-title'],'Collected work');assert.equal(chapter.publisher,'University Press');
 assert.deepEqual(chapter.issued,{'date-parts':[[2020]]});assert.deepEqual(chapter.editor,[{family:'Doe',given:'Jane'}]);assert.match(chapter.author.map(name=>name.literal||name.family).join(' '),/张三.*李四/);
 const thesis=bibEntryToCSL(entries.find(entry=>entry.key==='thesis'));
 assert.equal(thesis.type,'thesis');assert.equal(thesis.genre,'PhD dissertation');assert.equal(thesis.publisher,'示例大学');assert.equal(thesis.language,'zh-CN');
 assert.deepEqual(thesis.issued,{'date-parts':[[2023,9]]});
});

test('real CSL styles produce distinct complete publication fields, punctuation and rich runs',()=>{
 const results=new Map(bibliographyStyles.map(style=>[style.id,formatBibliography([sample],style.id).get('smith')]));
 assert.equal(results.get('simple').text,sample.description);
 assert.match(results.get('ieee').text,/J\. Smith and J\. Doe, “A useful discovery,” Journal of Testing, vol\. 12, no\. 3, pp\. 123–130, 2024, doi: 10\.1000\/example\./);
 assert.match(results.get('acs').text,/Smith, J\.; Doe, J\. A Useful Discovery\. Journal of Testing 2024, 12 \(3\), 123–130\. https:\/\/doi\.org\/10\.1000\/example/);
 assert.match(results.get('aip').text,/^J\. Smith, and J\. Doe, “A useful discovery,” Journal of Testing 12\(3\), 123–130 \(2024\)\.$/);
 assert.match(results.get('vancouver').text,/Smith J, Doe J\. A useful discovery\. Journal of Testing\. 2024;12\(3\):123–30\. doi:10\.1000\/example/);
 assert.match(results.get('apa').text,/Smith, J\., & Doe, J\. \(2024\)\. A useful discovery\. Journal of Testing, 12\(3\), 123–130\. https:\/\/doi\.org\/10\.1000\/example/);
 assert.match(results.get('chicago').text,/Smith, Jane, and John Doe\. “A Useful Discovery\.” Journal of Testing 12, no\. 3 \(2024\): 123–30\./);
 assert.match(results.get('gbt7714-2025').text,/A useful discovery\[J\/OL\].*2024.*12.*3.*123-130.*DOI:10\.1000\/example/);
 for(const [style,result] of results){
  assert.equal(result.runs.map(run=>run.text).join(''),result.text,style);
  assert.doesNotMatch(result.text,/^\[?1\]?\s*[.\t]/,'host numbering must not be duplicated');
 }
 assert.ok(results.get('apa').runs.some(run=>run.italic&&run.text==='12'));
 assert.match(results.get('ieee').html,/<i>Journal of Testing<\/i>/);
});

test('ACS uses its official 2026 reference body with abbreviated journals and bold year',()=>{
 const entry={...sample,csl:{...sample.csl,'container-title-short':'J. Test.'}};
 const result=formatBibliography([entry],'acs').get('smith');
 assert.equal(result.text,'Smith, J.; Doe, J. A Useful Discovery. J. Test. 2024, 12 (3), 123–130. https://doi.org/10.1000/example');
 assert.ok(result.runs.some(run=>run.text==='J. Test.'&&run.italic));
 assert.ok(result.runs.some(run=>run.text==='2024'&&run.bold));
 assert.ok(result.runs.some(run=>run.text==='12'&&run.italic));
 assert.doesNotMatch(result.text,/^\(\d+\)/,'the host supplies the shared bibliography number');
 assert.equal(JSON.parse(fs.readFileSync('src/csl/manifest.json','utf8')).styles.acs.title,'ACS Guide 2026 revision');
});

test('AIP uses its official fourth-edition body without duplicate superscript labels',()=>{
 const entries=Array.from({length:12},(_,index)=>({...sample,key:'physics'+index,csl:{...sample.csl,id:'physics'+index,'container-title-short':'J. Test.',title:'H<sub>2</sub>O and x<sup>2</sup>'}}));
 const result=formatBibliography(entries,'aip').get('physics11');
 assert.equal(result.text,'J. Smith, and J. Doe, “H2O and x2,” J. Test. 12(3), 123–130 (2024).');
 assert.ok(result.runs.some(run=>run.text==='12'&&run.bold));
 assert.equal(result.runs.filter(run=>run.superscript).length,1,'only the superscript in the actual title remains');
 assert.ok(result.runs.some(run=>run.text==='2'&&run.superscript));
 assert.ok(result.runs.some(run=>run.text==='2'&&run.subscript));
 assert.doesNotMatch(result.html,/^<sup>\d+<\/sup>/);
 assert.equal(JSON.parse(fs.readFileSync('src/csl/manifest.json','utf8')).styles.aip.title,'AIP Style Manual 4th edition');
});

test('formatter preserves host order and keys despite CSL sorting and memoizes unchanged content',()=>{
 const z={...sample,key:'z',csl:{...sample.csl,id:'z',author:[{family:'Zebra',given:'Alice'}]}};
 const a={...sample,key:'a',csl:{...sample.csl,id:'a',author:[{family:'Alpha',given:'Bob'}]}};
 const original=JSON.stringify([z,a]),result=formatBibliography([z,a],'apa');
 assert.deepEqual([...result.keys()],['z','a']);assert.match(result.get('z').text,/^Zebra/);assert.match(result.get('a').text,/^Alpha/);
 assert.equal(formatBibliography(JSON.parse(original),'apa'),result,'equivalent views share cached processor output');
 assert.equal(JSON.stringify([z,a]),original,'citeproc mutations cannot change parsed metadata');
 const edited={...a,csl:{...a.csl,title:'An updated finding'}};
 assert.match(formatBibliography([z,edited],'apa').get('a').text,/An updated finding/);
 assert.equal(formatBibliography([],'ieee').size,0);
 assert.equal(formatBibliography([{key:'fallback',description:'Plain fallback'}],'apa').get('fallback').text,'Plain fallback');
});

test('CSL output is reduced to safe marked text and never propagates source HTML attributes',()=>{
 const entry={...sample,key:'hostile',csl:{...sample.csl,id:'hostile',title:'A < B & C <img src="x" onerror="alert(1)"> and <script>alert(2)</script>',URL:'javascript:alert(3)',DOI:undefined}};
 const result=formatBibliography([entry],'apa').get('hostile');
 assert.doesNotMatch(result.html,/<(?:img|script|a)\b/i);
 assert.ok([...result.html.matchAll(/<[^>]+>/g)].every(match=>/^<\/?(?:i|b|sup|sub)>$|^<span style="font-variant:small-caps">$|^<\/span>$/.test(match[0])),'only fixed renderer tags survive; source attributes remain escaped text');
 assert.match(result.html,/&lt;|&amp;/);
 for(const run of result.runs)assert.ok(Object.keys(run).every(key=>['text','italic','bold','superscript','subscript','smallCaps'].includes(key)));
 assert.equal(result.text,result.runs.map(run=>run.text).join(''));
});

test('vendored CSL assets are exact pinned upstream strings with recorded licenses',()=>{
 const manifest=JSON.parse(fs.readFileSync('src/csl/manifest.json','utf8'));
 for(const [group,assets] of [['styles',cslStyles],['locales',cslLocales]])for(const [key,xml] of Object.entries(assets)){
  assert.equal(crypto.createHash('sha256').update(xml).digest('hex'),manifest[group][key].sha256);
  assert.equal(Buffer.byteLength(xml),manifest[group][key].bytes);assert.equal(manifest[group][key].license,'CC-BY-SA-3.0');
 }
 const processor=JSON.parse(fs.readFileSync('licenses/citeproc/manifest.json','utf8'));
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync('licenses/citeproc/citeproc_commonjs.js')).digest('hex'),processor.sha256);
 assert.match(fs.readFileSync('licenses/citeproc/CPAL.txt','utf8'),/citeproc-js implements the Citation Style Language/);
 assert.equal(fs.readFileSync('licenses/csl/manifest.json','utf8'),fs.readFileSync('src/csl/manifest.json','utf8'));
 assert.ok(bibliographyStyles.every(style=>isBibliographyStyle(style.id)));
 for(const invalid of [null,'',false,'nature','APA'])assert.equal(isBibliographyStyle(invalid),false);
});
