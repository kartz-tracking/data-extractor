# Kartz

A screen recording of the in-game **Ranking** list → rows in your Google Sheet.

Kartz is a Google Sheets add-on. It opens as a window over the spreadsheet, reads a recording
in the browser, matches what it finds against your roster tab, shows you the rows, and inserts
them into the tab you are standing on — without touching a formula, a colour or a dropdown that
is already there.

The recording never leaves the machine. Sampled frames go to a model through a Cloudflare
Worker, which holds the key; the video itself does not.

---

## What it looks like

```
Google Sheets
└─ Kartz ▸ Extract a recording
   └─ a modeless dialog, 760×548 — the sheet stays live underneath
      ┌───────────────────────────────────────────────────────┐
      │ ▣ TW 2698 — Kartz Tracking   September 2026 · 40 rows │
      ├──────────────────┬────────────────────────────────────┤
      │ roster: 12       │                                    │
      │ rows go to: end  │        ↑  Drop a recording         │
      │ model: ready     │                                    │
      ├──────────────────┴────────────────────────────────────┤
      │ Ready.                            [Ask about this tab] │
      └───────────────────────────────────────────────────────┘
```

Four steps, two presses: pick a recording, watch it read, look at what it found, send it. The
review grows the window to 900×648 and shows a real table — rank, roster name, in-game name,
alliance, score, and one word saying whether the sheet already has that row. Clicking a row
leaves it out. The last write can be undone.

Modeless is the point: the spreadsheet is not taken away from you while the window is up. You
can scroll it, switch tabs, and click a cell — and "where they go" will offer that cell.

---

## What it does to your spreadsheet

Five things, and nothing else.

| | |
|---|---|
| **Reads the roster** | A tab it finds by name (`Roster`, `Players`, …) or by headings that mention a name and an alliance. Pick it yourself in Settings if the guess is wrong. |
| **Reads the current tab** | Its headings, how far the rows go, and whether you may write to it. The heading row is the first row with two or more filled cells, so a title line above it is no problem. |
| **Finds duplicates** | Before anything is written, every candidate row is compared against what is already on the tab — on what the cells *show*, ignoring case, spacing and the fancy text the game draws. |
| **Inserts rows** | `insertRowsAfter`, then the formatting of the row above is copied onto them, then the values go in with `setValues` over a range exactly the size of the values. |
| **Preserves formatting** | A column no field is mapped to is written as an empty string, never skipped and never overwritten — so a formula column, a total, a dropdown, a conditional format or banding keeps working. Nothing here ever clears, formats or sorts anything. |

It also appends one line per extraction to a `Kartz log` tab, which is the only tab it will
create.

**Permissions are Google's.** There are no accounts and no passwords anywhere in this, not even
between the add-on and the Worker. If you can edit the spreadsheet you can extract into it; if
you can only view it, the write fails with Google's own refusal.

---

## Installing it

The script is **bound to your spreadsheet** — it is part of that file, not a Marketplace
add-on, so there is nothing to publish and nothing to review.

**By hand:** open the spreadsheet → Extensions → Apps Script. Create three files and paste in
`addon/Code.gs`, `addon/Sheets.gs` and `addon/Dialog.html` (the built one — see below). Set the
project's `appsscript.json` from `addon/appsscript.json` (Project Settings → "Show appsscript.json"),
then reload the spreadsheet. A **Kartz** menu appears next to Help.

**With clasp**, which is less typing every time:

```bash
npm install -g @google/clasp
clasp login
clasp clone <script id>      # Extensions → Apps Script → Project Settings → Script ID
cd web && npm run build      # writes addon/Dialog.html
clasp push
```

The first time you open the dialog Google asks you to authorise the script. It asks for three
things: the spreadsheet it is bound to (`spreadsheets.currentonly` — not all your files, this
one), permission to show a window, and `openid`, which is how it proves to the Worker who you
are. **Tick every box on that screen** — an unticked one means the add-on gets nothing and then
fails confusingly.

A script owned by a personal Google account is unverified, so everyone but the owner sees
"Google hasn't verified this app" once, and clicks Advanced → Go to … (unsafe). To remove that,
attach the script to a standard Cloud project (⚙ Project Settings → Google Cloud Platform
project), fill in its OAuth consent screen, and set publishing status to **In production**.

---

## The Worker

A page cannot hold a secret. The model key lives in a Cloudflare Worker instead — and the way
the Worker knows the call is really yours is Google, not a password.

Apps Script mints a short-lived OpenID Connect token for whoever is using the add-on. It is
signed by Google and **made out to this add-on's own OAuth client**. The Worker checks the
signature against Google's published keys and checks that audience. Only your script can obtain
such a token, and only somebody who has authorised your script can make it do so — which is the
people the spreadsheet is shared with. Nothing is typed, nothing is stored, nothing to leak.

```bash
npx wrangler login                     # the account the Worker lives on
npx wrangler deploy
npx wrangler secret put GEMINI_KEY     # required: reading a recording
npx wrangler secret put SCRIPT_AUD     # required: which add-on may call — see below
                                       # (a comma-separated list, for several spreadsheets)
npx wrangler secret put ANTHROPIC_API_KEY   # optional: asking questions about a tab
npx wrangler secret put ALLOWED_EMAILS      # optional: a shorter list than the sharing settings
```

**Finding `SCRIPT_AUD`** — two ways, both a one-off:

- Open the dialog and press **Save and test**. The Worker refuses, and the refusal names the
  client id it just saw. Paste that.
