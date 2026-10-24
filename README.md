# Impersonation Guard

A free, open-source browser extension that protects a person, not a company, from
impersonation and phishing. It reads the message you have open, says in one sentence
whether it is safe and exactly why, and stops you at the moment of harm: before you type a
password or a one-time code into a page that is not the real site. Everything runs on your
own computer. No message, screenshot or address ever leaves it.

It is the consumer door for the [impersonation-detector](https://github.com/Sonchez1/impersonation-detector)
engine. The engine's Python version is for platforms that send messages; this extension is
for the people who receive them.

## What it does

| Surface | What you see |
|---|---|
| **Inbox** (Gmail, Outlook on the web) | A banner above every open message: *Looks OK · Be careful · Likely a scam · Scam*, one plain sentence per finding, the exact thing to look at, and the safe next step. "Show technical detail" reveals the feature or signal that fired. |
| **Any page** | If a page asks for a password or a one-time code and its address imitates a site you use, or you reached it from a message the guard flagged, a full-screen interrupt stops the submission until you decide. |
| **Toolbar popup** | Paste a text, a WhatsApp or Discord message, or drop a screenshot. Text is read on your machine and checked the same way. |

Every finding is evidence a person can verify themselves: the sender's name beside the
real address, the link's domain beside the brand it imitates, the thing the message asks
for. The aim is not only to block one message but to make the next one recognisable.

## How it decides

Three layers, fused into one verdict, identical to the Python engine (the test suite
reproduces every one of its 1,520 benchmark verdicts):

1. **Lookalike names.** Unicode confusable skeletons (UTS #39), mixed scripts, punycode and
   typo distance against the names being protected.
2. **Sender score.** A logistic model over 23 named features of the sender and each link
   host: brand claimed off-domain, lure-word domains, brand glued to affixes, invisible
   characters, free webmail with a role claim. Each prediction lists its reasons.
3. **Message intent.** A rule classifier over cue phrases, or, if you opt in, a language
   model running locally through [Ollama](https://ollama.com). The model never sees your
   message as instructions; it is wrapped as data, pre-filtered for prompt injection, and
   its output is schema-checked. Unparseable output fails closed.

Which names are protected is decided per message: your own list in Settings, the domains of
your own accounts (learned from your inbox), and any bundled brand the message mentions by
name or links to. A message that never mentions PayPal is not scored against PayPal.

## What it does not do

* It does not see messages inside apps the browser cannot read. Use the popup for those.
* It does not know every brand. Add your school, employer and bank in Settings; the
  bundled list covers common targets.
* The rule classifier misses lures written in a register it has no cues for, such as a
  university tax-office lure with a one-time-code relay. The test suite records one such
  case honestly: the rule layer passes it and the local model catches it, which is the
  reason the local model exists. Since then the lookalike check also compares a link's
  registrable domain, which catches that case deterministically.
* It is not a replacement for your mail provider's spam filter or your browser's Safe
  Browsing. It sits after them and explains what they do not.

## Install (developer build)

```
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose *Load unpacked*, and select
`packages/extension/dist`. A Chrome Web Store listing follows once the first pilot is done.

To try it without installing: `node fixtures/serve.mjs` and open
`http://localhost:8765/fixtures/demo-inbox.html` and `/fixtures/demo-login.html`. The demo
runs the same engine in the page.

### Optional local model

```
OLLAMA_ORIGINS=chrome-extension://* ollama serve
ollama pull llama3.1:8b
```

Then enable *Local AI* in Settings. Without it, the rule classifier is used.

## Repository layout

```
packages/engine      TypeScript port of impersonation-detector 0.4.0 (Layers 1-3, fusion, explanations)
packages/extension   Manifest V3 extension: service worker, inbox overlay, form interrupt, popup, options
fixtures/            parity.jsonl (Python verdicts for the full benchmark) and the demo pages
tools/               export_parity.py (regenerates parity.jsonl from the Python package), icon generator
```

`npm test` runs the parity suite and the surface tests.

## Privacy

See [PRIVACY.md](PRIVACY.md). Short version: no network requests except, if you turn it on,
to the Ollama server on your own machine. No analytics. No accounts.

## Roadmap

1. Pilot with one university security office and one platform trust-and-safety team;
   measure interrupted submissions, not messages flagged.
2. Non-English lures with native-speaker-reviewed corpora, starting with Spanish, Chinese,
   Hindi and Vietnamese.
3. A growing, versioned benchmark with real reported incidents (consented, anonymised).
4. Campaign sharing between platforms via the open format in the engine's IETF draft.

## License

MIT. Unicode data files are redistributed under the Unicode License. Tesseract OCR assets
are Apache 2.0.
