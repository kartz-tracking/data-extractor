/**
 * Ollama, for a model that is neither Google's nor Cloudflare's.
 *
 * The page speaks one dialect — Gemini's — because teaching it a third would mean the
 * extractor knowing which provider it is aimed at, which is exactly what this Worker exists to
 * hide. So the translation happens here, in both directions:
 *
 *   contents[].parts[].text         →  messages[].content
 *   contents[].parts[].inline_data  →  messages[].images[]   (bare base64, no data: prefix)
 *   message.content                 →  candidates[].content.parts[].text
 *
 * Ollama's own /api/chat is used rather than its OpenAI-compatible endpoint, because images go
 * in as a plain array there instead of being wrapped in data: URLs — which matters when a
 * request carries forty of them.
 *
 *   OLLAMA_KEY   required — an API key for the host below
 *   OLLAMA_URL   optional — defaults to https://ollama.com; set it for a self-hosted instance
 */
import { HttpError, str } from './util.js';

const DEFAULT_HOST = 'https://ollama.com';

/** The Gemini-shaped request, as Ollama wants it. */
export function toOllama(model, body) {
  const parts = (body && body.contents && body.contents[0] && body.contents[0].parts) || [];
  const text = parts.filter(p => p && p.text).map(p => p.text).join('\n');
  const images = parts
    .filter(p => p && p.inline_data && p.inline_data.data)
    .map(p => String(p.inline_data.data));

  const message = { role: 'user', content: text };
  if (images.length) message.images = images;

  const out = {
    model,
    messages: [message],
    stream: false,
    options: { temperature: 0 },
  };
  // The prompt asks for JSON and the page parses it. Saying so here means the model is
  // constrained rather than merely asked, which is the difference between a salvage and a parse.
  const wantsJson = body && body.generationConfig
    && /json/i.test(str(body.generationConfig.responseMimeType));
  if (wantsJson || /json/i.test(text)) out.format = 'json';
  return out;
}

/** What came back, shaped like a Gemini answer so the page needs to know nothing. */
export function fromOllama(out) {
  const text = (out && out.message && out.message.content)
    || (out && out.response)
    || '';
  return {
    candidates: [{ content: { parts: [{ text: typeof text === 'string' ? text : JSON.stringify(text) }] } }],
    usageMetadata: out && out.eval_count
      ? { promptTokenCount: out.prompt_eval_count || 0, candidatesTokenCount: out.eval_count }
      : undefined,
  };
}

export async function runOllama(env, model, body) {
  if (!env.OLLAMA_KEY) {
    throw new HttpError(501,
      'this Worker has no OLLAMA_KEY secret set, so it cannot reach that model. '
      + 'Set one with: wrangler secret put OLLAMA_KEY');
  }
  const host = str(env.OLLAMA_URL) || DEFAULT_HOST;
  const res = await fetch(host.replace(/\/+$/, '') + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.OLLAMA_KEY },
    body: JSON.stringify(toOllama(model, body)),
  });

  const text = await res.text();
  if (!res.ok) {
    // Pass the status through rather than flattening it: the page moves down its fallback
    // chain on 429 and 503, and a model that is loading answers 503 for a minute or two.
    let message = text.slice(0, 300);
    try { message = JSON.parse(text).error || message; } catch { /* not JSON, use the text */ }
    throw new HttpError(res.status, 'the model host said ' + res.status + ': ' + message);
  }

  let out;
  try { out = JSON.parse(text); }
  catch { throw new HttpError(502, 'the model host answered with something that is not JSON.'); }
  return fromOllama(out);
}
