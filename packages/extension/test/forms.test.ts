// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCore, type Flag } from "../src/shared/core";
import { DEFAULT_SETTINGS, type Request, type Settings } from "../src/shared/protocol";
import { collectBrandText, findSensitiveFields } from "../src/content/forms-detect";

type FormsModule = typeof import("../src/content/forms");
let forms: FormsModule;

const settings: Settings = { ...DEFAULT_SETTINGS, protected: ["northfieldstate.edu", "Northfield State University", "NSU"], useBundledBrands: true };
let flags: Record<string, Flag> = {};
const core = createCore({
  getSettings: async () => settings,
  getFlags: async () => flags,
  setFlags: async (f) => { flags = f; },
});

beforeAll(async () => {
  (globalThis as unknown as { __guardManual: boolean }).__guardManual = true;
  (globalThis as unknown as { __guardTransport: (r: Request) => Promise<unknown> }).__guardTransport = async (req: Request) => {
    if (req.type === "checkPage") return core.checkPage(req);
    if (req.type === "analyze") return core.analyze(req.message, req.source);
    return { ok: true };
  };
  forms = await import("../src/content/forms");
});

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  sessionStorage.clear();
  forms.reset();
});

describe("findSensitiveFields", () => {
  it("finds password, one-time-code, hinted numeric, and single-char groups", () => {
    document.body.innerHTML = `
      <form>
        <label for="pw">Password</label><input id="pw" type="password">
        <input id="otc" autocomplete="one-time-code" inputmode="numeric">
        <input id="hint" type="text" inputmode="numeric" maxlength="6" placeholder="Enter the 6-digit code">
        <div class="boxes">
          <input maxlength="1"><input maxlength="1"><input maxlength="1"><input maxlength="1"><input maxlength="1"><input maxlength="1">
        </div>
        <input type="search" name="q" placeholder="Search">
        <label for="zip">ZIP</label><input id="zip" type="text" inputmode="numeric" maxlength="5">
      </form>`;
    const f = findSensitiveFields(document);
    expect(f.password.map((i) => i.id)).toEqual(["pw"]);
    const otpIds = f.otp.map((i) => i.id || i.getAttribute("maxlength"));
    expect(otpIds).toContain("otc");
    expect(otpIds).toContain("hint");
    expect(f.otp.filter((i) => i.getAttribute("maxlength") === "1").length).toBe(6);
    expect(f.otp.some((i) => i.id === "zip")).toBe(false);
    expect(f.otp.some((i) => i.getAttribute("name") === "q")).toBe(false);
    expect(f.password.some((i) => i.getAttribute("name") === "q")).toBe(false);
  });

  it("uses a preceding heading as the hint", () => {
    document.body.innerHTML = `<form><h2>Enter your verification code</h2><input type="text" maxlength="6" name="x"></form>`;
    expect(findSensitiveFields(document).otp.length).toBe(1);
  });
});

describe("collectBrandText", () => {
  it("picks up title, heading and logo alt", () => {
    document.title = "Northfield State University - Sign in";
    document.body.innerHTML = `<header><img class="logo" alt="NSU Logo"></header><h1>Student Portal</h1>`;
    const t = collectBrandText(document);
    expect(t).toContain("northfield state university - sign in");
    expect(t).toContain("student portal");
    expect(t).toContain("nsu logo");
  });
});

describe("point-of-harm interrupt", () => {
  function phishingPage(): HTMLFormElement {
    document.title = "Northfield State University - ID.me verification";
    document.body.innerHTML = `
      <form id="f">
        <h1>Northfield State University</h1>
        <label for="p">Password</label><input id="p" type="password">
        <label for="c">Enter verification code</label><input id="c" type="text" inputmode="numeric" maxlength="6">
        <button type="submit">Verify</button>
      </form>`;
    return document.getElementById("f") as HTMLFormElement;
  }

  it("interrupts a lookalike host asking for a password and a code", async () => {
    (globalThis as unknown as { __guardDemoHost: string }).__guardDemoHost = "link.northfieldstat.edu";
    const form = phishingPage();
    const res = await forms.checkNow();
    expect(res?.interrupt).toBe(true);
    const overlay = document.querySelector('[data-impersonation-guard="interrupt"]') as HTMLElement | null;
    expect(overlay).not.toBeNull();
    const shadowText = overlay!.shadowRoot!.textContent ?? "";
    expect(shadowText).toContain("Stop");
    expect(shadowText).toContain("northfieldstat.edu");

    const submit = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);

    const cont = overlay!.shadowRoot!.querySelector("button.danger") as HTMLButtonElement;
    expect(cont).not.toBeNull();
    cont.click();
    expect(document.querySelector('[data-impersonation-guard="interrupt"]')).toBeNull();
    expect(sessionStorage.getItem("impersonation-guard:allowed:link.northfieldstat.edu")).not.toBeNull();

    const submit2 = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submit2);
    expect(submit2.defaultPrevented).toBe(false);
  });

  it("does not interrupt the genuine host", async () => {
    (globalThis as unknown as { __guardDemoHost: string }).__guardDemoHost = "northfieldstate.edu";
    phishingPage();
    const res = await forms.checkNow();
    expect(res?.interrupt).toBe(false);
    expect(res?.level).toBe("ok");
    expect(document.querySelector('[data-impersonation-guard="interrupt"]')).toBeNull();
  });

  it("does not interrupt a page with no sensitive fields", async () => {
    (globalThis as unknown as { __guardDemoHost: string }).__guardDemoHost = "link.northfieldstat.edu";
    document.body.innerHTML = `<form><input type="search" name="q"></form>`;
    expect(await forms.checkNow()).toBeNull();
  });
});
