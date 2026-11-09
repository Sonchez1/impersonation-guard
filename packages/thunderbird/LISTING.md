# addons.thunderbird.net listing

## Name

Impersonation Guard for Thunderbird

## Summary

(under 250 characters)

> Spots impersonation and phishing in the message you are reading and explains why, in one plain sentence per finding. Everything runs on your own computer; no message ever leaves it. Optional local AI through Ollama.

## Description

Impersonation Guard reads the message you have open and puts a banner above it: **Looks OK**,
**Be careful**, **Likely a scam**, or **Scam** — with one plain sentence for each finding,
the exact thing to look at (the sender's address, the link's real domain, what the message
asks for), and the safe next step. "Show technical detail" reveals the specific check that
fired.

It is built for the person receiving the message, not for a company. Every finding is
evidence you can verify yourself, so the goal is not only to catch one message but to make
the next one recognisable.

**How it decides** — three layers, fused into one verdict:

1. **Lookalike names.** Unicode confusable skeletons (UTS #39), mixed scripts, punycode and
   typo distance against the names and domains you choose to protect.
2. **Sender score.** An explainable logistic model over 23 named features of the sender and
   each link host — a brand name claimed from the wrong domain, a domain built only from
   lure words, a real brand glued to other words, invisible characters, free webmail with an
   official-sounding role. Each verdict lists its reasons.
3. **Message intent.** A deterministic rule classifier over cue phrases, or — only if you
   turn it on — a language model running locally through Ollama. The message is treated as
   untrusted data, pre-filtered for prompt-injection, and the model's output is
   schema-checked; anything unparseable fails safe.

Which names are checked is decided per message: your own list in Preferences, your own
account domains, and any bundled brand the message actually mentions or links to. A message
that never mentions PayPal is not scored against PayPal.

It uses the same engine as the Impersonation Guard browser extension and the open-source
impersonation-detector project, whose test suite reproduces all 1,520 of its benchmark
verdicts.

Source code (MIT): https://github.com/Sonchez1/impersonation-guard

## Privacy

Impersonation Guard is built so that the only computer that ever sees your mail is your own.

**What it reads.** The message you are viewing: sender name and address, subject, body text
and the addresses of links in it.

**Where that goes.** Nowhere. Analysis runs inside the add-on on your computer. The add-on
makes no network requests of its own.

**The one exception you control.** If you turn on *Local AI* in Preferences, message text is
sent to the Ollama server at the address you configure, which by default is
`http://localhost:11434` — your own machine. If you point it at another machine, the text
goes to that machine. The add-on never ships with this on.

**What it stores.** Your settings (the names you protect, your own domains, preferences) in
Thunderbird's extension storage, and a short list of flagged link hosts so a later message
that reuses one can be recognised. No history of messages or verdicts is kept.

**Analytics, accounts, telemetry.** None.

**Permissions.** `messagesRead` to read the message you are viewing; `messagesModify` to put
the banner above it; `storage` for your settings; access to `http://localhost:11434` for the
optional local model.

The code is public and MIT-licensed, so all of the above can be checked.
