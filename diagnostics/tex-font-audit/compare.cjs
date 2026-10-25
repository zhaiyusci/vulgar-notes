const fs=require('node:fs');
const mj=JSON.parse(fs.readFileSync('../all-fonts-greek-results.json','utf8'));
const records=fs.readFileSync('glyphs.tsv','utf8').trim().split(/\r?\n/).slice(1).map(line=>{
 const [style,command,input,index,char,unicode,font]=line.split('\t');return {style,command,input,index:Number(index),char,unicode,font};
});
const summaries=[];
for(const style of ['TeX','ISO'])for(const r of mj[style].filter(r=>r.name.endsWith('命令'))){
 const command=r.name.split(' ')[0],tex=records.filter(t=>t.style===style&&t.command===command&&t.input==='macro');
 const literal=records.filter(t=>t.style===style&&t.command===command&&t.input==='unicode');
 const glyphs=r.glyphs.filter(g=>g!=='mjx-c2062');
 const diffs=tex.filter((t,i)=>parseInt(t.char,16)!==parseInt(glyphs[i]?.match(/mjx-c([A-F0-9]+)/)?.[1],16));
 summaries.push({style,command,count:tex.length,texInputAgreement:tex.every((t,i)=>t.char===literal[i]?.char),codepointDifferences:diffs.length,alpha:{tex:tex[0],mathjax:glyphs[0]},details:diffs.map(t=>({index:t.index,tex:t.char,mathjax:glyphs[t.index-1]}))});
}
fs.writeFileSync('comparison.json',JSON.stringify(summaries,null,2));
console.log(JSON.stringify(summaries.map(({details,alpha,...r})=>({...r,alphaTeX:alpha.tex.char,alphaMathJax:alpha.mathjax})),null,2));
