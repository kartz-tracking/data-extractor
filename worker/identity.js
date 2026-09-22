/**
 * Who is calling, proved by Google rather than by a phrase.
 *
 * Apps Script can mint an OpenID Connect token for whoever is using the add-on. It is signed
 * by Google, it says who they are, and — the part that does the real work here — its audience
 * is the OAuth client of the script that asked for it. Only that script can get one. So a
 * Worker that checks the signature and the audience is letting in exactly the people who
 * authorised your add-on, which is the people you shared the spreadsheet with.
 *
 * Nothing is shared, nothing is stored, and nothing has to be typed into a settings box. The
 * token lasts about an hour and the page fetches a fresh one when it needs to.
 *
 *   SCRIPT_AUD       required — the script's OAuth client id. The first call tells you it.
 *   ALLOWED_EMAILS   optional — a comma-separated list, if the spreadsheet's sharing is not
 *                    tight enough on its own.
 */
import { HttpError, str } from './util.js';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const SKEW = 60;                       // seconds of clock difference to forgive

// Google publishes a handful of keys and rotates them slowly. They are cached for as long as
// Google says, and thrown away early if a token arrives signed by one we have not seen.
let cache = { keys: null, until: 0 };

async function googleKeys(force) {
  const now = Date.now();
  if (!force && cache.keys && now < cache.until) return cache.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new HttpError(503, "could not reach Google's public keys just now.");
  const body = await res.json();
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1] || 3600);
  cache = { keys: body.keys || [], until: now + Math.max(300, maxAge) * 1000 };
  return cache.keys;
}

function bytes(b64) {
  const t = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const part = s => JSON.parse(new TextDecoder().decode(bytes(s)));

/** The claims in a token, once Google's signature on it has been checked. */
export async function readIdentity(token) {
  const parts = str(token).split('.');
  if (parts.length !== 3) throw new HttpError(401, 'that is not an identity token.');

  let header;
  try { header = part(parts[0]); } catch { throw new HttpError(401, 'that token is malformed.'); }
  if (header.alg !== 'RS256') throw new HttpError(401, 'that token is signed the wrong way.');

  let keys = await googleKeys();
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) {                                   // a rotation we have not caught up with
    keys = await googleKeys(true);
    jwk = keys.find(k => k.kid === header.kid);
  }
  if (!jwk) throw new HttpError(401, 'that token was signed by a key Google does not publish.');

  const key = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), signed);
  if (!ok) throw new HttpError(401, 'that token was not signed by Google.');

  let claims;
  try { claims = part(parts[1]); } catch { throw new HttpError(401, 'that token is malformed.'); }
  if (!ISSUERS.has(claims.iss)) throw new HttpError(401, 'that token did not come from Google.');
  const now = Date.now() / 1000;
  if (!(claims.exp > now - SKEW)) throw new HttpError(401, 'that token has expired — reopen Kartz.');
  if (claims.iat && claims.iat > now + SKEW) throw new HttpError(401, 'that token is from the future.');
  return claims;
}

/**
 * The person behind this request, or a refusal that says what to do about it.
 *
 * A Worker that has not been told which script may call it refuses everything — but the
 * refusal carries the audience of the token it just checked, so pinning it is one command
 * rather than a hunt through the Cloud console.
 */
export async function whoIsCalling(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = /^Bearer (.+)$/i.exec(header.trim());
  if (!token) throw new HttpError(401, 'this request brought no identity. Reopen Kartz in the spreadsheet.');

  const claims = await readIdentity(token[1]);
  const email = str(claims.email).toLowerCase();

  const aud = str(env.SCRIPT_AUD);
  if (!aud) {
    throw new HttpError(403,
      'this Worker has not been told which script may call it. The token it just checked was '
      + `minted for ${claims.aud}${email ? ' (' + email + ')' : ''}. If that is your add-on, run: `
      + `npx wrangler secret put SCRIPT_AUD — and paste that value.`);
  }
  if (claims.aud !== aud) throw new HttpError(403, 'that identity was minted for a different app.');

  const list = str(env.ALLOWED_EMAILS).split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (list.length && !list.includes(email))
    throw new HttpError(403, (email || 'that account') + ' is not on this Worker’s list.');

  return { email: claims.email || '', sub: claims.sub || '', expires: claims.exp };
}

/** Tests only: forget the cached keys between cases. */
export function forgetKeys() { cache = { keys: null, until: 0 }; }
