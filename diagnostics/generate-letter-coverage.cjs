const fs=require('node:fs'),vm=require('node:vm');
(async()=>{
const coverage={};
for(const name of ['bboldx']){
 const url=`https://cdn.jsdelivr.net/npm/@mathjax/mathjax-${name}-font-extension@4.1.3/mjs/chtml.js`;
 const response=await fetch(url);if(!response.ok)throw Error(url);
 const source=await response.text(),ctx={AddFontIds:x=>x};
 vm.runInNewContext(source.replace(/^import .*$/mg,'').replace('export const ','var '),ctx);
 const data=ctx[Object.keys(ctx).find(k=>k.startsWith('MathJax'))];
 console.log(name,data.fonts);
 for(const group of Object.values(data.chars))for(const [variant,chars] of Object.entries(group))coverage[variant]={points:Object.keys(chars).map(Number),remap:Array.isArray(data.variantSmp[variant])?data.variantSmp[variant][5]:{}};
}
fs.writeFileSync('src/letter-extension-coverage.ts','// Generated from official MathJax font extension 4.1.3 character tables.\n// Regenerate: node diagnostics/generate-letter-coverage.cjs\nexport const extensionCoverage:Record<string,{points:number[];remap:Record<number,number>}>= '+JSON.stringify(coverage,null,2)+';\n');
})().catch(e=>{console.error(e);process.exitCode=1});
