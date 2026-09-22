// Talking to a model that is not Google's. The host is answered from here, so what is tested
// is the translation in both directions — and that a busy host stays busy rather than being
// flattened into a generic failure the page cannot act on.
import worker from '../worker.js';
import { toOllama, fromOllama } from '../worker/ollama.js';
import { AUD, calls, install, token } from './fake-google.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); } };

const GEMINI_BODY = {
  contents: [{ parts: [
    { text: 'read these boards and answer in JSON' },
    { inline_data: { mime_type: 'image/jpeg', data: 'AAAA' } },
    { inline_data: { mime_type: 'image/jpeg', data: 'BBBB' } },
  ] }],
};

console.log('\n# the request, translated');
const sent = toOllama('gemma4:31b', GEMINI_BODY);
ok('the model name goes through as written, colon and all', sent.model === 'gemma4:31b');
ok('the text becomes the message', sent.messages[0].content.startsWith('read these boards'));
ok('the frames become bare base64, not data: URLs',
   sent.messages[0].images.join() === 'AAAA,BBBB', sent.messages[0].images);
ok('nothing streams — the page wants one answer', sent.stream === false);
ok('temperature is nailed to zero, as with every other provider', sent.options.temperature === 0);
ok('a prompt that asks for JSON constrains the model to it', sent.format === 'json');
ok('a prompt that does not, does not',
   toOllama('m', { contents: [{ parts: [{ text: 'describe this picture' }] }] }).format === undefined);

console.log('\n# the answer, translated back');
const back = fromOllama({ message: { role: 'assistant', content: '[{"name":"Nubi"}]' },
                          prompt_eval_count: 900, eval_count: 40 });
ok('the page sees the Gemini shape it has always seen',
   back.candidates[0].content.parts[0].text === '[{"name":"Nubi"}]', back);
ok('and what it cost, when the host says', back.usageMetadata.candidatesTokenCount === 40);
ok('an empty answer is an empty string, not a crash',
   fromOllama({}).candidates[0].content.parts[0].text === '');

console.log('\n# through the Worker');
const env = { SCRIPT_AUD: AUD, OLLAMA_KEY: 'sk-test' };
const call = async (path, e = env, opts = {}) => worker.fetch(
  new Request('https://w.dev' + path, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + await token(), 'content-type': 'application/json' },
    body: JSON.stringify(opts.body || GEMINI_BODY),
  }), e);

install(async (url, o) => {
  if (String(url).includes('/api/chat'))
    return new Response(JSON.stringify({ message: { content: '[]' } }),
                        { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 200 });
});

let res = await call('/@ollama/gemma4:31b');
let hit = calls.upstream.find(c => c.url.includes('/api/chat'));
ok('the request reaches the host', res.status === 200 && !!hit, calls.upstream.map(c => c.url));
ok('with the key on it, and the key never in the reply',
   hit.opts.headers.authorization === 'Bearer sk-test'
   && !JSON.stringify(await res.clone().json()).includes('sk-test'));
ok('the prefix is stripped before the host sees the name',
   JSON.parse(hit.opts.body).model === 'gemma4:31b');
ok('and the host is ollama.com unless told otherwise', hit.url.startsWith('https://ollama.com/'));

install(async () => new Response('{}', { status: 200 }));
res = await call('/@ollama/gemma4:31b', { SCRIPT_AUD: AUD, OLLAMA_URL: 'https://box.example/' });
hit = calls.upstream.find(c => c.url.includes('/api/chat'));
ok('with no key, a 501 rather than a call', res.status === 501 && !hit, res.status);

install(async () => new Response(JSON.stringify({ error: 'model is loading' }), { status: 503 }));
res = await call('/@ollama/gemma4:31b');
ok('a busy host stays a 503, so the page knows to wait', res.status === 503, res.status);
ok('and says what the host said', (await res.json()).error.message.includes('model is loading'));

install(async () => new Response('<html>nope</html>', { status: 200 }));
res = await call('/@ollama/gemma4:31b');
ok('an answer that is not JSON is a 502, not a crash', res.status === 502);

install();
res = await call('/@ollama/../../etc/passwd');
ok('a model name that is not one is refused', res.status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
