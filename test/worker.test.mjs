// The Worker, which is now one thing: a door that asks Google who you are. What is tested is
// the door — who gets in, who does not, and that a model key is never handed to either.
import worker from '../worker.js';
import { AUD, calls, install, token } from './fake-google.mjs';

install();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

const env = { SCRIPT_AUD: AUD, GEMINI_KEY: 'k', ANTHROPIC_API_KEY: 'a' };
const SHEET = 'https://n-abc123.googleusercontent.com';

async function call(path, opts = {}, e = env) {
  const auth = opts.auth === null ? null : (opts.auth || await token());
  return worker.fetch(new Request('https://data-extractor.workers.dev' + path, {
    method: opts.method || 'GET',
    headers: { ...(opts.origin ? { Origin: opts.origin } : {}),
               ...(auth ? { authorization: 'Bearer ' + auth } : {}),
               ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }), e);
}
const body = async res => await res.json().catch(() => ({}));

console.log('\n# the preflight');
let res = await call('/api/ai/ask', { method: 'OPTIONS', origin: SHEET, auth: null });
ok('a page Google serves the add-on from may ask', res.status === 204);
ok('and is told it may send the token',
   (res.headers.get('access-control-allow-headers') || '').includes('authorization'));
ok('the answer is for that origin only, and says so',
   res.headers.get('access-control-allow-origin') === SHEET && res.headers.get('vary') === 'Origin');

res = await call('/api/ai/ask', { method: 'OPTIONS', origin: 'https://not-google.example', auth: null });
ok('anywhere else is refused before it can try', res.status === 403);

console.log('\n# who is calling');
res = await call('/ai/status', { origin: SHEET, auth: null });
ok('no identity, no answer — not even the status', res.status === 401);

res = await call('/ai/status', { origin: SHEET, auth: 'not.a.token' });
ok('nonsense instead of a token is refused', res.status === 401);

res = await call('/ai/status', { origin: SHEET, auth: await token({ aud: 'another-app' }) });
ok('a real Google token for another app is refused', res.status === 403, await body(res));

res = await call('/ai/status', { origin: SHEET }, { GEMINI_KEY: 'k' });
let out = await body(res);
ok('a Worker nobody pinned refuses everyone', res.status === 403);
ok('and says which value to pin it to', out.error.message.includes(AUD), out.error.message);

console.log('\n# the routes');
res = await call('/ai/status', { origin: SHEET });
out = await body(res);
ok('the status answers, and names who asked',
   res.status === 200 && out.available === true && out.you === 'glitter@gmail.com', out);
ok('and never the key itself', !JSON.stringify(out).includes('"k"'), out);

ok('both spellings of the path reach the same route',
   (await call('/api/ai/status', { origin: SHEET })).status === 200);

res = await call('/ai/ask', { method: 'POST', origin: SHEET, body: { question: '' } });
ok('a question with nothing in it is a 400, not a model call', res.status === 400, await body(res));

res = await call('/ai/ask', { method: 'POST', origin: SHEET,
                              body: { question: 'who?', sheet: { headers: ['a'], rows: [] } } });
ok('a tab with no rows is a 400 too — there is nothing to answer from', res.status === 400, await body(res));

res = await call('/ai/nonsense', { origin: SHEET });
ok('an unknown ai route is a 404', res.status === 404);

console.log('\n# reading a recording');
res = await call('/gemini-3.5-flash', { origin: SHEET });
ok('a model call has to be a POST', res.status === 405);

res = await call('/../etc/passwd', { method: 'POST', origin: SHEET, body: {} });
ok('a model name that is not one is refused', res.status === 400, await body(res));

res = await call('/gemini-3.5-flash', { method: 'POST', origin: SHEET, body: {} }, { SCRIPT_AUD: AUD });
ok('with no key, a 501 — a 500 would have the page retrying for two minutes',
   res.status === 501 && (await body(res)).error.message.includes('GEMINI_KEY'));

const sent = calls.upstream.length;
res = await call('/gemini-3.5-flash', { method: 'POST', origin: SHEET, auth: 'rubbish', body: {} });
ok('a refused caller never reaches the model', res.status === 401 && calls.upstream.length === sent);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
