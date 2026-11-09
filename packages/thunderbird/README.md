# Impersonation Guard for Thunderbird

A Thunderbird [MailExtension](https://developer.thunderbird.net/add-ons/mailextensions) that
reads the message you are viewing, runs the
[impersonation-detector](https://github.com/Sonchez1/impersonation-detector) engine on your
own computer, and shows an evidence banner above the message: *Looks OK · Be careful ·
Likely a scam · Scam*, one plain sentence per finding, the exact thing to look at, and the
safe next step.

It is the same engine, the same verdict, and the same banner as the
[Impersonation Guard](../../README.md) browser extension — reused from `packages/engine` and
the extension's shared `core`, `protected`, `protocol` and `panel` modules, not reimplemented.
The parity suite that covers the engine reproduces all 1,520 of the Python package's
benchmark verdicts, so a message is rated the same here as in the Chrome extension and the
Python detector.

## How it works

- A **message-display script** registered at startup runs inside each message you open. It
  asks the background page to analyze the message currently shown in that tab.
- The **background page** reads the displayed message with
  `messageDisplay.getDisplayedMessages()` and `messages.getFull()` (permission
  `messagesRead`), pulls out sender name/address, subject, body text and link hosts, resolves
  the per-message protected set exactly as the Chrome extension does, runs the engine, and
  returns the explanation.
- The display script (permission `messagesModify`) inserts the banner at the top of the
  message, inside a shadow root so the message's own styles cannot touch it.

No network requests are made except, if you turn on *Local AI* in Settings, to your own
[Ollama](https://ollama.com) server (`http://localhost:11434` by default). Nothing else
leaves your machine. See [LISTING.md](LISTING.md) for the store privacy wording and the
project [PRIVACY.md](../../PRIVACY.md) for the full statement.

## Build

From the repository root (installs the workspace, including esbuild):

```bash
npm install
```

Then build this package:

```bash
npm run build --workspace @impersonation-guard/thunderbird
```

The bundle is written to `packages/thunderbird/dist/` with `manifest.json` at its root.

## Install for testing (temporary, `about:debugging`)

1. In Thunderbird (128 ESR or newer) open the menu → **Add-ons and Themes**, or type
   `about:debugging` in a tab.
2. On `about:debugging` choose **This Thunderbird**.
3. Click **Load Temporary Add-on…** and select
   `packages/thunderbird/dist/manifest.json`.
4. Open any message. The banner appears above it. Open the add-on's **Preferences** to set
   the names and domains you want protected and, optionally, a local Ollama model.

A temporary add-on is removed when Thunderbird restarts; reload it the same way.

## Package a signed-ready `.xpi`

An `.xpi` is a plain zip of `dist/` with `manifest.json` at the root:

```bash
npm run build --workspace @impersonation-guard/thunderbird
cd packages/thunderbird && (cd dist && zip -r -FS -X ../impersonation-guard-thunderbird.xpi .)
```

or, equivalently, in one step:

```bash
npm run package --workspace @impersonation-guard/thunderbird
```

This writes `packages/thunderbird/impersonation-guard-thunderbird.xpi`. Submit it to
[addons.thunderbird.net](https://addons.thunderbird.net) (the listing text is in
[LISTING.md](LISTING.md)) or install it permanently in Thunderbird via **Add-ons and
Themes → gear → Install Add-on From File…** (unsigned `.xpi` files install in Thunderbird
Daily/Beta, or in release with `xpinstall.signatures.required` set to `false`; the add-ons
site signs it for general use).

## Tests

```bash
npm test
```

`packages/thunderbird/test/message.test.ts` covers MIME/body/link extraction and author
parsing; `packages/thunderbird/test/banner.test.ts` runs the whole path — displayed message
→ engine → explanation → banner — against an in-memory stand-in for the Thunderbird API,
using happy-dom.
