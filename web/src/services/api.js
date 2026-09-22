/**
 * One door to the Worker.
 *
 * The dialog is a page on googleusercontent.com, so every call to the Worker is cross-origin
 * and has to prove itself. The proof is an identity token: Google signs it, it names the
 * person using the add-on, and it is made out to this add-on's OAuth client and no other. The
 * Worker checks both. Nothing is shared, nothing is typed, and nothing is kept — the token
 * lasts about an hour and a fresh one is a call to Apps Script away.
 *
 * The Worker does two things now: it holds the model key, and it answers questions about what
 * is on the sheet. Everything else it used to do went with the database.
 */

let base = '';
let mint = null;                       // asks Apps Script for a token
let token = '';
let expires = 0;                       // seconds, from the token itself

/** Told to the page once, by Apps Script, before anything else happens. */
export function useWorker({ url, identity }) {
  base = String(url || '').replace(/\/+$/, '');
  mint = typeof identity === 'function' ? identity : null;
  token = ''; expires = 0;
}

export const apiBase = () => base;
export const hasWorker = () => !!base;
export const apiUrl = path => base + path;

// When it runs out, read off the token rather than guessed at. Two minutes of margin, because
// a recording can take a while and the request should not expire mid-flight.
const stillGood = () => token && expires - Date.now() / 1000 > 120;

/**
 * A token to put on the next request, fetched if the one in hand is old.
 *
 * Every call path awaits this before it builds its headers, so a long extraction cannot end
 * with an expired token on the last request.
 */
export async function ensureAuth() {
  if (stillGood() || !mint) return token;
  token = String((await mint()) || '');
  expires = 0;
  try {
    const body = token.split('.')[1];
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    expires = Number(JSON.parse(json).exp) || 0;
  } catch { expires = Date.now() / 1000 + 1800; }   // unreadable: refresh in half an hour
  return token;
}

export const apiHeaders = (h = {}) => ({ ...h, ...(token ? { authorization: 'Bearer ' + token } : {}) });

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

export async function api(path, opts = {}) {
  if (!base) throw new ApiError(0, 'The Worker address has not been set. Open Settings in the add-on.');
  await ensureAuth();
  const res = await fetch(apiUrl(path), { ...opts, headers: apiHeaders(opts.headers || {}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body.error && body.error.message) || body.error
      || (res.status === 403
        ? 'the Worker refused this add-on — check its address in Settings'
        : `request failed (${res.status})`);
    throw new ApiError(res.status, message, body);
  }
  return body;
}

const json = (method, body) => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

/** Whether the Worker has a model key, and which model it would use. */
export const aiStatus = () => api('/ai/status');

/** A question about what is on the sheet. The rows travel with it; nothing is stored. */
export const ask = body => api('/ai/ask', json('POST', body));

/** Reading a recording is a model call by another name, and goes through the same proxy. */
export const ping = () => api('/ai/status');
