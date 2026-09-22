// Google, for the tests: a real RSA key pair, real signatures, and the certificate endpoint
// answered from memory. Nothing here talks to the network, but everything the Worker checks
// is checked against a signature it actually has to verify.
const b64 = buf => Buffer.from(buf).toString('base64url');
const rsa = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
              publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

export const AUD = '1234567890-abcdef.apps.googleusercontent.com';

const pair = await crypto.subtle.generateKey(rsa, true, ['sign', 'verify']);
export const stranger = await crypto.subtle.generateKey(rsa, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
              kid: 'test-key', use: 'sig', alg: 'RS256' };

export const calls = { certs: 0, upstream: [] };

/**
 * Take over fetch. Google's certificates are answered; anything else is recorded and given a
 * bland reply, so a test can see what the Worker sent upstream without a model key existing.
 */
export function install(upstream) {
  calls.certs = 0;
  calls.upstream = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('oauth2/v3/certs')) {
      calls.certs++;
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
    }
    calls.upstream.push({ url: String(url), opts });
    if (upstream) return upstream(url, opts);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

/** A token for the add-on, or — with the second argument — a deliberately wrong one. */
export async function token(claims = {}, { key = pair.privateKey, kid = 'test-key', alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64(JSON.stringify({
    iss: 'https://accounts.google.com', aud: AUD, sub: '117',
    email: 'glitter@gmail.com', email_verified: true, iat: now, exp: now + 3600, ...claims,
  }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + body));
  return head + '.' + body + '.' + b64(sig);
}

export const sign = b64;
