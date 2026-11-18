const test = require('node:test');
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const source = buildSync({entryPoints: ['src/languagetool-provider.ts'], bundle: true, write: false, platform: 'browser', format: 'cjs', target: 'es2022'}).outputFiles[0].text;
const compiled = {exports: {}};
new Function('module', 'exports', source)(compiled, compiled.exports);
const {checkLanguageTool, resolveLanguageToolEndpoint} = compiled.exports;
const connection = {
  provider: 'languagetool', languageToolEndpoint: 'http://127.0.0.1:8081', languageToolLanguage: 'en-US',
  endpoint: 'https://unused-ai.example/v1', apiKey: 'private-ai-key-never-sent', model: 'unused-ai-model',
};
const signal = () => new AbortController().signal;
const match = (offset, length, values, extra = {}) => ({offset, length, replacements: values.map(value => ({value})), message: 'Check this text.', rule: {id: 'TEST', issueType: 'misspelling'}, ...extra});
const response = matches => JSON.stringify({software: {name: 'LanguageTool', version: '6.6'}, matches});
const respond = (t, matches) => t.mock.method(globalThis, 'fetch', async () => new Response(response(matches)));

test('LanguageTool endpoint resolves roots, version bases, full endpoints and reverse proxies exactly once', () => {
  for (const [input, expected] of [
    ['http://127.0.0.1:8081', 'http://127.0.0.1:8081/v2/check'],
    [' http://localhost:8081/v2/ ', 'http://localhost:8081/v2/check'],
    ['https://check.example/v2/check/', 'https://check.example/v2/check'],
    ['https://check.example/proxy', 'https://check.example/proxy/v2/check'],
    ['https://check.example/proxy/v2?project=one', 'https://check.example/proxy/v2/check?project=one'],
  ]) assert.equal(resolveLanguageToolEndpoint(input), expected);
  for (const input of ['file:///tmp', 'ftp://check.example', 'not a URL', 'https://check.example/\npath']) {
    assert.throws(() => resolveLanguageToolEndpoint(input), /valid HTTP or HTTPS/);
  }
  for (const input of ['https://user:secret@check.example', 'https://check.example/#secret']) {
    assert.throws(() => resolveLanguageToolEndpoint(input), error => /username, password, or fragment/.test(error.message) && !error.message.includes('secret'));
  }
  for (const input of ['http://check.example', 'http://localhost.example', 'http://192.168.1.2:8081', 'http://127.0.0.2']) {
    assert.throws(() => resolveLanguageToolEndpoint(input), /Use HTTPS for remote/);
  }
  assert.throws(() => resolveLanguageToolEndpoint('http://[::1]:8081'), /Use localhost or 127.0.0.1/);
});

test('one form-encoded POST sends only LanguageTool options and never AI credentials or UI motherTongue', async t => {
  const text = 'A & B + C = sentnce. 中文 😀';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {requests.push({url, options}); return new Response(response([]));});
  await checkLanguageTool(text, connection, signal(), 'zh-CN');
  const {url, options} = requests[0];
  assert.equal(url, 'http://127.0.0.1:8081/v2/check');
  assert.equal(options.method, 'POST');
  assert.match(options.headers['Content-Type'], /^application\/x-www-form-urlencoded/);
  assert.deepEqual([...new URLSearchParams(options.body)], [['text', text], ['language', 'en-US']]);
  assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer');
  for (const privateValue of [connection.endpoint, connection.apiKey, connection.model, 'Authorization', 'motherTongue']) {
    assert.ok(!JSON.stringify({url, headers: options.headers, body: options.body}).includes(privateValue));
  }
  await checkLanguageTool(text, {...connection, languageToolLanguage: 'auto'}, signal(), 'en');
  assert.deepEqual([...new URLSearchParams(requests[1].options.body)], [['text', text], ['language', 'auto'], ['preferredVariants', 'en-US']]);
  await checkLanguageTool(text, {...connection, languageToolEndpoint: undefined, languageToolLanguage: undefined}, signal());
  assert.equal(requests[2].url, 'http://127.0.0.1:8081/v2/check', 'missing settings choose the local service, never the public free endpoint');
  assert.equal(requests.length, 3, 'exactly one HTTP request per explicit call');
});

