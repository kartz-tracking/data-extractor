/**
 * The two or three things every file here needs.
 *
 * What used to live in this file — ids, timestamps, the activity log, the chunking that D1's
 * hundred-parameter limit forced — went with the database. What is left is a string cleaner
 * and an error that carries a status code, because a Worker's only way to say "you did that
 * wrong" is to say it with a number.
 */

export const str = v => (v === null || v === undefined ? '' : String(v)).trim();

export function toInt(v, fallback = null) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}
