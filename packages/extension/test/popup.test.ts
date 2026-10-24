// @vitest-environment happy-dom
/** The popup's check flow end to end: HTML from static/popup.html, the in-page transport
 *  built from the shared core, the engine, and the panel renderer. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createCore, type Flag } from "../src/shared/core";
import { DEFAULT_SETTINGS, type Request, type Response, type Settings } from "../src/shared/protocol";

const html = readFileSync(resolve(__dirname, "../static/popup.html"), "utf-8");

const settings: Settings = { ...DEFAULT_SETTINGS, protected: ["linkedin.com", "LinkedIn"] };
let flags: Record<string, Flag> = {};
const core = createCore({ getSettings: async () => settings, getFlags: async () => flags, setFlags: async (f) => { flags = f; } });

(globalThis as { __guardTransport?: (r: Request) => Promise<Response> }).__guardTransport = async (req) => {
  if (req.type === "analyze") return core.analyze(req.message, req.source);
  if (req.type === "getSettings") return settings;
  return { ok: true };
};
(globalThis as { __guardNoAuto?: boolean }).__guardNoAuto = true;

let popup: typeof import("../src/popup/popup");

function mount(): void {
  const bodyHtml = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[^>]*>.*?<\/script>/gs, "");
  document.body.innerHTML = bodyHtml;
  popup.initPopup(document);
}

async function check(text: string, senderName = "", senderAddress = "", subject = ""): Promise<HTMLElement> {
  mount();
  (document.getElementById("body") as HTMLTextAreaElement).value = text;
  (document.getElementById("senderName") as HTMLInputElement).value = senderName;
  (document.getElementById("senderAddress") as HTMLInputElement).value = senderAddress;
  (document.getElementById("subject") as HTMLInputElement).value = subject;
  (document.getElementById("check") as HTMLButtonElement).click();
  await popup.state.lastRun;
  return document.getElementById("result") as HTMLElement;
}

function panelText(result: HTMLElement): string {
  const host = result.querySelector("[data-impersonation-guard]") as HTMLElement | null;
  return host?.shadowRoot?.textContent ?? "";
}

beforeAll(async () => {
  popup = await import("../src/popup/popup");
});

describe("popup check flow", () => {
  it("renders a Scam card for the LinkedIn support scam", async () => {
    const result = await check(
      "This is the LinkedIn Security Team. Unusual login detected. Verify your identity at https://linkedin-verify.app/login within 24 hours or your account will be suspended.",
      "LinkedIn Support", "li.support@gmail.com", "Action required",
    );
    const text = panelText(result);
    expect(text).toContain("Scam");
    expect(text).toContain("gmail.com");
    expect(text).toContain("rules engine");
    expect(result.querySelector("[data-impersonation-guard]")?.getAttribute("data-impersonation-guard")).toBe("card");
  });

  it("renders a Looks OK card for a plain recruiter message", async () => {
    const result = await check(
      "Hi Priya, I'm a recruiter at Acme Robotics. We're hiring summer software interns in Austin ($42/hour). The posting is at https://acmerobotics.com/careers/1234.",
      "Luis Garcia", "luis.garcia@acmerobotics.com", "Summer SWE internship",
    );
    expect(panelText(result)).toContain("Looks OK");
  });

  it("asks for text when the box is empty", async () => {
    const result = await check("");
    expect(result.textContent).toContain("Paste a message");
  });

  it.skip("reads a screenshot with OCR (needs a browser: Web Workers, wasm and importScripts are not available in this Node test environment)", () => {});
});