test('matches use UTF-16 offsets in the unchanged input, including CJK, emoji and repeated text', async t => {
  const text = '😀 中文 teh then teh.';
  const first = text.indexOf('teh'), second = text.lastIndexOf('teh');
  respond(t, [match(second, 3, ['the']), match(first, 3, ['the'], {rule: {issueType: 'grammar'}, message: 'Grammar diagnostic.'})]);
  const issues = await checkLanguageTool(text, connection, signal());
  assert.deepEqual(issues, [
    {start: first, end: first + 3, original: 'teh', replacements: ['the'], message: 'Grammar diagnostic.', kind: 'grammar', context: {start: 0, end: text.length, original: text}},
    {start: second, end: second + 3, original: 'teh', replacements: ['the'], message: 'Check this text.', kind: 'spelling'},
  ]);
  assert.equal(first, 6);
  for (const item of issues) assert.equal(text.slice(item.start, item.end), item.original);
});

test('grammar alternatives depend on their original sentence while spelling suggestions remain independent', async t => {
  const text = '😀 This are wrong. Another sentence are wrong. A sentnce.';
  const grammar = {rule: {id: 'GRAMMAR', issueType: 'grammar'}};
  respond(t, [match(text.indexOf('This'), 4, ['These'], grammar), match(text.indexOf('are'), 3, ['is'], grammar),
    match(text.lastIndexOf('are'), 3, ['is'], grammar), match(text.indexOf('sentnce'), 7, ['sentence'])]);
  const issues = await checkLanguageTool(text, connection, signal());
  const firstEnd = text.indexOf('Another'), secondEnd = text.indexOf('A sentnce');
  assert.deepEqual(issues[0].context, {start: 0, end: firstEnd, original: text.slice(0, firstEnd)});
  assert.deepEqual(issues[1].context, issues[0].context, 'This→These and are→is share the dependency that makes them alternative corrections');
  assert.deepEqual(issues[2].context, {start: firstEnd, end: secondEnd, original: text.slice(firstEnd, secondEnd)});
  assert.equal(issues[3].context, undefined);
});

test('sentence context preserves UTF-16, quoted CJK punctuation and protected atoms without expanding editable ranges', async t => {
  const text = '😀 “这句错了。” 后一句也错了！ Final \uFFFC are wrong.';
  const grammar = {rule: {issueType: 'grammar'}};
  respond(t, [match(text.indexOf('错'), 1, ['对'], grammar), match(text.lastIndexOf('错'), 1, ['对'], grammar), match(text.indexOf('are'), 3, ['is'], grammar)]);
  const issues = await checkLanguageTool(text, {...connection, languageToolLanguage: 'zh-CN'}, signal());
  const firstEnd = text.indexOf('后'), secondEnd = text.indexOf('Final');
  assert.deepEqual(issues.map(item => item.context), [
    {start: 0, end: firstEnd, original: text.slice(0, firstEnd)},
    {start: firstEnd, end: secondEnd, original: text.slice(firstEnd, secondEnd)},
    {start: secondEnd, end: text.length, original: text.slice(secondEnd)},
  ]);
  assert.ok(issues[2].context.original.includes('\uFFFC'), 'grammar may depend on text across an atom');
  for (const issue of issues) {assert.equal(text.slice(issue.start, issue.end), issue.original); assert.ok(!issue.original.includes('\uFFFC'));}
});

test('cross-sentence diagnostics cover their full dependency and insertion anchors belong to the affected sentence', async t => {
  const text = 'One wrong. Next wrong. Last wrong.';
  const grammar = {rule: {issueType: 'grammar'}};
  const fetch = respond(t, [match(text.indexOf('wrong'), 'wrong. Next'.length, ['right. Next'], grammar)]);
  const [crossSentence] = await checkLanguageTool(text, connection, signal());
  const lastStart = text.indexOf('Last');
  assert.deepEqual(crossSentence.context, {start: 0, end: lastStart, original: text.slice(0, lastStart)});
  const nextStart = text.indexOf('Next');
  fetch.mock.mockImplementation(async () => new Response(response([match(nextStart - 1, 0, ['!'], grammar), match(nextStart, 0, ['A '], grammar)])));
  const [previous, next] = await checkLanguageTool(text, connection, signal());
  assert.deepEqual(previous.context, {start: 0, end: nextStart, original: text.slice(0, nextStart)});
  assert.deepEqual(next.context, {start: nextStart, end: lastStart, original: text.slice(nextStart, lastStart)});
});

