const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf',
  '.otf':'font/otf','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
const defaultRoot=()=>fs.existsSync(path.join(__dirname,'index.html'))?__dirname:path.resolve(__dirname,'../math-editor-dist');
function openDefaultBrowser(url){
  const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  const child=spawn(command,args,{detached:true,windowsHide:true,stdio:'ignore'});
  child.once('error',()=>console.warn('The browser could not be opened. Open the printed URL manually.'));child.unref();
}

/** A read-only localhost asset server; opening a browser requires an explicit option. */
async function startMathEditorServer({root=defaultRoot(),port=0,open=false}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Port must be an integer from 0 to 65535.');
  const directory=fs.realpathSync(root);
  for(const filename of ['index.html','standalone-math-editor.js'])if(!fs.statSync(path.join(directory,filename)).isFile())throw Error('Build the standalone formula editor first.');
  const server=http.createServer((request,response)=>{
    const address=server.address(),expectedPort=typeof address==='object'&&address?address.port:0;
    if(!['127.0.0.1:'+expectedPort,'localhost:'+expectedPort].includes(request.headers.host)){
      response.writeHead(403);response.end('Forbidden');return;
    }
    if(request.method!=='GET'&&request.method!=='HEAD'){
      response.writeHead(405,{Allow:'GET, HEAD'});response.end('Method not allowed');return;
    }
    let file;
    try{
      const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
      if(pathname.includes('\\')||pathname.includes('\0'))throw Error('Invalid path');
      file=path.resolve(directory,pathname==='/'?'index.html':pathname.replace(/^\//,''));
      if(!file.startsWith(directory+path.sep))throw Error('Outside package');
    }catch{response.writeHead(400);response.end('Bad request');return;}
    const type=mime[path.extname(file)];
    let available=false;
    try{available=!!type&&fs.realpathSync(file).startsWith(directory+path.sep)&&fs.statSync(file).isFile();}catch{/* Missing/inaccessible assets are ordinary 404s. */}
    if(!available){
      response.writeHead(404);response.end('Not found');return;
    }
    response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    if(request.method==='HEAD'){response.end();return;}
    const stream=fs.createReadStream(file);stream.on('error',()=>response.destroy());stream.pipe(response);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const url='http://127.0.0.1:'+server.address().port+'/';
  console.log('Formula editor: '+url);console.log('Press Ctrl+C to stop.');
  if(open)openDefaultBrowser(url);
  return {server,url,root:directory};
}

if(require.main===module){
  const args=process.argv.slice(2),portArg=args.find(arg=>arg.startsWith('--port='));
  if(args.some(arg=>arg!=='--open'&&!arg.startsWith('--port='))){
    console.error('Usage: node server.cjs [--open] [--port=0]');process.exitCode=1;
  }else startMathEditorServer({open:args.includes('--open'),port:portArg?Number(portArg.slice(7)):0}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={startMathEditorServer};
