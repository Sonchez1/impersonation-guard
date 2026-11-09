/** Turn a Thunderbird message (its MessageHeader plus the MessagePart tree from
 *  messages.getFull) into the engine's Message shape: sender name/address, subject, body
 *  text and real link hosts. Pure functions over data the WebExtension API hands us, so the
 *  whole extraction is unit-testable without Thunderbird. */

import type { Message } from "@impersonation-guard/engine";
import type { MessageHeader, MessagePart } from "./thunderbird";

/** Split "Display Name <address@host>" (or a bare address) into name and address. */
export function parseAuthor(author: string): { name: string; address: string } {
  const t = (author || "").replace(/\s+/g, " ").trim();
  if (!t) return { name: "", address: "" };
  const angled = /^(?:"?([^"<]*?)"?\s*)?<\s*([^<>\s]+@[^<>\s]+)\s*>$/.exec(t);
  if (angled) return { name: (angled[1] || "").trim(), address: angled[2].trim() };
  const bare = /^([^<>\s]+@[^<>\s]+)$/.exec(t);
  if (bare) return { name: "", address: bare[1] };
  const inside = /([^<>\s]+@[^<>\s]+)/.exec(t);
  if (inside) return { name: t.replace(inside[0], "").replace(/[<>"]/g, "").trim(), address: inside[1] };
  return { name: t, address: "" };
}

/** Collect the decoded text/plain and text/html bodies from the MIME part tree. */
export function collectBodies(root: MessagePart): { plain: string[]; html: string[] } {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: MessagePart): void => {
    const ct = (part.contentType || "").toLowerCase();
    if (typeof part.body === "string" && part.body) {
      if (ct.startsWith("text/plain")) plain.push(part.body);
      else if (ct.startsWith("text/html")) html.push(part.body);
    }
    for (const p of part.parts ?? []) walk(p);
  };
  walk(root);
  return { plain, html };
}

/** Visible text and real http(s) link targets from an HTML body, parsed in a DOM. */
export function parseHtmlBody(html: string): { text: string; links: string[] } {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return { text: "", links: [] };
  }
  const body = doc.body;
  let text = "";
  if (body) {
    const inner = (body as HTMLElement).innerText;
    text = (typeof inner === "string" && inner.trim() ? inner : body.textContent || "").trim();
  }
  const links: string[] = [];
  let anchors: Element[] = [];
  try { anchors = Array.from(doc.querySelectorAll("a[href]")); } catch { anchors = []; }
  for (const a of anchors) {
    const href = (a.getAttribute("href") || "").trim();
    if (!/^https?:\/\//i.test(href)) continue;
    if (!links.includes(href)) links.push(href);
  }
  return { text, links };
}

/** Build the engine Message from a header and the full MIME part tree. */
export function toMessage(header: MessageHeader, full: MessagePart): Message {
  const { name, address } = parseAuthor(header.author ?? "");
  const { plain, html } = collectBodies(full);
  const plainText = plain.join("\n").trim();
  const parsed = html.map(parseHtmlBody);
  const htmlText = parsed.map((p) => p.text).filter(Boolean).join("\n").trim();
  const links: string[] = [];
  for (const p of parsed) for (const l of p.links) if (!links.includes(l)) links.push(l);
  const body = plainText || htmlText;
  return { body, senderName: name, senderAddress: address, subject: header.subject ?? "", links };
}
