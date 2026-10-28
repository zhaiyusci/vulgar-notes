// SPDX-License-Identifier: GPL-3.0-or-later
// Extract the installed official build's live registries, not minified source text.
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
const {buildSync}=require('esbuild');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const compare=(a,b)=>a<b?-1:a>b?1:0;
const sorted=value=>[...new Set(value)].sort(compare);
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceHash=file=>createHash('sha256').update(fs.readFileSync(file,'utf8').replace(/\r\n?/g,'\n')).digest('hex');
const json=value=>value===undefined?null:typeof value==='function'?{function:value.name||'anonymous'}:value instanceof RegExp?{regexp:value.source,flags:value.flags}:Array.isArray(value)?value.map(json):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort(compare).map(key=>[key,json(value[key])])):value;

async function audit(){
  const install=path.dirname(require.resolve('mathjax/package.json')),version=require('mathjax/package.json').version;
  const policyModule={exports:{}};
  vm.runInNewContext(buildSync({entryPoints:[path.join(root,'src/mathjax-extension-policy.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,{module:policyModule,exports:policyModule.exports});
  const policy=JSON.parse(JSON.stringify(policyModule.exports));
  const M=require('mathjax');
  await M.init({loader:{paths:{mathjax:pathToFileURL(install).href},load:['input/tex',...policy.mathJaxExtensionLoads]},tex:{packages:{'[+]':policy.mathJaxTexPackages,'[-]':policy.mathJaxDisabledTexPackages},require:policy.mathJaxRequireOptions,textmacros:{packages:{'[+]':['textcomp']}}}});
  if(!M._.input?.tex?.TokenMap)throw Error('Installed MathJax did not initialize its official TeX registries.');
  const {TokenMap,MapHandler:{MapHandler},Configuration:{ConfigurationHandler}}=M._.input.tex;
  const configuredPackages=[...M.startup.document.inputJax[0].options.packages];
  const active=M.startup.document.inputJax[0].configuration.handlers;
  const maps=new Map(),effective={macro:new Map(),environment:new Map()},packages=[];
  const remember=map=>{if(map&&map.map instanceof Map)maps.set(map.name,map);};
  const collect=()=>{for(const name of ConfigurationHandler.keys()){
    const configuration=ConfigurationHandler.get(name);
    for(const names of Object.values(configuration.handler??{}))for(const map of names)remember(MapHandler.getMap(map));
  }};collect();
  // Snapshot actual configured precedence before merely registering optional packages.
  for(const kind of ['macro','environment']){
    const handler=active.get(kind);
    for(const {item} of handler._configuration.items??[]){remember(item);for(const name of item.map?.keys()??[]){
      if(effective[kind].has(name))continue;
      if(handler.lookup(name)===item.lookup(name))effective[kind].set(name,item.name);
    }}
  }
  const register=MapHandler.register;MapHandler.register=function(map){remember(map);return register.call(this,map);};
  const extensions=fs.readdirSync(path.join(install,'input/tex/extensions')).filter(file=>file.endsWith('.js')).map(file=>file.slice(0,-3)).sort(compare);
  for(const name of extensions){
    const selection=policy.mathJaxExtensionPolicy.find(entry=>entry.name===name);
    try{await M.loader.load('[tex]/'+name);packages.push({name,status:'registered',policy:selection?.state??'unclassified',candidateExcluded:selection?.state==='excluded',sha256:hash(path.join(install,'input/tex/extensions',name+'.js'))});}
    catch(error){packages.push({name,status:'unavailable',policy:selection?.state??'unclassified',candidateExcluded:selection?.state==='excluded',error:String(error).split(install).join('<mathjax>').split(root).join('<workspace>'),sha256:hash(path.join(install,'input/tex/extensions',name+'.js'))});}
  }
  collect();MapHandler.register=register;
  const ownership=new Map();
  for(const name of ConfigurationHandler.keys()){
    const configuration=ConfigurationHandler.get(name);
    for(const [handler,names] of Object.entries(configuration.handler??{}))for(const map of names){
      const entries=ownership.get(map)??[];entries.push({package:name,handler,context:name.startsWith('text-')?'text':'math'});ownership.set(map,entries);
    }
  }
  const commands=new Map(),environments=new Map(),mapInventory=[];
  for(const [name,map] of [...maps].sort(([a],[b])=>compare(a,b))){
    const kind=map instanceof TokenMap.EnvironmentMap?'environment':map instanceof TokenMap.DelimiterMap?'delimiter':map instanceof TokenMap.CharacterMap?'character':map instanceof TokenMap.CommandMap?'command':map instanceof TokenMap.MacroMap?'macro':'other';
    const owners=ownership.get(name)??[{package:'runtime',handler:'macro',context:'math'}];
    mapInventory.push({name,kind,owners,entries:map.map.size});
    for(const [token,value] of map.map){
      if(typeof token!=='string')continue;
      // Special input characters and regex parsers are grammar, not \commands.
      if(kind==='other'||owners.every(owner=>owner.handler==='character'))continue;
      const target=kind==='environment'?environments:commands;
      const entry=target.get(token)??{name:token,definitions:[]};
      const hasCharacter=typeof value.char==='string';
      for(const owner of owners){
        const syntax=hasCharacter?{kind:'symbol',arity:0}:value.func?.name==='Macro'&&typeof value.args?.[0]==='string'?{kind:'macro-expansion',arity:typeof value.args?.[1]==='number'?value.args[1]:0,...(value.args?.[2]!==undefined?{optionalDefault:json(value.args[2])}:{})}:{kind:'handler-defined'};
        entry.definitions.push({...owner,map:name,kind,...(hasCharacter?{character:value.char,attributes:json(value.attributes)}:{handler:value.func?.name??map.parser?.name??'',args:json(value.args??[])}),syntax,configured:effective[kind==='environment'?'environment':'macro'].get(token)===name});
      }
      target.set(token,entry);
    }
  }
  const finish=entries=>[...entries.values()].sort((a,b)=>compare(a.name,b.name)).map(entry=>({...entry,packages:sorted(entry.definitions.map(def=>def.package)),configured:entry.definitions.some(def=>def.configured),definitions:entry.definitions.sort((a,b)=>compare(a.package+':'+a.map,b.package+':'+b.map))}));
  const commandList=finish(commands),environmentList=finish(environments);
  const source=buildSync({stdin:{contents:"export {EditorModel,catalog,symbols} from './src/editor-model'; export {importMath} from './src/tex-import';export {convertMath} from './src/tex-convert';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
  const exports={exports:{}};vm.runInNewContext(source,{module:exports,exports:exports.exports,console,crypto:globalThis.crypto,URL,TextEncoder,TextDecoder});
  const definitions=[...exports.exports.catalog,...exports.exports.symbols];
  const completionModel=new exports.exports.EditorModel();completionModel.root.items=['\\'];completionModel.index();completionModel.setCursor(completionModel.root.id,1);
  const candidates=completionModel.commandCandidates(),candidateNames=new Set(candidates.map(candidate=>candidate.name));
  const candidateMissing=commandList.filter(command=>command.configured&&/^[A-Za-z]+$/.test(command.name)&&!candidateNames.has(command.name)).map(command=>command.name);
  const intentionalCandidateOmissions=candidateMissing.filter(name=>commandList.find(command=>command.name===name)?.packages.includes('bboldx')&&(/^bfbb/.test(name)||['mathbfbb','imathbfbb','jmathbfbb'].includes(name)));
  const shape=model=>{let raw=0,native=0;const visit=region=>{for(const item of region.items){if(typeof item==='string'){native++;continue;}if(item.type==='source-tex'){raw++;continue;}native++;item.regions.forEach(visit);}};visit(model.root);return raw?native?'mixed':'source':'native';};
  const symbolProbes=commandList.filter(command=>/^[A-Za-z]+$/.test(command.name)&&command.definitions.some(def=>def.configured&&def.context==='math'&&def.syntax.kind==='symbol')).map(command=>{
    const sample='\\'+command.name;return {name:command.name,sample,strictNative:!!exports.exports.importMath(sample),conversion:shape(exports.exports.convertMath(sample))};
  });
  const structureProbes=definitions.filter(definition=>definition.labels.length&&!definition.legacy&&definition.type!=='source-tex').map(definition=>{
    try{const args=definition.previewArgs??definition.labels.map((_,index)=>String.fromCharCode(97+index%26)),sample=definition.render(args);
      return {type:definition.type,command:definition.command,sample,strictNative:!!exports.exports.importMath(sample),conversion:shape(exports.exports.convertMath(sample))};
    }catch{return {type:definition.type,command:definition.command,error:'The catalog sample could not be generated.'};}
  });
  return {schemaVersion:1,mathjaxVersion:version,provenance:{source:'Installed official MathJax TokenMap and ConfigurationHandler runtime registries',inputSha256:hash(path.join(install,'input/tex.js')),appConfigurationSha256:sourceHash(path.join(root,'src/mathjax-config.ts')),extensionPolicySha256:sourceHash(path.join(root,'src/mathjax-extension-policy.ts'))},configuredPackages,packages,maps:mapInventory,commands:commandList,environments:environmentList,coverage:{officialCommandNames:commandList.length,officialEnvironmentNames:environmentList.length,configuredCommandNames:commandList.filter(command=>command.configured).length,existingCandidateNames:candidateNames.size,candidateModes:{native:candidates.filter(candidate=>!candidate.source).length,source:candidates.filter(candidate=>!!candidate.source).length},configuredMissingCandidates:candidateMissing,intentionalCandidateOmissions,unexplainedMissingCandidates:candidateMissing.filter(name=>!intentionalCandidateOmissions.includes(name)),symbolProbes,structureProbes,notes:['Registration/render availability is not native structural editing support.','Handler args are official dispatch configuration; they are not an inferred TeX argument grammar.','CharacterMap tokens establish symbol/no-argument atoms. Macro counts describe declared parameters; expansions may invoke more grammar.','Excluded packages are inventoried where available, never offered as product candidates. BBM and DSFont fonts are not installed or downloaded.','Probes use installed editor and converter code. A structural sample is not proof that every option or variant of that command is editable.']}};
}

if(require.main===module)audit().then(data=>{
  // Shipping command metadata does not require embedding audit probes, sample
  // formulas, registry inventory or diagnostic errors in the browser bundle.
  const runtime={schemaVersion:data.schemaVersion,mathjaxVersion:data.mathjaxVersion,provenance:data.provenance,configuredPackages:data.configuredPackages,commands:data.commands,environments:data.environments};
  const filename=path.join(root,'src/mathjax-command-data.json'),source=JSON.stringify(runtime)+'\n';
  if(process.argv.includes('--check')){if(fs.readFileSync(filename,'utf8').replace(/\r\n?/g,'\n')!==source)throw Error('MathJax command data is stale. Run node scripts/audit-mathjax-coverage.cjs.');}
  else{
    fs.writeFileSync(filename,source);fs.mkdirSync(path.join(root,'diagnostics'),{recursive:true});
    fs.writeFileSync(path.join(root,'diagnostics/mathjax-coverage.json'),JSON.stringify(data,null,2)+'\n');
  }
  console.log(JSON.stringify({mathjaxVersion:data.mathjaxVersion,commands:data.commands.length,environments:data.environments.length,configured:data.coverage.configuredCommandNames,missingCandidates:data.coverage.configuredMissingCandidates.length,runtimeBytes:Buffer.byteLength(source),symbolProbes:Object.fromEntries(['native','mixed','source'].map(kind=>[kind,data.coverage.symbolProbes.filter(probe=>probe.conversion===kind).length])),structureProbes:Object.fromEntries(['native','mixed','source'].map(kind=>[kind,data.coverage.structureProbes.filter(probe=>probe.conversion===kind).length])),unavailable:data.packages.filter(entry=>entry.status!=='registered')},null,2));
}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={audit};
