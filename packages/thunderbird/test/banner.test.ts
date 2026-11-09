// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MessageHeader, MessagePart } from "../src/thunderbird";

/** An in-memory stand-in for the slice of the Thunderbird API the add-on calls, so the whole
 *  path — getDisplayedMessages → getFull → engine → explanation → banner — runs under vitest. */
let storage: Record<string, unknown> = {};
let displayed: { headers: MessageHeader[]; full: MessagePart } = { headers: [], full: {} };

const messengerMock = {
  runtime: {
    onMessage: { addListener() { /* not started in tests */ } },
    onInstalled: { addListener() { /* not started in tests */ } },
    sendMessage: async () => ({}),
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (typeof keys === "string") return { [keys]: storage[keys] };
        return { ...storage };
      },
      set: async (items: Record<string, unknown>) => { Object.assign(storage, items); },
    },
  },
  messageDisplay: {
    getDisplayedMessages: async () => ({ id: "tab", messages: displayed.headers }),
  },
  messages: {
    getFull: async () => displayed.full,
  },
  messageDisplayScripts: { register: async () => ({}) },
};

(globalThis as unknown as { messenger: unknown }).messenger = messengerMock;
(globalThis as unknown as { __guardNoStart: boolean }).__guardNoStart = true;
(globalThis as unknown as { __guardNoRun: boolean }).__guardNoRun = true;

function message(author: string, subject: string, plain: string, html?: string): { headers: MessageHeader[]; full: MessagePart } {
  const parts: MessagePart[] = [{ contentType: "text/plain", body: plain }];
  if (html) parts.push({ contentType: "text/html", body: html });
  return {
    headers: [{ id: 1, author, subject }],
    full: { contentType: "multipart/alternative", parts },
  };
}

const SCAM = message(
  "LinkedIn Support <li.support@gmail.com>",
  "Action required",
  "This is the LinkedIn Security Team. Unusual login detected. Verify your identity within 24 hours or your account will be suspended.",
  `This is the LinkedIn Security Team. Verify your identity at <a href="https://linkedin-verify.app/login">https://linkedin-verify.app/login</a> within 24 hours or your account will be suspended.`,
);
const BENIGN = message(
  "Luis Garcia <luis.garcia@acmerobotics.com>",
  "Summer SWE internship",
  "Hi Priya, I'm a recruiter at Acme Robotics. We're hiring summer software interns in Austin ($42/hour). The posting is at acmerobotics.com/careers/1234.",
);

type Handle = (req: unknown, sender: { tab?: { id?: number } }) => Promise<Record<string, unknown>>;
type RenderBanner = (resp: unknown, doc?: Document) => HTMLElement | null;

function bannerOf(doc: Document): { host: Element | null; text: string; dots: string[] } {
  const host = doc.querySelector('[data-impersonation-guard="banner"]');
  const root = host?.shadowRoot;
  return {
    host,
    text: root?.textContent ?? "",
    dots: Array.from(root?.querySelectorAll(".dot") ?? []).map((d) => d.className),
  };
}

describe("Thunderbird message banner", () => {
  let handle: Handle;
  let renderBanner: RenderBanner;

  beforeAll(async () => {
    handle = (await import("../src/background")).handle as unknown as Handle;
    renderBanner = (await import("../src/message-display")).renderBanner as unknown as RenderBanner;
  });

  beforeEach(() => {
    storage = {};
    document.body.innerHTML = "";
  });

  it("errors cleanly when the display script has no tab", async () => {
    displayed = SCAM;
    const resp = await handle({ type: "analyzeDisplayed" }, {});
    expect(resp.error).toBeTruthy();
    expect(renderBanner(resp, document)).toBeNull();
  });

  it("reports empty when no message is displayed", async () => {
    displayed = { headers: [], full: {} };
    const resp = await handle({ type: "analyzeDisplayed" }, { tab: { id: 1 } });
    expect(resp.empty).toBe(true);
  });

  it("flags the LinkedIn-support-from-gmail scam and shows the address as evidence", async () => {
    displayed = SCAM;
    const resp = await handle({ type: "analyzeDisplayed" }, { tab: { id: 1 } });
    expect((resp.verdict as { action: string }).action).toBe("block");
    const host = renderBanner(resp, document);
    expect(host).not.toBeNull();
    const b = bannerOf(document);
    expect(b.text).toContain("Scam");
    expect(b.text).toContain("gmail.com");
    expect(b.dots.some((c) => c.includes("high"))).toBe(true);
    expect(b.text).toContain("Checked on your computer by the rules engine");
    // Banner sits at the very top of the message body.
    expect(document.body.firstElementChild).toBe(host);
  });

  it("gives a benign recruiter message an OK banner with no high-severity item", async () => {
    displayed = BENIGN;
    const resp = await handle({ type: "analyzeDisplayed" }, { tab: { id: 1 } });
    expect((resp.verdict as { action: string }).action).toBe("allow");
    renderBanner(resp, document);
    const b = bannerOf(document);
    expect(b.host).not.toBeNull();
    expect(b.text).toContain("Looks OK");
    expect(b.dots.some((c) => c.includes("high"))).toBe(false);
  });

  it("suppresses the OK banner when showOkBadge is off", async () => {
    await messengerMock.storage.local.set({ settings: { showOkBadge: false } });
    displayed = BENIGN;
    const resp = await handle({ type: "analyzeDisplayed" }, { tab: { id: 1 } });
    expect(resp.showOkBadge).toBe(false);
    expect(renderBanner(resp, document)).toBeNull();
    expect(bannerOf(document).host).toBeNull();
  });

  it("does not stack banners: a second render replaces the first", async () => {
    displayed = SCAM;
    const resp = await handle({ type: "analyzeDisplayed" }, { tab: { id: 1 } });
    renderBanner(resp, document);
    renderBanner(resp, document);
    expect(document.querySelectorAll('[data-impersonation-guard="banner"]').length).toBe(1);
  });

  it("round-trips settings through the background handler", async () => {
    const saved = await handle({ type: "setSettings", settings: { protected: ["mybank.com"], showOkBadge: false } }, {});
    expect((saved as { protected: string[] }).protected).toContain("mybank.com");
    const got = await handle({ type: "getSettings" }, {});
    expect((got as { showOkBadge: boolean }).showOkBadge).toBe(false);
  });
});
