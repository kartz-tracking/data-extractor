// The handful of numbers the whole extractor is tuned around. They were the top of the old
// single-file page and they are unchanged; see README.md for why each is what it is.

// Shown in the header. Several people run this from their own phones and a browser can sit on
// an open tab for days, so "it is still happening" and "it is fixed" are easy to say about
// different builds. Bump it with any change worth telling apart from the one before.
export const BUILD = '2026-09-16g';
// Which model reads the frames.
//
// A bare name is Google's. `@ollama/<name>` is a model hosted by Ollama, and `@cf/<name>` one
// of Cloudflare's own — the Worker knows all three and the page knows none of them, so
// switching provider is this line and a rebuild.
//
// Whatever is named here must be able to see: the request is a prompt and up to forty JPEG
// frames, and a model without vision has nothing to read.
export const MODEL = '@ollama/gemma4:31b';
// One model was deliberate — a run either works or says why — but "high demand" is the host's
// capacity rather than anything about the run, and it happens. The fallbacks are tried in
// order, only when the one above is unavailable.
export const FALLBACKS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];

// A cloud model on the other side of a slower link wants fewer, smaller requests than Google's
// flash does: forty frames is several megabytes, and a host that times out costs the whole
// batch. Lower BATCH_MAX below if a run stalls rather than answers.

// Six requests, not four or twelve: fewer resends less roster prompt, but a long batch is
// attended to worse than a short one — 47 images to a request dropped the match rate from 91
// of 129 to 67. The floor stops a short run from sending near-empty requests; the ceiling
// stops one huge request from putting the whole run on a single throw.
export const REQ_CAP = 6, BATCH_MIN = 8, BATCH_MAX = 40;
export const batchSize = n => Math.min(BATCH_MAX, Math.max(BATCH_MIN, Math.ceil(n / REQ_CAP)));

// The frame budget. 64 frames is about 223,000 tokens against a limit of 250,000 a minute, so
// the run goes in one burst; runExtraction trims it further if the roster has grown.
export const FRAME_BUDGET = 64;


// The four alliances the sheet is actually organised around. Anything else in its Alliance
// column — z3.?, z1.Transferred, a stray 698E — is a candidate for filtering out.
export const MAIN_ALLIANCES = ['698W', '698S', '698N', '698C'];

// Which of the month's recordings a board is. Chosen rather than worked out from the date
// order, because a missed or re-shot day would silently shift every label after it.
export const DAYS = ['Day 1', 'Day 4', 'Final'];
