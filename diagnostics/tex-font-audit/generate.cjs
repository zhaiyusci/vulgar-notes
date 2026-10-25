const fs=require('node:fs');
const results=JSON.parse(fs.readFileSync('../all-fonts-greek-results.json','utf8'));
const rows=results.TeX.filter(r=>r.name.endsWith('命令'));
let tex=String.raw`\documentclass[11pt]{article}
\usepackage[a4paper,margin=18mm]{geometry}
\usepackage{unicode-math}
\usepackage{booktabs}
\setmathfont{NewCMMath-Regular.otf}
\directlua{dofile('audit.lua')}
\newsavebox{\auditbox}
\newcommand{\record}[4]{\sbox{\auditbox}{$#4$}\directlua{audit('#1','#2','#3',\number\auditbox)}}
\begin{document}
`;
for(const style of ['TeX','ISO']){
 tex+=`\\unimathsetup{math-style=${style}}\\setmathfont{NewCMMath-Regular.otf}\n\\section*{Greek font audit: ${style}}\nLuaLaTeX / TeX Live 2026; unicode-math 0.8r.\\\\
New Computer Modern Math (Regular).\\\\
The table shows seven representative letters. Full glyph records cover all 44 tested characters per input.\n\\medskip\n\\begin{tabular}{lll}\\toprule\nCommand & Macro input & Unicode input \\\\\n\\midrule\n`;
 for(const row of rows){
  const cmd=row.name.split(' ')[0];
  const literal=results.TeX.find(r=>r.name===cmd+' 字符').source;
  tex+=`\\record{${style}}{${cmd}}{macro}{${row.source}}\n\\record{${style}}{${cmd}}{unicode}{${literal}}\n`;
  tex+=`\\texttt{${cmd}} & $\\${cmd}{\\alpha\\gamma\\pi\\Gamma\\Delta\\Pi\\Sigma}$ & $\\${cmd}{αγπΓΔΠΣ}$ \\\\[3pt]\n`;
 }
 tex+='\\bottomrule\\end{tabular}\n\\clearpage\n';
}
tex+='\\end{document}\n';fs.writeFileSync('main.tex',tex);


