/** Demo bundle for the popup: runs the analysis core in-page, injects the real popup markup
 *  from dist/popup.html into the fixture, and (with ?auto) pre-fills and checks a sample so
 *  the result card is visible for screenshots. Loaded only by fixtures/demo-popup.html. */

import { createCore, type Flag } from "../shared/core";
import { DEFAULT_SETTINGS, type Request, type Response, type Settings } from "../shared/protocol";

const settings: Settings = { ...DEFAULT_SETTINGS };
let flags: Record<string, Flag> = {};
const core = createCore({
  getSettings: async () => settings,
  getFlags: async () => flags,
  setFlags: async (f) => { flags = f; },
});

async function transport(req: Request): Promise<Response> {
  switch (req.type) {
    case "ping": return { ok: true };
    case "getSettings": return settings;
    case "setSettings": Object.assign(settings, req.settings); return settings;
    case "addOwnDomain": return { ok: true };
    case "analyze": return core.analyze(req.message, req.source);
    case "checkPage": return core.checkPage(req);
    default: return { error: "unknown request" };
  }
}
(globalThis as unknown as { __guardTransport?: typeof transport }).__guardTransport = transport;

const SAMPLE = {
  body: "Hi! This is Daniel from the LinkedIn Trust & Safety team. We noticed unusual sign-in activity on your account. To keep it from being restricted, confirm your identity within 24 hours at https://linkedin-verify.app/secure and reply with the 6-digit code we text you.",
  senderName: "LinkedIn Support",
  senderAddress: "li.support@gmail.com",
  subject: "Action required: confirm your identity",
};

(async () => {
  const frame = document.getElementById("frame");
  if (!frame) return;
  const html = await (await fetch("/packages/extension/dist/popup.html")).text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const main = doc.querySelector("main.popup");
  if (!main) return;
  main.querySelectorAll("img").forEach((img) => { img.src = "/packages/extension/dist/" + img.getAttribute("src"); });
  frame.appendChild(main);
  await import("../popup/popup");
  if (new URLSearchParams(location.search).has("auto")) {
    (document.getElementById("body") as HTMLTextAreaElement).value = SAMPLE.body;
    (document.getElementById("senderName") as HTMLInputElement).value = SAMPLE.senderName;
    (document.getElementById("senderAddress") as HTMLInputElement).value = SAMPLE.senderAddress;
    (document.getElementById("subject") as HTMLInputElement).value = SAMPLE.subject;
    (document.getElementById("check") as HTMLButtonElement).click();
  }
})();
