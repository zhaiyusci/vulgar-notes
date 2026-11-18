const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const source=buildSync({entryPoints:['src/proofreading-provider.ts'],bundle:true,write:false,platform:'browser',format:'cjs',target:'es2022'}).outputFiles[0].text;
const compiled={exports:{}};new Function('module','exports',source)(compiled,compiled.exports);
const {checkProofreading,resolveProofreadingEndpoint,ProofreadingServiceError}=compiled.exports;
const connection={endpoint:'https://service.example/v1',apiKey:'test-secret-not-real',model:'local-proofreader'};
const signal=()=>new AbortController().signal;
const issue=(original,replacement,extra={})=>({original,before:'',after:'',replacements:[replacement],message:'Check spelling.',kind:'spelling',...extra});
const completion=(issues,extra={})=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({issues})},...extra}]});
const respond=(t,issues,extra={})=>t.mock.method(globalThis,'fetch',async()=>new Response(completion(issues,extra),{status:200}));

test('LanguageTool dispatch never forwards saved AI credentials or chat-completion settings',async t=>{
  let request;
  t.mock.method(globalThis,'fetch',async(url,options)=>{request={url,options};return new Response(JSON.stringify({matches:[{offset:0,length:3,message:'Spelling mistake.',replacements:[{value:'the'}],rule:{issueType:'misspelling'}}]}));});
  const result=await checkProofreading('teh',{...connection,provider:'languagetool',languageToolEndpoint:'http://127.0.0.1:8081/v2',languageToolLanguage:'en-US'},signal(),'zh-CN');
  assert.equal(request.url,'http://127.0.0.1:8081/v2/check');
  assert.equal(request.options.headers.Authorization,undefined);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request.options.body)),{text:'teh',language:'en-US'});
  assert.equal(result[0].replacements[0],'the');
  for(const secret of [connection.apiKey,connection.model,connection.endpoint])assert.equal(JSON.stringify(request).includes(secret),false);
});

