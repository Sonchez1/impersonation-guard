/** Outlook on the web content script (outlook.live.com, outlook.office.com): best effort.
 *  Outlook's DOM is generated and unstable, so several selectors are tried for each part
 *  and the message is keyed by content, not by any id. */

import type { Message } from "@impersonation-guard/engine";
import { analyzeAndRender, debug, extractLinks, innerTextOf, loadSettings, observe, parseNameAddress } from "./inbox-common";

const BODY_SELS = [
  '[aria-label="Message body"]',
  'div[role="document"]',
  ".ReadingPaneContent",
  '[data-app-section="ConversationContainer"] [role="document"]',
  '[data-app-section="ConversationContainer"]',
];

function readingPane(): Element | null {
  return document.querySelector('div[role="main"]') || document.body;
}

function bodiesIn(pane: Element): Element[] {
  for (const sel of BODY_SELS) {
    let found: Element[] = [];
    try { found = Array.from(pane.querySelectorAll(sel)); } catch { continue; }
    found = found.filter((el) => innerTextOf(el).trim().length > 0);
    if (found.length) return found.filter((c) => !found.some((o) => o !== c && o.contains(c)));
  }
  return [];
}

/** The message "card" around a body: walk up until we find a sender element or run out. */
function cardOf(bodyEl: Element, pane: Element): Element {
  let node: Element | null = bodyEl;
  for (let i = 0; i < 8 && node && node !== pane; i++) {
    if (node.querySelector('[title*="@"], button[aria-label*="@"], span[aria-label*="@"], [data-testid*="Sender"], [data-testid*="sender"]')) return node;
    node = node.parentElement;
  }
  return bodyEl.parentElement ?? bodyEl;
}

function senderOf(card: Element): { name: string; address: string } {
  const sels = ['[data-testid*="Sender"]', '[data-testid*="sender"]', 'button[aria-label*="@"]', 'span[aria-label*="@"]', '[title*="@"]', 'span[title*="@"]'];
  for (const sel of sels) {
    let els: Element[] = [];
    try { els = Array.from(card.querySelectorAll(sel)); } catch { continue; }
    for (const el of els) {
      for (const text of [el.getAttribute("aria-label"), el.getAttribute("title"), innerTextOf(el)]) {
        const p = text ? parseNameAddress(text) : null;
        if (p) {
          // A title that is only the address: take the visible text as the name.
          const name = p.name || innerTextOf(el).replace(p.address, "").replace(/[<>"]/g, "").trim();
          return { name: name === p.address ? "" : name, address: p.address };
        }
      }
    }
  }
  // Last resort: any "Name <email>" in the card's header text (first 400 chars).
  const p = parseNameAddress(innerTextOf(card).slice(0, 400));
  return p ?? { name: "", address: "" };
}

function subjectOf(card: Element, pane: Element): string {
  for (const scope of [card, pane]) {
    for (const sel of ['[role="heading"]', "h1", "h2"]) {
      const h = scope.querySelector(sel);
      const t = innerTextOf(h).trim();
      if (t) return t;
    }
  }
  return "";
}

export async function scanOutlook(): Promise<void> {
  const pane = readingPane();
  if (!pane) return;
  const bodies = bodiesIn(pane);
  if (!bodies.length) return;
  const settings = await loadSettings();
  await Promise.all(bodies.map(async (bodyEl) => {
    try {
      const card = cardOf(bodyEl, pane);
      const { name, address } = senderOf(card);
      const message: Message = {
        body: innerTextOf(bodyEl).trim(), senderName: name, senderAddress: address,
        subject: subjectOf(card, pane), links: extractLinks(bodyEl),
      };
      if (!message.body) return;
      await analyzeAndRender({ container: card, bodyEl, message, source: "outlook", settings });
    } catch (e) { debug("outlook scan failed", e); }
  }));
}

function start(): void {
  if (typeof document === "undefined") return;
  const run = () => { void scanOutlook(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
  observe(run, 400);
}

if (typeof document !== "undefined" && !(globalThis as { __guardNoAutostart?: boolean }).__guardNoAutostart) start();
