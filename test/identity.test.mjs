// The door, now that there is no phrase behind it. Tokens are signed with a key made for the
// test and Google's certificate endpoint is answered locally, so this runs with no network and
// no account — but the signatures are real ones, checked the way the Worker checks them.
import { readIdentity, whoIsCalling, forgetKeys } from '../worker/identity.js';
import { AUD, calls, install, stranger, token } from './fake-google.mjs';

install();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); } };

const b64 = buf => Buffer.from(buf).toString('base64url');
const threw = async (fn, want) => {
  try { await fn(); return { ok: false, message: 'did not throw' }; }
  catch (e) { return { ok: (e.message || '').includes(want), message: e.message, status: e.status }; }
};

console.log('\n# the signature');
let claims = await readIdentity(await token());
ok('a token Google signed is read', claims.email === 'glitter@gmail.com' && claims.aud === AUD, claims);

let t = (await token()).split('.');
let bad = await threw(() => readIdentity(t[0] + '.' + t[1] + '.' + b64('nonsense')), 'not signed by Google');
ok('a forged signature is refused', bad.ok, bad);

bad = await threw(async () => readIdentity(await token({}, { key: stranger.privateKey })), 'not signed by Google');
ok('signed by somebody else’s key, refused', bad.ok, bad);

bad = await threw(async () => readIdentity(await token({}, { kid: 'not-a-key' })), 'Google does not publish');
ok('signed by a key Google does not publish, refused', bad.ok, bad);

bad = await threw(async () => readIdentity(await token({}, { alg: 'none' })), 'signed the wrong way');
ok('alg:none is refused rather than trusted', bad.ok, bad);

bad = await threw(() => readIdentity('not.a.token'), 'malformed');
ok('a malformed token is refused', bad.ok, bad);
bad = await threw(() => readIdentity(''), 'not an identity token');
ok('no token at all is refused', bad.ok, bad);

console.log('\n# what the claims have to say');
bad = await threw(async () => readIdentity(await token({ exp: Math.floor(Date.now() / 1000) - 600 })), 'expired');
ok('an expired token is refused', bad.ok, bad);
bad = await threw(async () => readIdentity(await token({ iss: 'https://evil.example' })), 'did not come from Google');
ok('another issuer is refused', bad.ok, bad);
ok('a minute of clock skew is forgiven',
   !!(await readIdentity(await token({ exp: Math.floor(Date.now() / 1000) - 30 }))));

console.log('\n# which app the token was made for');
const call = async (t, env) => whoIsCalling(
  new Request('https://w.dev/ai/status', { headers: t ? { authorization: 'Bearer ' + t } : {} }), env);

let who = await call(await token(), { SCRIPT_AUD: AUD });
ok('the add-on’s own token gets in, and says who', who.email === 'glitter@gmail.com', who);

bad = await threw(async () => call(await token({ aud: 'some-other-app.apps.googleusercontent.com' }), { SCRIPT_AUD: AUD }),
                  'minted for a different app');
ok('a valid Google token for another app is refused — this is the whole gate', bad.ok, bad);

bad = await threw(async () => call(await token(), {}), 'SCRIPT_AUD');
ok('an unpinned Worker refuses everyone', bad.ok && bad.status === 403, bad);
ok('but its refusal carries the value to pin', bad.message.includes(AUD), bad.message);

bad = await threw(() => call('', { SCRIPT_AUD: AUD }), 'brought no identity');
ok('no Authorization header at all', bad.ok, bad);

console.log('\n# the optional shorter list');
who = await call(await token(), { SCRIPT_AUD: AUD, ALLOWED_EMAILS: ' Glitter@Gmail.com , goose@gmail.com ' });
ok('an allowed address gets in, whatever the capitals', who.email === 'glitter@gmail.com');
bad = await threw(async () => call(await token({ email: 'stranger@gmail.com' }),
                                   { SCRIPT_AUD: AUD, ALLOWED_EMAILS: 'glitter@gmail.com' }), 'not on this Worker');
ok('an address not on the list is refused', bad.ok, bad);

console.log('\n# not asking Google every time');
// One fetch per unknown key id is expected — that is a rotation being caught up with. What
// must not happen is a fetch per request.
const before = calls.certs;
for (let i = 0; i < 5; i++) await readIdentity(await token());
ok('five more tokens cost no further trips to Google', calls.certs === before, { before, now: calls.certs });
forgetKeys();
await readIdentity(await token());
ok('until the cache is dropped, and then exactly one', calls.certs === before + 1, { before, now: calls.certs });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
