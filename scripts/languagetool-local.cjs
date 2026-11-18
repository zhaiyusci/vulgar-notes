// SPDX-License-Identifier: GPL-3.0-or-later
// Optional, loopback-only LanguageTool runtime. Nothing is installed globally.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');

const root=path.resolve(__dirname,'../vendor/languagetool');
const stateFile=path.join(root,'service-state.json');
const artifacts=[
  {name:'LanguageTool-6.6.zip',folder:'LanguageTool-6.6',url:'https://languagetool.org/download/LanguageTool-6.6.zip',sha256:'53600506b399bb5ffe1e4c8dec794fd378212f14aaf38ccef9b6f89314d11631'},
  {name:'zulu17.70.113-ca-jre17.0.21.0.3-win_x64.zip',folder:'zulu17.70.113-ca-jre17.0.21.0.3-win_x64',url:'https://cdn.azul.com/zulu/bin/zulu17.70.113-ca-jre17.0.21.0.3-win_x64.zip',sha256:'c5a32fe9b1d2ff07ac4991b57a72d707ad97d54a9cc1bd2f8f005bfd1498d460'},
];
const defaultOrigins=[
  'http://tauri.localhost','https://tauri.localhost','tauri://localhost',
  'https://www.zhaiyusci.net','https://zhaiyusci.github.io',
  ...[8765,8766,8767,8768].flatMap(port=>['http://localhost:'+port,'http://127.0.0.1:'+port]),
];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const literal=value=>"'"+value.replaceAll("'","''")+"'";
async function sha256(file){const hash=crypto.createHash('sha256');for await(const part of fs.createReadStream(file))hash.update(part);return hash.digest('hex');}

async function setup(){
  if(process.platform!=='win32')throw Error('This portable runtime setup currently supports Windows x64.');
  fs.mkdirSync(root,{recursive:true});
  for(const artifact of artifacts){
    const file=path.join(root,artifact.name);
    if(!fs.existsSync(file)||await sha256(file)!==artifact.sha256){
      console.log('Downloading '+artifact.name+' from '+artifact.url);
      const response=await fetch(artifact.url,{signal:AbortSignal.timeout(300000)});
      if(!response.ok)throw Error('Download failed: HTTP '+response.status);
      await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(file+'.partial'));
      if(await sha256(file+'.partial')!==artifact.sha256)throw Error('SHA256 mismatch: '+artifact.name);
      fs.renameSync(file+'.partial',file);
    }
    const folder=path.join(root,artifact.folder);
    if(!fs.existsSync(folder)){
      execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${literal(file)} -DestinationPath ${literal(root)}`],{windowsHide:true,stdio:'inherit'});
    }
    console.log('Verified '+artifact.name+' (SHA256 '+artifact.sha256+')');
  }
  // The original archives and all bundled license/notice files are retained.
  fs.writeFileSync(path.join(root,'download-manifest.json'),JSON.stringify({artifacts,languageToolLicense:'LGPL-2.1-or-later; see LanguageTool-6.6/COPYING.txt and bundled notices',javaLicense:'OpenJDK GPLv2 with Classpath Exception; see the JRE legal directory'},null,2));
  console.log('Ready. Run powershell -File scripts/start-languagetool.ps1');
}

function options(args){
  const result={port:8081,backendPort:8082,origins:new Set(defaultOrigins),java:path.join(root,artifacts[1].folder,'bin/java.exe')};
  for(let i=0;i<args.length;i++){
    const key=args[i],value=args[++i];if(!value)throw Error('Missing value for '+key);
    if(key==='--port'||key==='--backend-port'){
      const port=Number(value);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Use a port from 1024 through 65535.');
      result[key==='--port'?'port':'backendPort']=port;
    }else if(key==='--java')result.java=path.resolve(value);
    else if(key==='--origin'){
      const url=new URL(value);
      if(!['http:','https:','tauri:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||value.includes('*'))throw Error('Additional origins must be exact HTTP(S)/Tauri origins without a path.');
      result.origins.add(value.replace(/\/$/,''));
    }else throw Error('Unknown option '+key);
  }
  if(result.port===result.backendPort)throw Error('The gateway and LanguageTool need different ports.');
  return result;
}

async function status(){
  try{
    const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    const response=await fetch(`http://127.0.0.1:${state.port}/healthz`,{signal:AbortSignal.timeout(1500)});
    const body=await response.json();if(body.service!=='vulgar-notes-languagetool'||body.pid!==state.pid)return;
    return {...body,endpoint:`http://127.0.0.1:${state.port}/v2`};
  }catch{return;}
}

