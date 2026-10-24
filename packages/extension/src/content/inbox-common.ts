/** Shared by the Gmail and Outlook content scripts: pull a message out of the DOM, ask the
 *  service worker for a verdict, and put a banner above the message body. Every DOM access
 *  is defensive: a mail client re-renders constantly and selectors drift. */

import type { Message } from "@impersonation-guard/engine";
import { createPanel } from "../ui/panel";
import { send, type AnalyzeResponse, type Settings, type Source } from "../shared/protocol";

const ATTR_KEY = "data-guard-key";
const ATTR_STATE = "data-guard-state";

export function debug(...args: unknown[]): void {
  try {
    if ((globalThis as { __guardDebug?: boolean }).__guardDebug) console.debug("[impersonation-guard]", ...args);
  } catch { /* ignore */ }
}

/** Trailing-edge throttle: at most one call per `ms`, always running the latest request. */
export function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let last = 0;
  const run = () => {
    timer = null;
    pending = false;
    last = Date.now();
    try { fn(); } catch (e) { debug("throttled fn threw", e); }
  };
  return ((..._args: unknown[]) => {
    pending = true;
    if (timer) return;
    const wait = Math.max(0, ms - (Date.now() - last));
    timer = setTimeout(run, wait);
  }) as unknown as T;
}

/** Real link targets inside a message body: no mailto:, no mail-client internal links. */
export function extractLinks(bodyEl: Element | null): string[] {
  const out: string[] = [];
  if (!bodyEl) return out;
  let anchors: Element[] = [];
  try { anchors = Array.from(bodyEl.querySelectorAll("a[href]")); } catch { return out; }
  for (const a of anchors) {
    let href = "";
    try { href = (a.getAttribute("href") || "").trim(); } catch { continue; }
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    if (!/^https?:\/\//i.test(href)) continue;
    let host = "";
    try { host = new URL(href).hostname.toLowerCase(); } catch { continue; }
    if (/(^|\.)mail\.google\.com$/.test(host) || /(^|\.)outlook\.(live|office|office365)\.com$/.test(host)) continue;
    if (!out.includes(href)) out.push(href);
  }
  return out;
}

export function messageKey(msg: Message): string {
  const s = `${msg.senderAddress ?? ""}|${msg.senderName ?? ""}|${msg.subject ?? ""}|${(msg.body ?? "").slice(0, 200)}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function innerTextOf(el: Element | null): string {
  if (!el) return "";
  try {
    const t = (el as HTMLElement).innerText;
    if (typeof t === "string" && t.trim()) return t;
  } catch { /* fall through */ }
  try { return el.textContent ?? ""; } catch { return ""; }
}

export function backendFootnote(res: AnalyzeResponse): string {
  const by = res.backend.startsWith("llm:")
    ? `by ${res.backend.replace(/^llm:(ollama\/)?/, "")}${res.backend.includes("ollama") ? " via Ollama" : ""}`
    : "by the rules engine";
  return `Checked on your computer ${by} in ${res.ms} ms`;
}

export interface RenderArgs {
  /** The element that represents one message; gets the processed marker. */
  container: Element;
  /** The message body element; the banner goes right above it. */
  bodyEl: Element;
  message: Message;
  source: Source;
  settings: Settings | null;
  /** Insert the banner before this element instead of before bodyEl (e.g. Gmail's `.ii`). */
  anchor?: Element | null;
}

function removeExistingBanner(container: Element): void {
  try {
    for (const old of Array.from(container.querySelectorAll('[data-impersonation-guard="banner"]'))) old.remove();
  } catch { /* ignore */ }
}

/** Analyze one message and render its banner. Idempotent per message key. */
export async function analyzeAndRender(args: RenderArgs): Promise<AnalyzeResponse | null> {
  const { container, bodyEl, message, source, settings } = args;
  const key = messageKey(message);
  try {
    if (container.getAttribute(ATTR_KEY) === key && container.getAttribute(ATTR_STATE) !== "error") return null;
    container.setAttribute(ATTR_KEY, key);
    container.setAttribute(ATTR_STATE, "pending");
  } catch { return null; }

  let res: AnalyzeResponse;
  try {
    res = await send<AnalyzeResponse>({ type: "analyze", message, source });
  } catch (e) {
    debug("analyze failed", e);
    try { container.setAttribute(ATTR_STATE, "error"); } catch { /* ignore */ }
    return null;
  }
  // The container may have been re-rendered for a different message while we waited.
  try { if (container.getAttribute(ATTR_KEY) !== key) return res; } catch { return res; }

  removeExistingBanner(container);
  const showOk = settings ? settings.showOkBadge : true;
  if (res.explanation.level === "ok" && !showOk) {
    try { container.setAttribute(ATTR_STATE, "done"); } catch { /* ignore */ }
    return res;
  }
  try {
    const panel = createPanel(
      { ...res.explanation, backend: res.backend, ms: res.ms, footnote: backendFootnote(res) },
      { mode: "banner", onClose: () => { try { panel.remove(); } catch { /* ignore */ } } },
    );
    const target = args.anchor && args.anchor.parentElement ? args.anchor : bodyEl;
    const parent = target.parentElement;
    if (parent) parent.insertBefore(panel, target);
    else bodyEl.prepend(panel);
    container.setAttribute(ATTR_STATE, "done");
  } catch (e) {
    debug("render failed", e);
    try { container.setAttribute(ATTR_STATE, "error"); } catch { /* ignore */ }
  }
  return res;
}

let settingsPromise: Promise<Settings | null> | null = null;

/** Settings, fetched once per page; null when the service worker is unreachable. */
export function loadSettings(): Promise<Settings | null> {
  if (!settingsPromise) {
    settingsPromise = send<Settings>({ type: "getSettings" }).catch((e) => { debug("getSettings failed", e); return null; });
  }
  return settingsPromise;
}

/** Observe the document for changes and call `fn` (throttled). Returns a disconnect function. */
export function observe(fn: () => void, ms = 300): () => void {
  const run = throttle(fn, ms);
  let mo: MutationObserver | null = null;
  try {
    mo = new MutationObserver(run);
    mo.observe(document.documentElement || document, { childList: true, subtree: true, characterData: false });
  } catch (e) { debug("observer failed", e); }
  return () => { try { mo?.disconnect(); } catch { /* ignore */ } };
}

/** Parse `Name <email>` or a bare address from text. */
export function parseNameAddress(text: string): { name: string; address: string } | null {
  const t = (text || "").replace(/\s+/g, " ").trim();
  const m = /^(?:"?([^"<]*?)"?\s*)?<?([^\s<>"]+@[^\s<>"]+)>?$/.exec(t);
  if (m) return { name: (m[1] || "").trim(), address: m[2].trim() };
  const inside = /([^\s<>"]+@[^\s<>"]+)/.exec(t);
  if (inside) return { name: t.replace(inside[0], "").replace(/[<>"]/g, "").trim(), address: inside[1] };
  return null;
}
