const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = {
  '/': ['mathjax4_editor_prototype_document_typeset.html', 'text/html'],
  '/editor-model.js': ['editor-model.js', 'text/javascript'],
  '/editor-ui.js': ['dist/editor-ui.js', 'text/javascript'],
  '/plate.css': ['plate.css', 'text/css'],
  '/editor-ui.css': ['dist/editor-ui.css', 'text/css'],
  '/mathjax-config.js': ['mathjax-config.js', 'text/javascript'],
  '/editor-model.js.map': ['editor-model.js.map', 'application/json'],
  '/editor-ui.js.map': ['dist/editor-ui.js.map', 'application/json'],
  '/mathjax-config.js.map': ['mathjax-config.js.map', 'application/json']
};
http.createServer((req, res) => {
  const pathname=new URL(req.url, 'http://localhost').pathname;
  const chunk=/^\/chunks\/[a-zA-Z0-9_-]+\.js(?:\.map)?$/.test(pathname)?'dist'+pathname:null;
  const file = files[pathname] || (chunk&&fs.existsSync(path.join(__dirname,chunk))?[chunk,pathname.endsWith('.map')?'application/json':'text/javascript']:null);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  res.setHeader('Content-Type', file[1] + '; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(fs.readFileSync(path.join(__dirname, file[0])));
}).listen(8767, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:8767/'));