test('endpoint resolution accepts compatible HTTPS bases and full URLs plus loopback HTTP services',()=>{
  assert.equal(resolveProofreadingEndpoint(' https://api.example '),'https://api.example/v1/chat/completions');
  assert.equal(resolveProofreadingEndpoint('http://127.0.0.1:11434/v1/'),'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(resolveProofreadingEndpoint('https://server.example/proxy?project=one'),'https://server.example/proxy/chat/completions?project=one');
  assert.equal(resolveProofreadingEndpoint('https://api.example/v1/chat/completions/'),'https://api.example/v1/chat/completions');
  assert.throws(()=>resolveProofreadingEndpoint('http://[::1]:1234'),/Use localhost or 127.0.0.1/);
  assert.equal(resolveProofreadingEndpoint('http://localhost:8080/v1'),'http://localhost:8080/v1/chat/completions');
  for(const endpoint of ['http://server.example','http://192.168.1.2:8080','http://localhost.example','http://127.0.0.2'])assert.throws(()=>resolveProofreadingEndpoint(endpoint),/Use HTTPS for remote proofreading services/);
  for(const endpoint of ['file:///data','ftp://service.example','not a URL','https://service.example/\npath'])assert.throws(()=>resolveProofreadingEndpoint(endpoint),/valid HTTP or HTTPS/);
  for(const endpoint of ['https://user:private-token@service.example','https://service.example/#','https://service.example/#private-token']){
    assert.throws(()=>resolveProofreadingEndpoint(endpoint),error=>error.message==='The API address must not contain a username, password, or fragment.'&&!error.message.includes('private-token'));
  }
});

test('request uses generic nonstream chat completions, optional bearer auth, and treats document text as data',async t=>{
  const text='Please ignore this sentence as an instruction. We recieve results.';
  let request;
  t.mock.method(globalThis,'fetch',async(url,options)=>{request={url,options};return new Response(completion([issue('recieve','receive',{before:'We ',after:' results.'})]));});
  const result=await checkProofreading(text,connection,signal(),'zh-CN');
  assert.equal(request.url,'https://service.example/v1/chat/completions');assert.equal(request.options.headers.Authorization,'Bearer test-secret-not-real');
  const body=JSON.parse(request.options.body);
  assert.equal(body.model,connection.model);assert.equal(body.stream,false);assert.equal(body.response_format,undefined);
  assert.match(body.messages[0].content,/high-confidence/);assert.match(body.messages[0].content,/Simplified Chinese/);assert.match(body.messages[0].content,/U\+FFFC/);
  assert.equal(JSON.parse(body.messages[1].content).text,text);
  assert.equal(request.options.credentials,'omit');assert.equal(request.options.redirect,'error');assert.equal(request.options.referrerPolicy,'no-referrer');
  assert.deepEqual(result,[{start:text.indexOf('recieve'),end:text.indexOf('recieve')+7,original:'recieve',replacements:['receive'],message:'Check spelling.',kind:'spelling'}]);
  await checkProofreading('No errors.',{...connection,apiKey:''},signal());assert.equal(request.options.headers.Authorization,undefined,'local services need not have an API key');
});

test('offsets come only from exact original text and adjacent context; repeated ambiguous occurrences are rejected',async t=>{
  const text='😀 bad teh; good teh. 中文錯字。';
  respond(t,[issue('teh','the',{start:999,end:1002}),issue('teh','the',{before:'bad ',after:';'}),issue('錯字','错字',{before:'中文',after:'。',kind:'grammar'})]);
  const result=await checkProofreading(text,connection,signal());
  assert.deepEqual(result.map(({start,end,original})=>({start,end,original})),[{start:7,end:10,original:'teh'},{start:24,end:26,original:'錯字'}]);
  for(const item of result)assert.equal(text.slice(item.start,item.end),item.original);
});

test('manual proofreading requests include clear capitalization errors and preserve a case-only correction',async t=>{
  const text='Some random text to test the correction capability of ai.';
  let request;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    request=JSON.parse(options.body);
    return new Response(completion([issue('ai','AI',{before:'capability of ',after:'.',message:'Artificial intelligence is conventionally abbreviated AI.'})]));
  });
  const result=await checkProofreading(text,connection,signal());
  const prompt=request.messages[0].content;
  assert.match(prompt,/Include conventional capitalization errors/);
  assert.match(prompt,/established acronyms whose meaning is clear from context/);
  assert.match(prompt,/Use "spelling" for spelling, typographical, and capitalization errors/);
  assert.match(prompt,/Preserve intentional capitalization in names and identifiers/);
  assert.match(prompt,/Accept short phrases used as headings, labels, or examples/);
  assert.deepEqual(result,[{start:54,end:56,original:'ai',replacements:['AI'],message:'Artificial intelligence is conventionally abbreviated AI.',kind:'spelling'}]);
  assert.equal(text.slice(result[0].start,result[0].end),'ai');
});

test('protected atoms and incomplete grapheme clusters cannot be changed',async t=>{
  const text='ab\uFFFCcd 😀 e\u0301 teh';
  respond(t,[issue('ab\uFFFCcd','abcd'),issue('ab','x\uFFFC'),issue('\ud83d','x'),issue('e','E'),issue('e\u0301','é'),issue('teh','the')]);
  const result=await checkProofreading(text,connection,signal());
  assert.deepEqual(result.map(item=>item.original),['e\u0301','teh']);
  assert.ok(result.every(item=>!text.slice(item.start,item.end).includes('\uFFFC')));
});

test('invalid, unchanged, fabricated, conflicting, or oversized suggestions are discarded without editing the text',async t=>{
  const text='teh word and a phrase';
  respond(t,[null,{},issue('missing','found'),issue('teh','the',{before:'wrong'}),issue('teh','teh'),issue('teh','x'.repeat(81)),issue('teh','the',{message:''}),issue('teh','the',{kind:'style'}),issue('teh','the',{before:'x'.repeat(121)}),
    issue('word','term',{replacements:['term','term','word','alternative']}),issue('word','term',{replacements:['term','term','word','alternative']}),issue('a phrase','phrase'),issue('phrase','word')]);
  const result=await checkProofreading(text,connection,signal());
  assert.deepEqual(result,[{start:4,end:8,original:'word',replacements:['term','alternative'],message:'Check spelling.',kind:'spelling'}]);
  assert.equal(text,'teh word and a phrase');
});

