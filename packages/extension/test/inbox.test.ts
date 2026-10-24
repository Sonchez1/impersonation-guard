// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { createCore, type Flag } from "../src/shared/core";
import { DEFAULT_SETTINGS, type Request, type Response, type Settings } from "../src/shared/protocol";

const settings: Settings = { ...DEFAULT_SETTINGS, useBundledBrands: true, showOkBadge: true };
let flags: Record<string, Flag> = {};
const core = createCore({
  getSettings: async () => settings,
  getFlags: async () => flags,
  setFlags: async (f) => { flags = f; },
});

(globalThis as { __guardTransport?: (r: Request) => Promise<Response> }).__guardTransport = async (req) => {
  switch (req.type) {
    case "analyze": return core.analyze(req.message, req.source);
    case "getSettings": return settings;
    case "addOwnDomain": return { ok: true };
    case "checkPage": return core.checkPage(req);
    default: return { ok: true };
  }
};
(globalThis as { __guardNoAutostart?: boolean }).__guardNoAutostart = true;

function gmailMessage(id: string, name: string, email: string, subject: string, bodyHtml: string): string {
  return `
    <div class="adn" data-message-id="${id}">
      <div class="header"><h2 class="hP">${subject}</h2>
        <span class="gD" email="${email}" name="${name}">${name}</span></div>
      <div class="ii"><div class="a3s">${bodyHtml}</div></div>
    </div>`;
}

const SCAM = gmailMessage("m2", "LinkedIn Support", "li.support@gmail.com", "Action required",
  `This is the LinkedIn Security Team. Unusual login detected. Verify your identity at
   <a href="https://linkedin-verify.app/login">https://linkedin-verify.app/login</a> within 24 hours or your account will be suspended.`);
const BENIGN = gmailMessage("m1", "Luis Garcia", "luis.garcia@acmerobotics.com", "Summer SWE internship",
  `Hi Priya, I'm a recruiter at Acme Robotics. We're hiring summer software interns in Austin ($42/hour).
   The posting is at <a href="https://acmerobotics.com/careers/1234">acmerobotics.com/careers/1234</a>.`);

function bannerOf(container: Element): { host: Element | null; text: string; dots: string[] } {
  const host = container.querySelector('[data-impersonation-guard="banner"]');
  const root = host?.shadowRoot;
  const text = root?.textContent ?? "";
  const dots = Array.from(root?.querySelectorAll(".dot") ?? []).map((d) => d.className);
  return { host, text, dots };
}

describe("gmail overlay", () => {
  let scanGmail: (root?: ParentNode) => Promise<void>;
  let extractGmailMessage: (c: Element) => { message: { links?: string[]; senderAddress?: string; subject?: string } } | null;

  beforeAll(async () => {
    const mod = await import("../src/content/gmail");
    scanGmail = mod.scanGmail;
    extractGmailMessage = mod.extractGmailMessage as typeof extractGmailMessage;
  });

  it("extracts sender, subject and real links", () => {
    document.body.innerHTML = SCAM;
    const ex = extractGmailMessage(document.querySelector("div.adn")!)!;
    expect(ex.message.senderAddress).toBe("li.support@gmail.com");
    expect(ex.message.subject).toBe("Action required");
    expect(ex.message.links).toEqual(["https://linkedin-verify.app/login"]);
  });

  it("flags the LinkedIn-support-from-gmail scam and explains the address", async () => {
    document.body.innerHTML = SCAM + BENIGN;
    await scanGmail(document);
    const scam = bannerOf(document.querySelector('[data-message-id="m2"]')!);
    expect(scam.host).not.toBeNull();
    expect(scam.text).toContain("Scam");
    expect(scam.text).toContain("gmail.com");
    expect(scam.dots.some((c) => c.includes("high"))).toBe(true);
    // The banner sits above the body, i.e. before the .ii wrapper.
    const container = document.querySelector('[data-message-id="m2"]')!;
    const ii = container.querySelector("div.ii")!;
    expect(scam.host!.nextElementSibling).toBe(ii);
  });

  it("gives the benign recruiter email an ok banner with no high-severity item", async () => {
    const benign = bannerOf(document.querySelector('[data-message-id="m1"]')!);
    expect(benign.host).not.toBeNull();
    expect(benign.text).toContain("Looks OK");
    expect(benign.dots.some((c) => c.includes("high"))).toBe(false);
  });

  it("does not duplicate banners on a second scan", async () => {
    await scanGmail(document);
    await scanGmail(document);
    expect(document.querySelectorAll('[data-impersonation-guard="banner"]').length).toBe(2);
  });

  it("re-analyzes when the same container shows a different message", async () => {
    const container = document.querySelector('[data-message-id="m1"]')!;
    container.querySelector("span.gD")!.setAttribute("email", "li.support@gmail.com");
    container.querySelector("span.gD")!.setAttribute("name", "LinkedIn Support");
    container.querySelector("div.a3s")!.innerHTML = "This is the LinkedIn Security Team. Verify your identity at https://linkedin-verify.app/login within 24 hours or your account will be suspended.";
    await scanGmail(document);
    const b = bannerOf(container);
    expect(b.text).toContain("Scam");
    expect(container.querySelectorAll('[data-impersonation-guard="banner"]').length).toBe(1);
  });
});
