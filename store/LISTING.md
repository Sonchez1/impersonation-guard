# Chrome Web Store listing

Everything below is ready to paste into the Developer Dashboard. Field limits are Google's.

## Package

```
npm run build
npm run package      # writes store/impersonation-guard-<version>.zip
```

Upload the zip. It contains `manifest.json` at the root and excludes the demo bundles.

## Store listing tab

**Name** (45 max)

```
Impersonation Guard
```

**Summary** (132 max)

```
Spots impersonation and phishing in your inbox, explains exactly why, and stops you before you type a password or code into a fake page.
```

**Description**

```
Impersonation Guard protects you, not a company. It reads the message you have open, tells you in one sentence whether it is safe and exactly why, and interrupts at the moment of harm: before you type a password or a one-time code into a page that only looks like the real site.

WHAT YOU SEE

• In Gmail and Outlook on the web, a banner above every open message: Looks OK, Be careful, Likely a scam, or Scam. Under it, one plain sentence per finding and the exact thing to look at: the sender's name beside the real address, a link's domain beside the brand it imitates, the thing the message asks you to do.

• On any page, if a form asks for a password or a one-time code and the page's address imitates a site you use, or you got there from a message the guard flagged, a full-screen stop blocks the submission until you decide.

• In the toolbar popup, paste a text message, a WhatsApp or Discord message, or drop a screenshot. The text is read on your computer and checked the same way.

HOW IT DECIDES

Three layers, combined into one verdict. Lookalike names: Unicode confusable characters, mixed scripts, punycode and one-or-two-letter typos against the names you protect. Sender score: a small explainable model over 23 named signals, such as a brand name on an address the brand does not own, or an official-sounding role from a free webmail account. Message intent: what the message asks for, from a rule engine or, if you turn it on, a language model running locally through Ollama.

Which names are checked is decided per message: your own list in Settings, the domains of your own accounts, and any well-known brand the message mentions or links to.

PRIVACY

Everything runs inside the extension on your computer. No message, screenshot or address leaves it. The extension makes no network requests of its own. The only exception is one you turn on yourself: the optional local AI model, which sends text to the Ollama server on your own machine. No analytics, no accounts, no telemetry. The code is open source under the MIT license.

WHAT IT DOES NOT DO

It does not replace your mail provider's spam filter or your browser's Safe Browsing; it sits after them and explains what they do not. It does not know every brand; add your school, employer and bank in Settings. A rule engine can miss lures written in an unfamiliar register; the optional local model catches more.

Source and documentation: https://github.com/Sonchez1/impersonation-guard
```

**Category**: Productivity → Tools (or Privacy & Security if offered)
**Language**: English (United States)

## Graphic assets

Screenshots, 1280×800 PNG, in `store/screenshots/`:

1. `01-inbox-banner.png` — the inbox banner on a scam, with the evidence lines.
2. `02-login-interrupt.png` — the full-screen stop on a lookalike login page.
3. `03-popup-check.png` — the popup with a pasted message and the result card.

Small promo tile 440×280 (optional but shown in search): make from the 128 px icon on a
white background with the name; `tools/make_icons.mjs` can be extended if wanted.

Store icon: `packages/extension/icons/icon128.png`.

## Privacy practices tab

**Single purpose description**

```
Detect impersonation and phishing in messages the user is reading or pastes, explain the evidence, and warn before credentials or one-time codes are entered on a page that imitates a site the user uses.
```

**Permission justifications**

`storage`
```
Stores the user's settings (names to protect, preferences) and, for the browser session only, the list of link hosts seen in flagged messages so that a page opened from such a message can be recognised. No message content is stored.
```

Host permission `https://mail.google.com/*` and Outlook hosts
```
Reads the sender, subject, body text and link addresses of the message the user has open, to analyse it locally and show the verdict banner above it.
```

Host permission `http://*/*`, `https://*/*` (content script on all sites)
```
Detects password and one-time-code fields on the current page and compares the page's address to the names the user protects, so the extension can interrupt before credentials are entered on a lookalike page. This is the core point-of-harm protection and cannot work on a fixed list of sites because phishing pages are on new domains. Only the page's address, title, visible brand text and the presence of such fields are examined; nothing is transmitted.
```

Host permission `http://localhost:11434/*`, `http://127.0.0.1:11434/*`
```
Optional, off by default: lets the user route message text to an Ollama language-model server running on their own machine for a second opinion. Nothing is sent unless the user enables it in Settings.
```

**Remote code**: No, I am not using remote code. (All scripts, the OCR worker and its WebAssembly core ship inside the package.)

**Data usage**: tick nothing under "What user data do you plan to collect"; the extension collects none. Certify the three disclosures (no sale, no unrelated use, no creditworthiness use).

**Privacy policy URL**

```
https://github.com/Sonchez1/impersonation-guard/blob/main/PRIVACY.md
```

## Distribution tab

Visibility: Public. Regions: all. Pricing: free.

## Submission steps

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account that should own the listing (this is a public, long-lived identity for the project; a personal account is fine). Pay the one-time developer registration fee and verify the contact email on the Account tab.
2. Click **New item**, upload `store/impersonation-guard-0.1.0.zip`.
3. Fill the **Store listing** tab from this file; upload the three screenshots and the icon.
4. Fill the **Privacy practices** tab from this file. Every permission needs a justification or the submission is rejected.
5. **Distribution** tab: Public, all regions.
6. Save draft, then **Submit for review**. Because the extension requests access to all sites, expect the longer review path (a few days rather than hours). If the reviewer asks why all-sites access is needed, the justification above is the answer; offering a test page helps: point them at the repository's `fixtures/real-login.html` served locally, or any page with a password field.
7. When it is live, record the listing URL and take a Wayback Machine snapshot of it the same day. Add the URL to the README.

## After publication

* Each new version: bump `version` in `packages/extension/manifest.json`, `npm run build && npm run package`, upload the new zip in the dashboard's Package tab, submit.
* The listing's install count and the dated review history are part of the project's public record; screenshot them periodically.
