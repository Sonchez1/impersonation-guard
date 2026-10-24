# Privacy

Impersonation Guard is built so that the only computer that ever sees your messages is
your own.

**What it reads.** On Gmail and Outlook on the web it reads the message you have open:
sender name and address, subject, body text and link addresses. On other pages it reads
the page's address, title and visible brand text, and whether the page has a password or
one-time-code field. In the popup it reads only what you paste or drop.

**Where that goes.** Nowhere. Analysis runs inside the extension on your computer. The
extension makes no network requests of its own.

**The one exception you control.** If you turn on *Local AI* in Settings, message text is
sent to the Ollama server at the address you configure, which by default is
`http://localhost:11434`, your own machine. If you point it at another machine, the text
goes to that machine. The extension never ships with this on.

**Screenshots.** Text is extracted from images by Tesseract running inside the extension.
The image is not uploaded anywhere.

**What it stores.** Your settings (the names you protect, learned own-account domains,
preferences) in Chrome's extension storage, synced to your Chrome profile if you have sync
on. A short-lived list of flagged link hosts, kept only for the browser session, so that a
page you open from a flagged message can be recognised. The last text you pasted in the
popup, locally, for convenience. No history of messages or verdicts is kept.

**Analytics, accounts, telemetry.** None.

**Permissions.** `storage` for settings. Access to Gmail and Outlook pages to read the open
message. Access to all pages to detect password and code fields and show the interrupt;
this is the point-of-harm protection and cannot work without it. `http://localhost:11434`
for the optional local model.

**Source.** The code is public and MIT-licensed, so all of the above can be checked.