- Or run `showClientId` from the Apps Script editor; it toasts the value into the spreadsheet
  and writes it to the execution log.

Until it is set the Worker answers nobody, so an unconfigured deployment is never an open AI
proxy for whoever finds the URL.

**The same add-on in several spreadsheets.** A bound script belongs to one file, so a second
spreadsheet means a second copy of the script — and a copy is a new project with a client id of
its own. `SCRIPT_AUD` therefore takes a list: paste each one in, separated by commas. Copying
the spreadsheet itself (File → Make a copy) brings the script with it, which is the least
work; linking every copy to the same Cloud project means the consent screen is configured once
rather than once per sheet. A preflight is allowed from `googleusercontent.com` — where
Google serves the add-on's page — and from nowhere else.

Then, in the dialog: **⚙ Settings** → check the Worker address → **Save and test**, which should
come back naming you and the model.

## Asking about a tab

**✦** opens a question box. The rows on the tab you are standing on travel with the question
(up to 300 of them, as they are displayed), the Worker asks the model, and the answer comes
back as a sentence and a few figures. Nothing is stored anywhere: the spreadsheet is the data,
which makes every answer exactly as current as the sheet is.

Because the dialog is modeless, "this tab" means whichever tab you are on when you press Ask.

---

## Developing

```bash
cd web && npm install
npm run build                 # → addon/Dialog.html, everything inline, one file
node ../tools/serve-dialog.mjs   # http://localhost:8788
```

The demo server draws a mock of Sheets with the dialog floating over it at the real pixel
sizes, and has buttons for each step — `start`, `reading`, `review`, `done`, `ask`, `settings`.
Outside Apps Script there is no `google` object at all, so `web/src/dialog/bridge.js` answers
from a small stand-in spreadsheet and the whole dialog can be built without leaving the machine.
The dialog says so, in as many words, when it is running against the stand-in.

```bash
node test/run.mjs
```

Four suites: who gets through the Worker's door (with real RSA signatures and Google's
certificate endpoint answered locally), the routes behind it, what the model does when a
provider is busy, and which column on a spreadsheet holds what.

### The shape of it

```
addon/            what gets pushed to the script project
  Code.gs           the menu, the window, the settings
  Sheets.gs         everything that touches the spreadsheet
  Dialog.html       built — do not edit
web/src/
  dialog/           the window: Dialog, ReviewTable, Settings, AskPanel, bridge, fields
  extractor/        frames → model → rows → roster matching (unchanged)
  styles/           tokens.css (the palette), dialog.css (the window)
worker.js           the door, and the model proxy
worker/identity.js  checking Google's signature on who is calling
worker/ai/          asking about a tab
```

---

## Before this

This repository used to hold a whole spreadsheet application — accounts, a D1 database, a file
browser, an editable grid, imported workbooks. It was retired in favour of living inside Google
Sheets, which people were using anyway. The code is in the history if it is ever wanted; the
data it held was exported first.

---

## Publishing it as an add-on

A bound script belongs to one spreadsheet. Installed from the Google Workspace Marketplace, the
same code appears in **every** spreadsheet its owner opens, and a new one needs no setup at all.
The code is identical — `Code.gs`, `Sheets.gs`, `Dialog.html` unchanged. What differs:

- the project is **standalone**, not bound to a file;
- the manifest is `addon/appsscript.marketplace.json`, which adds the `addOns` block;
- there is **one OAuth client for the add-on**, so `SCRIPT_AUD` is a single value forever.

### The steps

1. **A standalone project.** [script.google.com](https://script.google.com) → New project. Paste
   in `Code.gs`, `Sheets.gs` and `Dialog` (HTML), and the marketplace manifest. Set its Cloud
   project (⚙ Project Settings → Google Cloud Platform project) to the same one the consent
   screen lives in.
2. **Deploy it.** Deploy → New deployment → **Add-on**. Keep the deployment id; the listing
   asks for it. A new version later reaches everyone without anybody reinstalling.
3. **Enable the Marketplace SDK** in that Cloud project, and fill in the app configuration:
   the deployment id, the icons (`docs/icon-32.png`, `-64`, `-128`, served from the site),
   a 1280×800 screenshot, a description, and the support, terms and privacy links.
4. **Visibility.** *Private* skips Google's review but only reaches one Google Workspace domain,
   which is no use for people on personal Gmail accounts. *Unlisted* — not searchable, install
   by link — is the one to choose, and Google reviews it before it goes live.
5. **Install it** from the link, in any spreadsheet, and the menu is under Extensions.

### The thing that must change with it

Today the Worker's gate is "whoever authorised this add-on", which is the same set of people as
"whoever the spreadsheet is shared with". A published add-on breaks that equivalence: anybody
with the link can install it, authorise it, and spend the model key. So with a listing,
`ALLOWED_EMAILS` stops being optional and becomes the real gate:

```bash
npx wrangler secret put ALLOWED_EMAILS     # the addresses that may use it, comma-separated
```

The client-id check stays as the second lock: a request must be *from this add-on* and *from
one of these people*.

### Or, without the review

`SCRIPT_AUD` takes a comma-separated list, so the bound script can simply be pasted into each
spreadsheet — or the spreadsheet copied, which brings the script with it — and each copy's
client id added to the list. No review, no listing, and each sheet keeps its own roster tab and
log. It is the right answer for two or three spreadsheets and the wrong one for twenty.