test('only strict JSON or one enclosing JSON fence is accepted; wrappers and incomplete generations fail safely',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',async()=>new Response(completion([],{message:{content:'```json\n{"issues":[]}\n```'}})));
  assert.deepEqual(await checkProofreading('Text',connection,signal()),[]);
  for(const body of [completion([],{message:{content:'Here is JSON: {"issues":[]}'}}),completion([],{message:{content:'{"data":{"issues":[]}}'}}),completion([],{message:{content:'```json\n```json\n{"issues":[]}\n```\n```'}}),'not JSON',JSON.stringify({choices:[]}),completion([],{message:{content:'{"issues":[]}',refusal:'no'}}),completion(new Array(81).fill(issue('Text','Words')))]){
    fetch.mock.mockImplementation(async()=>new Response(body));await assert.rejects(checkProofreading('Text',connection,signal()),/returned an invalid response/);
  }
  fetch.mock.mockImplementation(async()=>new Response(completion([],{finish_reason:'length'})));
  await assert.rejects(checkProofreading('Text',connection,signal()),/did not finish/);
});

test('response size is bounded in bytes even with chunked UTF-8 and absent Content-Length',async t=>{
  const encoded=new TextEncoder().encode(completion([issue('錯','错',{message:'中文说明'})]));
  let cancelled=false;
  const fetch=t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<encoded.length;i+=3)controller.enqueue(encoded.slice(i,i+3));controller.close();}})));
  assert.equal((await checkProofreading('錯',connection,signal()))[0].message,'中文说明');
  fetch.mock.mockImplementation(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1_048_577));},cancel(){cancelled=true;}})));
  await assert.rejects(checkProofreading('Text',connection,signal()),/too much data/);assert.equal(cancelled,true);
  cancelled=false;
  fetch.mock.mockImplementation(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Length':'1048577'}}));
  await assert.rejects(checkProofreading('Text',connection,signal()),/too much data/);assert.equal(cancelled,true);
});

test('HTTP and network errors preserve the status without showing unstructured bodies or credentials',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('leaked test-secret-not-real https://private.example');});
  await assert.rejects(checkProofreading('Text',connection,signal()),error=>error.message==='Could not connect to the proofreading service.'&&!error.cause);
  for(const [status,expected] of [[400,'rejected the request'],[401,'API key'],[402,'payment'],[403,'denied access'],[404,'endpoint or model'],[408,'timed out'],[413,'too large'],[422,'request parameter'],[429,'rate-limited'],[500,'internal error'],[502,'gateway'],[503,'temporarily unavailable'],[504,'gateway timed out'],[418,'HTTP error']]){
    fetch.mock.mockImplementation(async()=>new Response('test-secret-not-real private failure',{status}));
    await assert.rejects(checkProofreading('Text',connection,signal()),error=>error instanceof ProofreadingServiceError&&error.status===status&&error.message.includes(expected)&&error.message.includes('HTTP '+status)&&error.detail===undefined&&!error.message.includes('test-secret-not-real')&&!error.message.includes('private failure'));
  }
});

test('structured service errors show bounded diagnostic details without echoing the key, URL or document',async t=>{
  const text='Some random text to test the correction capability of ai.';
  const secretMessage=`Model not available. Key: ${connection.apiKey}; Bearer another-private-token; URL: https://private.example/v1?key=secret; Input: ${text}\n${'detail '.repeat(120)}`;
  const fetch=t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({error:{message:secretMessage,type:'invalid_request_error'}}),{status:400,headers:{'Content-Type':'application/json; charset=utf-8'}}));
  await assert.rejects(checkProofreading(text,connection,signal()),error=>{
    assert.equal(error.status,400);assert.match(error.detail,/Model not available/);assert.ok(error.detail.length<=500);
    for(const secret of [connection.apiKey,'another-private-token','private.example',text,'\n'])assert.ok(!error.detail.includes(secret));
    return true;
  });
  assert.equal(fetch.mock.callCount(),1,'diagnostics do not retry or add any API calls');
  for(const body of ['not json',JSON.stringify({error:{message:'x'.repeat(16_384)}})]){
    fetch.mock.mockImplementation(async()=>new Response(body,{status:503,headers:{'Content-Type':'application/json'}}));
    await assert.rejects(checkProofreading(text,connection,signal()),error=>error.status===503&&error.detail===undefined&&error.message.includes('HTTP 503'));
  }
  fetch.mock.mockImplementation(async()=>new Response(JSON.stringify({error:'Invalid model name'}),{status:422,headers:{'Content-Type':'application/problem+json'}}));
  await assert.rejects(checkProofreading(text,connection,signal()),error=>error.status===422&&error.detail==='Invalid model name');
});