test('runtimes without sentence segmentation use bounded punctuation contexts and preserve decimal and abbreviation dependencies', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  Object.defineProperty(Intl, 'Segmenter', {...descriptor, value: undefined});
  try {
    const text = 'Dr. Lee are using 3.14 units. 下一句错了！ Last are wrong.';
    const grammar = {rule: {issueType: 'grammar'}};
    respond(t, [match(text.indexOf('are'), 3, ['is'], grammar), match(text.indexOf('错'), 1, ['对'], grammar), match(text.lastIndexOf('are'), 3, ['is'], grammar)]);
    const issues = await checkLanguageTool(text, connection, signal());
    const firstEnd = text.indexOf('下一句'), secondEnd = text.indexOf('Last');
    assert.deepEqual(issues.map(item => item.context), [
      {start: 0, end: firstEnd, original: text.slice(0, firstEnd)},
      {start: firstEnd, end: secondEnd, original: text.slice(firstEnd, secondEnd)},
      {start: secondEnd, end: text.length, original: text.slice(secondEnd)},
    ]);
  } finally {Object.defineProperty(Intl, 'Segmenter', descriptor);}
});

test('LanguageTool diagnostics without replacements are retained and deletion remains a valid replacement', async t => {
  const text = 'This is is a warning.';
  respond(t, [match(8, 3, [''], {rule: {issueType: 'duplication'}}), match(13, 7, [], {rule: {issueType: 'other'}, message: 'Please check the meaning.'})]);
  const issues = await checkLanguageTool(text, connection, signal());
  assert.deepEqual(issues.map(({original, replacements, kind}) => ({original, replacements, kind})), [
    {original: 'is ', replacements: [''], kind: 'grammar'},
    {original: 'warning', replacements: [], kind: 'grammar'},
  ]);
});

test('zero-length insertions preserve their exact position by replacing an adjacent nonempty token', async t => {
  const fetch = respond(t, []);
  for (const [text, offset, insertion, expected] of [
    ['Hello', 5, '.', 'Hello.'],
    ['hello', 0, 'Say ', 'Say hello'],
    ['cant', 3, "'", "can't"],
    ['Hello  world', 6, ',', 'Hello , world'],
    ['😀 hello', 8, '!', '😀 hello!'],
    ['中文', 1, '，', '中，文'],
    ['Hello\n', 6, '.', 'Hello\n.'],
  ]) {
    fetch.mock.mockImplementation(async () => new Response(response([match(offset, 0, [insertion], {rule: {issueType: 'typographical'}})])));
    const issues = await checkLanguageTool(text, connection, signal());
    assert.equal(issues.length, 1, `zero-length suggestion retained for ${JSON.stringify(text)}`);
    const item = issues[0];
    assert.ok(item.end > item.start); assert.equal(text.slice(item.start, item.end), item.original);
    assert.equal(text.slice(0, item.start) + item.replacements[0] + text.slice(item.end), expected);
  }
});

test('insertion anchors stop at protected atoms, support suggestion-only diagnostics and never split a grapheme', async t => {
  const text = 'left\uFFFCright 😀 e\u0301';
  const fetch = respond(t, []);
  for (const [offset, replacement, original] of [[4, '!', 'left'], [5, '(', 'right']]) {
    fetch.mock.mockImplementation(async () => new Response(response([match(offset, 0, [replacement])])));
    const [item] = await checkLanguageTool(text, connection, signal());
    assert.equal(item.original, original);
    assert.equal(text.slice(0, item.start) + item.replacements[0] + text.slice(item.end), text.slice(0, offset) + replacement + text.slice(offset));
    assert.ok(!item.original.includes('\uFFFC'));
  }
  fetch.mock.mockImplementation(async () => new Response(response([match(4, 0, [])])));
  const [diagnostic] = await checkLanguageTool(text, connection, signal());
  assert.equal(diagnostic.original, 'left'); assert.deepEqual(diagnostic.replacements, []);
  fetch.mock.mockImplementation(async () => new Response(response([match(text.indexOf('😀') + 1, 0, ['x']), match(text.lastIndexOf('e') + 1, 0, ['x'])])));
  assert.deepEqual(await checkLanguageTool(text, connection, signal()), []);
  fetch.mock.mockImplementation(async () => new Response(response([match(1, 0, ['x'])])));
  const [blank] = await checkLanguageTool('\uFFFC \uFFFC', connection, signal());
  assert.equal(blank.original, ' '); assert.equal(blank.replacements[0], 'x ');
});

