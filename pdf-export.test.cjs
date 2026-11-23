const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const Module=require('node:module');
const {buildSync}=require('esbuild');
const loaded=new Module(path.resolve('pdf-export-api.cjs'),module);loaded.paths=module.paths;
loaded._compile(buildSync({entryPoints:['src/pdf-export.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text,loaded.id);
const {exportPdfDocument,waitForPrintResources}=loaded.exports;
const settings={paper:'a4',landscape:false,marginMm:20,pageNumbers:true};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function printWindow(){
  const calls=[],listeners=new Map();
  const document={title:'',body:{textContent:'',offsetHeight:1},images:[],fonts:{ready:Promise.resolve()},
    open(){calls.push('open');},write(html){calls.push(['write',html]);},close(){calls.push('document-close');}};
  const target={document,closed:false,opener:{},requestAnimationFrame(callback){queueMicrotask(callback);return 1;},
    addEventListener(event,callback){listeners.set(event,callback);},focus(){calls.push('focus');},print(){calls.push('print');},
    close(){target.closed=true;calls.push('window-close');}};
  return {target,calls,fire:event=>listeners.get(event)?.()};
}

test('web export opens from the gesture before rendering and prints only after fonts settle',async()=>{
  const w=printWindow(),render=deferred(),fonts=deferred(),order=[];w.target.document.fonts.ready=fonts.promise;
  const pending=exportPdfDocument(()=>{order.push('render');return render.promise;},settings,'sample.pdf',{
    native:false,openWindow:()=>{order.push('window');return w.target;},saveNative:()=>{throw Error('Wrong platform');},
  });
  assert.deepEqual(order,['window','render']);assert.equal(w.target.opener,null);
  render.resolve('<html><body>Ready</body></html>');await tick();
  assert.equal(w.calls.includes('print'),false);
  fonts.resolve();assert.equal(await pending,true);
  assert.ok(w.calls.some(call=>Array.isArray(call)&&call[0]==='write'&&call[1].includes('Ready')));
  assert.equal(w.calls.at(-1),'print');assert.equal(w.target.closed,false);
  w.fire('afterprint');assert.equal(w.target.closed,true);
});

test('native export passes the complete snapshot and settings without opening a browser tab',async()=>{
  const calls=[];const result=await exportPdfDocument(async()=>'<html>snapshot</html>',settings,'sample.pdf',{
    native:true,openWindow:()=>{throw Error('Unexpected tab');},saveNative:async(...args)=>{calls.push(args);return false;},
  });
  assert.equal(result,false,'a cancelled native save is not reported as saved');
  assert.deepEqual(calls,[['<html>snapshot</html>',settings,'sample.pdf']]);
});

test('blocked popups do not begin rendering the document',async()=>{
  let rendered=false;
  await assert.rejects(exportPdfDocument(async()=>{rendered=true;return '';},settings,undefined,{
    native:false,openWindow:()=>null,saveNative:async()=>true,
  }),/Allow pop-ups/);
  assert.equal(rendered,false);
});

test('snapshot failure closes only the independent print window and never prints',async()=>{
  const w=printWindow();
  await assert.rejects(exportPdfDocument(async()=>{throw Error('Snapshot failed');},settings,undefined,{
    native:false,openWindow:()=>w.target,saveNative:async()=>true,
  }),/Snapshot failed/);
  assert.equal(w.target.closed,true);assert.equal(w.calls.includes('print'),false);
});

test('closing the print tab while rendering cancels without writing or printing',async()=>{
  const w=printWindow(),render=deferred();
  const pending=exportPdfDocument(()=>render.promise,settings,undefined,{
    native:false,openWindow:()=>w.target,saveNative:async()=>true,
  });
  w.target.close();render.resolve('<html>snapshot</html>');
  assert.equal(await pending,false);assert.deepEqual(w.calls,['window-close']);
});

test('images finish before print readiness, and failed images reject instead of creating incomplete PDFs',async()=>{
  const w=printWindow(),image=new EventTarget();Object.assign(image,{complete:false,naturalWidth:0,loading:'lazy'});
  w.target.document.images.push(image);
  let ready=false;const pending=waitForPrintResources(w.target,1000).then(()=>{ready=true;});await tick();
  assert.equal(ready,false);assert.equal(image.loading,'eager');image.naturalWidth=20;image.dispatchEvent(new Event('load'));
  await pending;assert.equal(ready,true);
  w.target.document.images=[{complete:true,naturalWidth:0}];
  await assert.rejects(waitForPrintResources(w.target),/image could not be loaded/);
});

test('resource readiness has a bounded timeout',async()=>{
  const w=printWindow();w.target.document.fonts.ready=new Promise(()=>{});
  await assert.rejects(waitForPrintResources(w.target,5),/did not finish loading/);
});

test('closing a print tab during font loading cancels promptly without an error or print',async()=>{
  const w=printWindow();w.target.document.fonts.ready=new Promise(()=>{});
  const pending=exportPdfDocument(async()=>'<html>snapshot</html>',settings,undefined,{
    native:false,openWindow:()=>w.target,saveNative:async()=>true,
  });
  await tick();w.target.close();
  assert.equal(await pending,false);assert.equal(w.calls.includes('print'),false);
});

test('background tabs use the paint fallback only after their resources finish',async()=>{
  const w=printWindow(),fonts=deferred();let ready=false;
  w.target.document.fonts.ready=fonts.promise;
  w.target.requestAnimationFrame=()=>1;
  const pending=waitForPrintResources(w.target,1000).then(()=>{ready=true;});
  await new Promise(resolve=>setTimeout(resolve,120));assert.equal(ready,false,'the paint fallback never skips font loading');
  fonts.resolve();await pending;assert.equal(ready,true);
});