async function stop(){
  const running=await status();if(!running){console.log('Local LanguageTool is not running.');return;}
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  const response=await fetch(`http://127.0.0.1:${state.port}/__shutdown`,{method:'POST',headers:{Authorization:'Bearer '+state.token},signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw Error('Could not stop this local runtime (HTTP '+response.status+').');
  console.log('Local LanguageTool stopped.');
}

async function serve(args){
  const config=options(args),existing=await status();if(existing){console.log('Already running: '+existing.endpoint);return;}
  const languageTool=path.join(root,artifacts[0].folder);
  for(const file of [config.java,path.join(languageTool,'languagetool-server.jar')])if(!fs.existsSync(file))throw Error('Missing '+file+'. Run scripts/setup-languagetool.ps1 first.');
  fs.mkdirSync(root,{recursive:true});
  const properties=path.join(root,'server.properties');
  fs.writeFileSync(properties,'maxTextLength=20000\nmaxTextHardLength=20000\nmaxCheckTimeMillis=20000\nmaxCheckThreads=2\nmaxWorkQueueSize=20\ncacheSize=256\npipelineCaching=true\npipelineExpireTimeInSeconds=3600\nskipLoggingChecks=true\nskipLoggingRuleMatches=true\n');
  const javaLog=fs.openSync(path.join(root,'languagetool.log'),'a');
  const java=spawn(config.java,['-Xms128m','-Xmx1024m','-Djava.net.preferIPv4Stack=true','-cp','languagetool-server.jar','org.languagetool.server.HTTPServer','--config',properties,'--port',String(config.backendPort),'--notLogIP'],{cwd:languageTool,windowsHide:true,stdio:['ignore',javaLog,javaLog]});
  fs.closeSync(javaLog);
  let closing=false,server;
  const token=crypto.randomBytes(32).toString('hex');
  const cleanup=()=>{
    if(closing)return;closing=true;server?.closeAllConnections();server?.close();java.kill();
    try{const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(state.pid===process.pid)fs.unlinkSync(stateFile);}catch{}
  };
  process.once('exit',cleanup);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{cleanup();process.exit(0);});
  java.once('error',error=>{console.error('Java could not start: '+error.message);cleanup();process.exitCode=1;});
  java.once('exit',code=>{if(!closing){console.error('LanguageTool exited with code '+code+'; see vendor/languagetool/languagetool.log');cleanup();process.exitCode=1;}});
  try{
    const backend=`http://127.0.0.1:${config.backendPort}`;
    let ready=false;
    for(let i=0;i<100&&!closing;i++){
      try{const response=await fetch(backend+'/v2/languages',{signal:AbortSignal.timeout(1000)});if(response.ok){await response.arrayBuffer();ready=true;break;}}catch{}
      await sleep(200);
    }
    if(!ready)throw Error('LanguageTool did not become ready; see vendor/languagetool/languagetool.log');
    server=http.createServer(async(req,res)=>{
      const host=req.headers.host,origin=req.headers.origin;
      const reply=(code,message)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:message}));};
      if(![`127.0.0.1:${config.port}`,`localhost:${config.port}`].includes(host)){reply(403,'Invalid local host');return;}
      if(origin&&!config.origins.has(origin)){reply(403,'Origin is not allowed');return;}
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS'){
        const requested=(req.headers['access-control-request-headers']??'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean);
        if(!['GET','POST'].includes(req.headers['access-control-request-method'])||requested.some(value=>value!=='content-type')){reply(403,'Preflight is not allowed');return;}
        res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
        if(origin&&req.headers['access-control-request-private-network']==='true')res.setHeader('Access-Control-Allow-Private-Network','true');
        res.writeHead(204);res.end();return;
      }
      if(req.url==='/healthz'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({service:'vulgar-notes-languagetool',version:'6.6',pid:process.pid,backendPid:java.pid,ready:true}));return;}
      if(req.url==='/__shutdown'&&req.method==='POST'){
        if(origin||req.headers.authorization!=='Bearer '+token){reply(403,'Not allowed');return;}
        res.writeHead(200,{'Content-Type':'application/json'});res.end('{"stopped":true}');setTimeout(()=>{cleanup();process.exit(0);},50);return;
      }
      if(!['/v2/check','/v2/languages'].includes(req.url)||!['GET','POST'].includes(req.method)){reply(404,'Unknown LanguageTool endpoint');return;}
      if(req.method==='POST'&&!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(req.headers['content-type']??'')){reply(415,'Use application/x-www-form-urlencoded');return;}
      const abort=new AbortController();res.once('close',()=>{if(!res.writableEnded)abort.abort();});
      const timeout=setTimeout(()=>abort.abort(),30000);
      try{
        const chunks=[];let length=0;
        for await(const chunk of req){length+=chunk.length;if(length>262144){reply(413,'Request too large');return;}chunks.push(chunk);}
        const response=await fetch(backend+req.url,{method:req.method,headers:req.method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{},...(req.method==='POST'?{body:Buffer.concat(chunks)}:{}),signal:abort.signal});
        const body=await response.arrayBuffer();if(body.byteLength>4194304){reply(502,'LanguageTool response too large');return;}
        res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')??'application/json','Cache-Control':'no-store'});res.end(Buffer.from(body));
      }catch{if(!res.destroyed)reply(abort.signal.aborted?504:502,'Local LanguageTool request failed');}
      finally{clearTimeout(timeout);}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve);});
    fs.writeFileSync(stateFile,JSON.stringify({pid:process.pid,port:config.port,backendPort:config.backendPort,token,startedAt:new Date().toISOString(),origins:[...config.origins]},null,2));
    console.log('LanguageTool 6.6 ready at http://127.0.0.1:'+config.port+'/v2 (local only).');
  }catch(error){cleanup();throw error;}
}

async function main(){
  const [command,...args]=process.argv.slice(2);
  if(command==='setup')await setup();
  else if(command==='serve')await serve(args);
  else if(command==='stop')await stop();
  else if(command==='status'){const result=await status();if(!result){console.log('Local LanguageTool is not running.');process.exitCode=1;}else console.log(JSON.stringify(result));}
  else throw Error('Usage: node scripts/languagetool-local.cjs setup|serve|stop|status');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={artifacts,defaultOrigins,options};
