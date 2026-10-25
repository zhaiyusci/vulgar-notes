// Compile without shipping out pages: this is a glyph audit, not a PDF artifact.
const fs=require('node:fs');
const {catalog}=require('../../editor-model.js');
const commands=catalog.filter(d=>d.font&&!d.legacy&&d.command.startsWith('\\sym')).map(d=>d.command.slice(1));
const text=String.raw`Aa019\alpha\Gamma\gamma\pi\Pi\Sigma\partial\nabla\imath\jmath ϝ`;
let source=String.raw`\documentclass{article}
\usepackage{unicode-math}
\directlua{dofile('audit.lua')}
\newsavebox{\auditbox}
\newcommand{\record}[4]{\sbox{\auditbox}{$#4$}\directlua{audit('#1','#2','#3',\number\auditbox)}}
\begin{document}
`;
for(const style of ['TeX','ISO']){
 source+=`\\unimathsetup{math-style=${style}}\\setmathfont{NewCMMath-Regular.otf}\n`;
 source+=`\\record{${style}}{default}{macro}{${text}}\n`;
 for(const command of commands)source+=`\\record{${style}}{${command}}{macro}{\\${command}{${text}}}\n`;
 for(const command of ['symcal','symbb','symsf','symtt'])source+=`\\record{${style}}{${command}}{nested}{\\symbf{\\${command}{${text}}}}\n`;
}
fs.writeFileSync('main.tex',source+'\\end{document}\n');
