const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
// Local-only test fixture. The production editor remains on port 8767.
http.createServer((req,res)=>{
 const config=new URL(req.url,'http://localhost').pathname==='/mathjax-config.js';
 res.setHeader('Content-Type',config?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 res.end(fs.readFileSync(path.join(__dirname,config?'../mathjax-config.js':'greek-fonts.html')));
}).listen(8768,'127.0.0.1');
