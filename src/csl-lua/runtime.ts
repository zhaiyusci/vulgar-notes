import {WASI,File,OpenFile,ConsoleStdout} from '@bjorn3/browser_wasi_shim';
import {luaModules,dataFiles} from './assets.generated';
import {runtimeBase64} from './runtime.generated';

interface LuaExports extends WebAssembly.Exports {
  memory:WebAssembly.Memory;
  vn_alloc:(size:number)=>number;
  vn_free:(pointer:number)=>void;
  vn_init:()=>number;
  vn_add_module:(name:number,nameLength:number,source:number,sourceLength:number)=>number;
  vn_run:(source:number,length:number)=>number;
  vn_call:(name:number,nameLength:number,input:number,inputLength:number)=>number;
  vn_output_ptr:()=>number;
  vn_output_len:()=>number;
}

// Only this packaged program is evaluated. Document metadata is passed as a
// length-delimited string to vn_call, then decoded as JSON inside Lua.
const bootstrap=String.raw`
local json=require("dkjson")
local assets={}
package.preload["datafile"]=function()
  return {open=function(path,mode)
    if mode~="r" then return nil,"Packaged data is read-only" end
    local value=assets[path:match("([^/]+)$")]
    if not value then return nil,"Unknown packaged data file" end
    return {read=function(_,format)
      assert(format=="*a" or format=="a","Unsupported data read")
      return value
    end,close=function() return true end}
  end}
end
function vulgar_configure(encoded)
  local value,_,err=json.decode(encoded)
  assert(value and not err,"Invalid packaged data")
  assets=value
  return "ok"
end
function vulgar_format(encoded)
  local request,_,err=json.decode(encoded)
  assert(request and not err,"Invalid formatting request")
  local items={} local ids={}
  for _,item in ipairs(request.items) do
    items[item.id]=item
    ids[#ids+1]=item.id
  end
  local citeproc=require("citeproc")
  local processor=citeproc.new({
    retrieveLocale=function(language)
      return request.locales[language]
        or (language=="en" and request.locales["en-US"])
        or (language=="zh" and request.locales["zh-CN"])
        or false
    end,
    retrieveItem=function(id) return items[id] end,
  },request.style,request.locale,true)
  processor:set_output_format("html")
  processor:updateItems(ids)
  local bibliography=processor:makeBibliography()
  local result=json.encode({ids=bibliography[1].entry_ids,html=bibliography[2]})
  return result
end
return "ok"
`;

class LuaRuntime {
  private readonly exports:LuaExports;
  private readonly encoder=new TextEncoder();
  private readonly decoder=new TextDecoder();
  constructor(){
    // No host directories, environment variables or network access are given
    // to the interpreter. Its datafile module only reads the bundled UCD data.
    const wasi=new WASI([],[],[new OpenFile(new File([])),ConsoleStdout.lineBuffered(()=>{}),ConsoleStdout.lineBuffered(()=>{})],{debug:false});
    const bytes=Uint8Array.from(atob(runtimeBase64),character=>character.charCodeAt(0));
    const instance=new WebAssembly.Instance(new WebAssembly.Module(bytes),{wasi_snapshot_preview1:wasi.wasiImport});
    this.exports=instance.exports as LuaExports;
    wasi.initialize({exports:this.exports});
    this.check(this.exports.vn_init());
    for(const [name,source] of Object.entries(luaModules)){
      this.withStrings([name,source],([key,code])=>this.check(this.exports.vn_add_module(key.pointer,key.length,code.pointer,code.length)));
    }
    this.withStrings([bootstrap],([source])=>this.check(this.exports.vn_run(source.pointer,source.length)));
    const files=Object.fromEntries(Object.entries(dataFiles).map(([name,contents])=>[name.split('/').at(-1)!,contents]));
    this.call('vulgar_configure',JSON.stringify(files));
  }
  private check(status:number){
    if(status!==0){
      const cause=this.decoder.decode(new Uint8Array(this.exports.memory.buffer,this.exports.vn_output_ptr(),this.exports.vn_output_len()));
      throw Error('The reference formatter could not run.',{cause});
    }
  }
  private withStrings<T>(values:string[],callback:(strings:{pointer:number;length:number}[])=>T):T {
    const strings:{pointer:number;length:number}[]=[];
    try{
      for(const value of values){
        const bytes=this.encoder.encode(value),pointer=this.exports.vn_alloc(bytes.length||1);
        if(!pointer)throw Error('The reference formatter ran out of memory.');
        strings.push({pointer,length:bytes.length});
        new Uint8Array(this.exports.memory.buffer,pointer,bytes.length).set(bytes);
      }
      return callback(strings);
    }finally{for(const {pointer} of strings)this.exports.vn_free(pointer);}
  }
  call(name:string,value:string):string {
    return this.withStrings([name,value],([key,input])=>{
      this.check(this.exports.vn_call(key.pointer,key.length,input.pointer,input.length));
      return this.decoder.decode(new Uint8Array(this.exports.memory.buffer,this.exports.vn_output_ptr(),this.exports.vn_output_len()));
    });
  }
}

let runtime:LuaRuntime|undefined;
export interface LuaBibliography {ids:string[];html:string[]}
/** Both the browser and Tauri use this same local CSL interpreter. */
export function renderCSLBibliography(items:unknown[],style:string,locale:string,locales:Record<string,string>):LuaBibliography {
  runtime??=new LuaRuntime();
  const result=JSON.parse(runtime.call('vulgar_format',JSON.stringify({items,style,locale,locales}))) as LuaBibliography;
  if(!Array.isArray(result.ids)||!Array.isArray(result.html)||result.ids.length!==result.html.length||
     !result.ids.every(id=>typeof id==='string')||!result.html.every(html=>typeof html==='string'))throw Error('The reference formatter returned invalid data.');
  return result;
}
