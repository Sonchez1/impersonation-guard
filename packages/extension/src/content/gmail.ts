/** Gmail content script: find every open message in the conversation view, analyze it once,
 *  and put a banner above its body. Also works on any page that uses Gmail's class names
 *  (the demo page), so nothing here is gated on the hostname. */

import { FREE_MAIL, registrable, type Message } from "@impersonation-guard/engine";
import { send } from "../shared/protocol";
import { analyzeAndRender, debug, extractLinks, innerTextOf, loadSettings, observe } from "./inbox-common";

const CONTAINER_SEL = "div.adn, div[data-message-id], div[data-legacy-message-id]";

function messageId(container: Element): string {
  return (
    container.getAttribute("data-message-id") ||
    container.getAttribute("data-legacy-message-id") ||
    container.querySelector("[data-message-id]")?.getAttribute("data-message-id") ||
    container.querySelector("[data-legacy-message-id]")?.getAttribute("data-legacy-message-id") ||
    ""
  );
}

function senderOf(container: Element): { name: string; address: string } {
  const el = container.querySelector("span.gD") || container.querySelector("[email]");
  if (!el) return { name: "", address: "" };
  const address = (el.getAttribute("email") || "").trim();
  const name = (el.getAttribute("name") || el.textContent || "").trim();
  return { name: name === address ? "" : name, address };
}

function subjectOf(container: Element): string {
  const own = container.querySelector("h2.hP");
  if (own) return innerTextOf(own).trim();
  // Subject lives at thread level; prefer the closest conversation wrapper's heading.
  let node: Element | null = container;
  while (node) {
    const h = node.querySelector("h2.hP");
    if (h) return innerTextOf(h).trim();
    node = node.parentElement;
  }
  return innerTextOf(document.querySelector("h2.hP")).trim();
}

function bodyOf(container: Element): Element | null {
  return container.querySelector("div.a3s") || container.querySelector("[data-guard-body]");
}

/** Extract a message from one Gmail message container; null when it is not open/rendered. */
export function extractGmailMessage(container: Element): { message: Message; bodyEl: Element; anchor: Element | null } | null {
  try {
    const bodyEl = bodyOf(container);
    if (!bodyEl) return null;
    const body = innerTextOf(bodyEl).trim();
    if (!body) return null;
    const { name, address } = senderOf(container);
    const message: Message = {
      body, senderName: name, senderAddress: address, subject: subjectOf(container), links: extractLinks(bodyEl),
    };
    const ii = bodyEl.closest("div.ii");
    return { message, bodyEl, anchor: ii && container.contains(ii) ? ii : null };
  } catch (e) {
    debug("extract failed", e);
    return null;
  }
}

/** Scan a root for open messages and analyze each once. Safe to call repeatedly. */
export async function scanGmail(root: ParentNode = document): Promise<void> {
  let containers: Element[] = [];
  try { containers = Array.from(root.querySelectorAll(CONTAINER_SEL)); } catch { return; }
  // Nested matches (a data-message-id inside .adn) must count once: keep outermost.
  containers = containers.filter((c) => !containers.some((o) => o !== c && o.contains(c)));
  if (!containers.length) return;
  const settings = await loadSettings();
  await Promise.all(containers.map(async (container) => {
    const ex = extractGmailMessage(container);
    if (!ex) return;
    const id = messageId(container);
    if (id) { try { container.setAttribute("data-guard-message-id", id); } catch { /* ignore */ } }
    await analyzeAndRender({ container, bodyEl: ex.bodyEl, anchor: ex.anchor, message: ex.message, source: "gmail", settings });
  }));
}

let ownDomainSent = false;

/** Learn the signed-in account's domain so lookalikes of it are caught too. */
export function learnOwnDomain(root: ParentNode = document): void {
  if (ownDomainSent) return;
  try {
    const candidates: string[] = [];
    for (const el of Array.from(root.querySelectorAll('a[aria-label*="Google Account"], a[aria-label*="@"], [data-email], [title*="@"]'))) {
      for (const v of [el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("data-email")]) if (v) candidates.push(v);
    }
    for (const text of candidates) {
      const m = /([A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,}))/.exec(text);
      if (!m) continue;
      const domain = registrable(m[2].toLowerCase());
      if (!domain || FREE_MAIL.has(domain)) { ownDomainSent = true; return; }
      ownDomainSent = true;
      send({ type: "addOwnDomain", domain }).catch((e) => debug("addOwnDomain failed", e));
      return;
    }
  } catch (e) { debug("learnOwnDomain failed", e); }
}

function start(): void {
  if (typeof document === "undefined") return;
  const run = () => { learnOwnDomain(); void scanGmail(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
  observe(run, 300);
}

if (typeof document !== "undefined" && !(globalThis as { __guardNoAutostart?: boolean }).__guardNoAutostart) start();
