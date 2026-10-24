/** Content script on every page: when the page asks for a password or a one-time code,
 *  ask the service worker whether the page looks like the real site. If not, interrupt
 *  before anything is submitted. Runs in iframes too; the overlay covers the frame it
 *  runs in. */

import { send, type CheckPageResponse } from "../shared/protocol";
import { createPanel } from "../ui/panel";
import { collectBrandText, findSensitiveFields, pageHost } from "./forms-detect";

const ALLOW_MS = 10 * 60 * 1000;
const THROTTLE_MS = 500;

function allowKey(host: string): string {
  return `impersonation-guard:allowed:${host}`;
}

function debug(...args: unknown[]): void {
  try { console.debug("[impersonation-guard]", ...args); } catch { /* ignore */ }
}

let checked = false;
let checkedHref = "";
let fieldCount = 0;
let inFlight = false;
let overlay: HTMLElement | null = null;
let sensitive: HTMLInputElement[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function isAllowed(host: string): boolean {
  try {
    const v = sessionStorage.getItem(allowKey(host));
    if (!v) return false;
    const t = Number(v);
    return Number.isFinite(t) && Date.now() - t < ALLOW_MS;
  } catch {
    return false;
  }
}

function remember(host: string): void {
  try { sessionStorage.setItem(allowKey(host), String(Date.now())); } catch { /* ignore */ }
}

// ---- blocking while the overlay is up ---------------------------------------------------

function onSubmitCapture(e: Event): void {
  if (!overlay) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

function onKeydownCapture(e: KeyboardEvent): void {
  if (!overlay || e.key !== "Enter") return;
  if (sensitive.includes(e.target as HTMLInputElement)) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}

function blurSensitive(): void {
  const active = document.activeElement as HTMLInputElement | null;
  if (active && sensitive.includes(active)) {
    try { active.blur(); } catch { /* ignore */ }
  }
}

// ---- overlay -------------------------------------------------------------------------------

function removeOverlay(): void {
  if (overlay) {
    try { overlay.remove(); } catch { /* ignore */ }
    overlay = null;
  }
}

function showOverlay(res: CheckPageResponse, host: string): void {
  if (overlay) return;
  const panel = createPanel(
    {
      level: res.level,
      headline: res.headline,
      items: res.items.map((i) => ({ text: i.text, evidence: i.evidence, detail: i.detail, severity: "high" as const })),
      safeStep: res.safeStep,
    },
    {
      mode: "interrupt",
      onLeave: () => {
        removeOverlay();
        try {
          if (history.length <= 1) location.replace("about:blank");
          else history.back();
        } catch { /* ignore */ }
      },
      onContinue: () => {
        remember(host);
        removeOverlay();
      },
    },
  );
  overlay = panel;
  (document.documentElement ?? document.body).appendChild(panel);
  blurSensitive();
}

// ---- the check ---------------------------------------------------------------------------

/** Check the page now. Returns the service worker's answer, or null when nothing needed
 *  checking (no sensitive fields, already checked, host allowed by the person). */
export async function checkNow(force = false): Promise<CheckPageResponse | null> {
  try {
    if (typeof location !== "undefined" && location.protocol === "chrome-extension:") return null;
    const host = pageHost();
    if (!host || isAllowed(host)) return null;
    const fields = findSensitiveFields(document);
    const n = fields.password.length + fields.otp.length;
    if (!n) return null;
    const href = typeof location !== "undefined" ? location.href : "";
    const same = checked && checkedHref === href;
    if (!force && same && n <= fieldCount) return null;
    if (inFlight) return null;
    inFlight = true;
    checked = true;
    checkedHref = href;
    fieldCount = n;
    sensitive = [...fields.password, ...fields.otp];
    const res = await send<CheckPageResponse>({
      type: "checkPage",
      host,
      href,
      referrer: typeof document !== "undefined" ? document.referrer : "",
      title: document.title,
      brandText: collectBrandText(document),
      fields: { password: fields.password.length > 0, otp: fields.otp.length > 0 },
    });
    if (res && res.interrupt) showOverlay(res, host);
    return res;
  } catch (e) {
    debug("check failed", e);
    return null;
  } finally {
    inFlight = false;
  }
}

/** Forget this navigation's check state (used when the URL changes and by tests). */
export function reset(): void {
  checked = false;
  checkedHref = "";
  fieldCount = 0;
  sensitive = [];
  removeOverlay();
}

function scheduleCheck(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (typeof location !== "undefined" && checked && checkedHref !== location.href) reset();
    void checkNow();
  }, THROTTLE_MS);
}

function start(): void {
  try {
    document.addEventListener("submit", onSubmitCapture, true);
    document.addEventListener("keydown", onKeydownCapture, true);
    document.addEventListener("focusin", (e) => {
      const t = e.target as HTMLInputElement | null;
      if (t && t.tagName === "INPUT" && !checked) void checkNow();
    }, true);
    void checkNow();
    const target = document.documentElement ?? document.body;
    if (target && typeof MutationObserver !== "undefined") {
      new MutationObserver(scheduleCheck).observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ["type", "autocomplete", "maxlength"] });
    }
  } catch (e) {
    debug("start failed", e);
  }
}

const manual = (globalThis as unknown as { __guardManual?: boolean }).__guardManual;
if (!manual && typeof document !== "undefined" && typeof location !== "undefined" && location.protocol !== "chrome-extension:") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
} else if (manual && typeof document !== "undefined") {
  // Tests drive checkNow() directly but still need the submit/keydown blockers.
  document.addEventListener("submit", onSubmitCapture, true);
  document.addEventListener("keydown", onKeydownCapture, true);
}
