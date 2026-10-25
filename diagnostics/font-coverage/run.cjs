const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const fonts=['NewCMMath-Regular.otf','NewCMSansMath-Regular.otf','STIXTwoMath-Regular.otf','XITSMath-Regular.otf','Asana-Math.otf','LibertinusMath-Regular.otf','FiraMath-Regular.otf','LeteSansMath.otf','KpMath-Regular.otf','KpMath-Sans.otf','GFSNeohellenicMath.otf','IBMPlexMath-Regular.otf'];
const cases=JSON.parse(fs.readFileSync('../all-fonts-greek-results.json','utf8')).TeX;
const commands=['symnormal','symup','symit','symbfup','symbfit','symsfup','symsfit','symbfsfup','symbfsfit','symbb','symcal','symscr','symbfcal','symbfscr','symfrak','symbffrak','symtt'];
fs.copyFileSync('../tex-font-audit/audit.lua','audit.lua');
const summary=[];
for(let i=0;i<fonts.length;i++){
 const font=fonts[i],job='font-'+String(i+1).padStart(2,'0');
 const location=spawnSync('C:/texlive/2026/bin/windows/kpsewhich.exe',[font],{encoding:'utf8'}).stdout.trim();
 if(!location)throw Error('Missing '+font);
 let tex=String.raw`\documentclass[11pt]{article}
\usepackage[a4paper,margin=18mm]{geometry}
\usepackage[math-style=ISO]{unicode-math}
\usepackage{booktabs}
\directlua{dofile('audit.lua')}
\newsavebox{\auditbox}
\newcommand{\record}[4]{\sbox{\auditbox}{$#4$}\directlua{audit('#1','#2','#3',\number\auditbox)}}
`;
 tex+=`\\setmathfont{${font}}\n\\begin{document}\n\\section*{${font.replaceAll('-',' - ')}}\nTeX Live 2026 / LuaLaTeX / unicode-math 0.8r / ISO.\\par\nEach row tests 44 Greek letters and symbols (recorded separately).\\par\\medskip\n\\begin{tabular}{lll}\\toprule\nCommand & Latin & Greek \\\\ \\midrule\n`;
 for(const command of commands){
  const source=cases.find(r=>r.name===command+' 命令').source;
  tex+=`\\record{ISO}{${command}}{macro}{${source}}\n`;
  tex+=`\\texttt{${command}} & $\\${command}{AaBg}$ & $\\${command}{\\alpha\\gamma\\pi\\Gamma\\Delta\\Pi\\Sigma}$ \\\\[5pt]\n`;
 }
 tex+='\\bottomrule\\end{tabular}\\end{document}\n';
 fs.writeFileSync('main.tex',tex);
 const result=spawnSync('C:/texlive/2026/bin/windows/lualatex.exe',['-interaction=nonstopmode','-halt-on-error','-jobname='+job,'main.tex'],{encoding:'utf8'});
 fs.writeFileSync(job+'.console.txt',result.stdout+result.stderr);
 if(result.status!==0)throw Error(font+' compile failed');
 fs.copyFileSync('glyphs.tsv',job+'.tsv');
 fs.copyFileSync('main.tex',job+'.tex');
 const lines=fs.readFileSync(job+'.tsv','utf8').trim().split(/\r?\n/).slice(1).map(l=>l.split('\t'));
 const base=lines.filter(l=>l[1]==='symnormal');
 const rows=commands.map(c=>{const r=lines.filter(l=>l[1]===c);return {command:c,count:r.length,alpha:r[0]?.[4],changedCodepoints:r.filter((x,j)=>x[4]!==base[j]?.[4]).length};});
 const missing=(result.stdout.match(/Missing character:/g)||[]).length;
 summary.push({font,location,job,missing,rows});
 console.log(font+': compiled; missing-character warnings='+missing);
}
fs.writeFileSync('results.json',JSON.stringify(summary,null,2));