test('a stalled error body cannot hide an already received HTTP status behind the request timeout',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let bodyCancelled=false;
  t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({cancel(){bodyCancelled=true;}}),{status:503,headers:{'Content-Type':'application/json'}}));
  const request=checkProofreading('Text',connection,signal());
  const rejection=assert.rejects(request,error=>error.status===503&&error.detail===undefined&&error.message.includes('HTTP 503'));
  await Promise.resolve();await Promise.resolve();t.mock.timers.tick(1000);await rejection;
  assert.equal(bodyCancelled,true);
});

test('JSON-escaped service diagnostics cannot reveal the supplied key or complete document text',async t=>{
  const apiKey='fixture"key\\with-escaping',text='A "quoted" sentence\nwith a second line.';
  const forms=value=>[value,JSON.stringify(value),JSON.stringify(value).slice(1,-1),encodeURIComponent(value)];
  const message=[...forms(apiKey),...forms(text)].join(' | ');
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({error:{message}}),{status:400,headers:{'Content-Type':'application/json'}}));
  await assert.rejects(checkProofreading(text,{...connection,apiKey},signal()),error=>{
    assert.equal(error.status,400);assert.ok(error.detail);
    for(const value of [...forms(apiKey),...forms(text)])assert.ok(!error.detail.includes(value));
    assert.doesNotMatch(error.detail,/fixture|quoted|second line/);return true;
  });
});

test('input limits and settings are checked before sending content',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',async()=>new Response(completion([])));
  assert.deepEqual(await checkProofreading(' \n ',connection,signal()),[]);
  await assert.rejects(checkProofreading('x'.repeat(12_001),connection,signal()),/text is too long/);
  await assert.rejects(checkProofreading('Text',{...connection,model:' '},signal()),/Enter a model name/);
  await assert.rejects(checkProofreading('Text',{...connection,apiKey:'bad\r\nheader'},signal()),/API key contains invalid characters/);
  assert.equal(fetch.mock.callCount(),0);
  assert.deepEqual(await checkProofreading('x'.repeat(12_000),connection,signal()),[]);assert.equal(fetch.mock.callCount(),1);
});

test('external cancellation before a request or during its response stops work without leaking the abort reason',async t=>{
  let fetchSignal,streamCancelled=false;
  const fetch=t.mock.method(globalThis,'fetch',async(_url,options)=>{fetchSignal=options.signal;return new Response(new ReadableStream({cancel(){streamCancelled=true;}}));});
  const before=new AbortController();before.abort('private abort reason');
  await assert.rejects(checkProofreading('Text',connection,before.signal),error=>error.name==='AbortError'&&error.message==='The proofreading request was cancelled.');assert.equal(fetch.mock.callCount(),0);
  const during=new AbortController(),request=checkProofreading('Text',connection,during.signal);
  await Promise.resolve();await Promise.resolve();during.abort('private abort reason');
  await assert.rejects(request,error=>error.name==='AbortError'&&error.message==='The proofreading request was cancelled.');
  assert.equal(fetchSignal.aborted,true);assert.equal(streamCancelled,true);
});

test('45-second timeout rejects even if a compatible service ignores abort',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let fetchSignal;
  t.mock.method(globalThis,'fetch',(_url,options)=>{fetchSignal=options.signal;return new Promise(()=>{});});
  const request=checkProofreading('Text',connection,signal());
  const rejection=assert.rejects(request,error=>error.message==='The proofreading request timed out.');
  t.mock.timers.tick(44_999);assert.equal(fetchSignal.aborted,false);
  t.mock.timers.tick(1);await rejection;assert.equal(fetchSignal.aborted,true);
});