test('invalid ranges and partial grapheme clusters are ignored; matches never span a formula or reference', async t => {
  const text = 'ab\uFFFCcd 😀 e\u0301 teh';
  respond(t, [
    match(-1, 2, ['x']), match(0.5, 1, ['x']), match(0, -1, ['x']), match(0, 0.5, ['x']), match(100, 1, ['x']), match(0, 501, ['x']),
    match(0, 5, ['x']), match(text.indexOf('😀'), 1, ['x']), match(text.indexOf('e'), 1, ['x']),
    match(text.indexOf('e'), 2, ['é']), match(text.indexOf('teh'), 3, ['the']),
  ]);
  assert.deepEqual((await checkLanguageTool(text, connection, signal())).map(item => item.original), ['e\u0301', 'teh']);
});

test('unsafe, unchanged and oversized replacement values cannot be applied; valid alternatives are deduplicated and capped', async t => {
  respond(t, [match(0, 3, ['teh', '\uFFFC', '\u0000', '\ud83d', '\ude00', 'x'.repeat(81), 'the', 'the', 'ten', 'tea', 'them', 'then', 'these'])]);
  const [item] = await checkLanguageTool('teh', connection, signal());
  assert.deepEqual(item.replacements, ['the', 'ten', 'tea', 'them', 'then']);
});

test('identical diagnostics collapse while distinct overlapping rules and alternatives remain available', async t => {
  respond(t, [match(0, 3, ['the']), match(0, 3, ['the']), match(0, 3, ['the'], {message: 'Another rule.', rule: {id: 'SECOND', issueType: 'grammar'}}), match(4, 3, ['long']), match(4, 7, ['a phrase'])]);
  const issues = await checkLanguageTool('teh bad word', connection, signal());
  assert.equal(issues.length, 4);
  assert.deepEqual(issues.map(item => [item.original, item.replacements, item.kind]), [
    ['teh', ['the'], 'spelling'], ['teh', ['the'], 'grammar'], ['bad', ['long'], 'spelling'], ['bad wor', ['a phrase'], 'spelling'],
  ]);
});

test('non-diagnostics are ignored and invalid response envelopes fail without accepting arbitrary wrappers', async t => {
  const fetch = respond(t, [null, {}, match(0, 3, ['the'], {message: ''}), match(0, 3, ['the'], {replacements: 'the'}), match(0, 3, ['the'], {rule: {}})]);
  assert.deepEqual(await checkLanguageTool('teh', connection, signal()), []);
  for (const body of ['not JSON', '```json\n{"matches":[]}\n```', JSON.stringify({data: {matches: []}})]) {
    fetch.mock.mockImplementation(async () => new Response(body));
    await assert.rejects(checkLanguageTool('teh', connection, signal()), /returned an invalid response/);
  }
});

test('large result sets retain up to eighty valid diagnostics instead of failing the entire paragraph', async t => {
  const text = new Array(100).fill('teh').join(' ');
  respond(t, [...new Array(90).fill(null), ...Array.from({length: 100}, (_, index) => match(index * 4, 3, ['the']))]);
  const issues = await checkLanguageTool(text, connection, signal());
  assert.equal(issues.length, 80);
  assert.equal(issues[0].start, 0); assert.equal(issues.at(-1).start, 79 * 4);
});

test('input and language are validated before networking; document language is not inferred from UI language', async t => {
  const fetch = respond(t, []);
  assert.deepEqual(await checkLanguageTool(' \n ', connection, signal()), []);
  await assert.rejects(checkLanguageTool('x'.repeat(12_001), connection, signal()), /text is too long/);
  for (const languageToolLanguage of ['en&text=private', 'en_US', 'a'.repeat(36), 'en\nUS', 42]) {
    await assert.rejects(checkLanguageTool('Text', {...connection, languageToolLanguage}, signal()), /valid LanguageTool language code/);
  }
  assert.equal(fetch.mock.callCount(), 0);
  for (const languageToolLanguage of ['auto', 'en-US', 'en-GB', 'zh-CN', 'pt-BR']) {
    await checkLanguageTool('x'.repeat(12_000), {...connection, languageToolLanguage}, signal(), 'zh-CN');
    const body = new URLSearchParams(fetch.mock.calls.at(-1).arguments[1].body);
    assert.equal(body.get('language'), languageToolLanguage); assert.equal(body.has('motherTongue'), false);
  }
});

test('response reads enforce the shared byte limit and preserve split UTF-8', async t => {
  const encoded = new TextEncoder().encode(response([match(0, 1, ['错'], {message: '中文说明'})]));
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({start(controller) {for (let i = 0; i < encoded.length; i += 3) controller.enqueue(encoded.slice(i, i + 3)); controller.close();}})));
  assert.equal((await checkLanguageTool('錯', connection, signal()))[0].message, '中文说明');
  let cancelled = false;
  fetch.mock.mockImplementation(async () => new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(1_048_577));}, cancel() {cancelled = true;}})));
  await assert.rejects(checkLanguageTool('Text', connection, signal()), /too much data/); assert.equal(cancelled, true);
  cancelled = false;
  fetch.mock.mockImplementation(async () => new Response(new ReadableStream({cancel() {cancelled = true;}}), {headers: {'Content-Length': '1048577'}}));
  await assert.rejects(checkLanguageTool('Text', connection, signal()), /too much data/); assert.equal(cancelled, true);
});

test('HTTP errors retain status and bounded diagnostics; unexpected networking errors do not echo private content', async t => {
  const text = 'Private document fixture.';
  const fetch = t.mock.method(globalThis, 'fetch', async () => {throw Error('secret-connection-detail');});
  await assert.rejects(checkLanguageTool(text, connection, signal()), error => error.message === 'Could not connect to the proofreading service.' && !error.cause);
  for (const status of [400, 401, 429, 500, 503]) {
    fetch.mock.mockImplementation(async () => new Response(JSON.stringify({error: {message: `Language unavailable; input ${text}; URL https://private.example/path`}}), {status, headers: {'Content-Type': 'application/json'}}));
    await assert.rejects(checkLanguageTool(text, connection, signal()), error => {
      assert.equal(error.status, status); assert.match(error.message, new RegExp('HTTP ' + status)); assert.match(error.detail, /Language unavailable/);
      assert.ok(!error.detail.includes(text)); assert.ok(!error.detail.includes('private.example')); return true;
    });
  }
  assert.equal(fetch.mock.callCount(), 6, 'no retries');
});

test('a stalled error body preserves the already known HTTP status', async t => {
  t.mock.timers.enable({apis: ['setTimeout']}); let bodyCancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({cancel() {bodyCancelled = true;}}), {status: 503, headers: {'Content-Type': 'application/json'}}));
  const request = checkLanguageTool('Text', connection, signal());
  const rejection = assert.rejects(request, error => error.status === 503 && error.detail === undefined);
  await Promise.resolve(); await Promise.resolve(); t.mock.timers.tick(1000); await rejection;
  assert.equal(bodyCancelled, true);
});

test('pre-abort, external cancellation and timeout stop the request without retries or leaking the abort reason', async t => {
  let fetchSignal, streamCancelled = false;
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => {fetchSignal = options.signal; return new Response(new ReadableStream({cancel() {streamCancelled = true;}}));});
  const before = new AbortController(); before.abort('private reason');
  await assert.rejects(checkLanguageTool('Text', connection, before.signal), error => error.name === 'AbortError' && error.message === 'The proofreading request was cancelled.');
  assert.equal(fetch.mock.callCount(), 0);
  const during = new AbortController(), request = checkLanguageTool('Text', connection, during.signal);
  await Promise.resolve(); await Promise.resolve(); during.abort('private reason');
  await assert.rejects(request, error => error.name === 'AbortError' && error.message === 'The proofreading request was cancelled.');
  assert.equal(fetchSignal.aborted, true); assert.equal(streamCancelled, true);
  t.mock.timers.enable({apis: ['setTimeout']});
  fetch.mock.mockImplementation((_url, options) => {fetchSignal = options.signal; return new Promise(() => {});});
  const waiting = checkLanguageTool('Text', connection, signal());
  const timeout = assert.rejects(waiting, error => error.message === 'The proofreading request timed out.');
  t.mock.timers.tick(45_000); await timeout;
  assert.equal(fetchSignal.aborted, true); assert.equal(fetch.mock.callCount(), 2);
});
