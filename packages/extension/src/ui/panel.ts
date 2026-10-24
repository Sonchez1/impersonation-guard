/** One renderer for every surface: inbox banner, page interrupt, popup result. Renders into
 *  a shadow root so host-page styles cannot touch it and ours cannot leak out. */

import type { Level } from "../shared/protocol";
import { LEVEL_LABEL } from "../shared/protocol";

export interface PanelItem { text: string; evidence?: string; detail: string; severity?: "high" | "medium" | "low" }

export interface PanelData {
  level: Level;
  headline: string;
  items: PanelItem[];
  safeStep: string;
  backend?: string;
  ms?: number;
  /** Shown under the headline when present (e.g. "Checked by the rules engine, 12 ms"). */
  footnote?: string;
}

export interface PanelOptions {
  /** "banner" sits above a message; "interrupt" fills the viewport; "card" is the popup. */
  mode: "banner" | "interrupt" | "card";
  onClose?: () => void;
  /** Interrupt only: the person insists on continuing. */
  onContinue?: () => void;
  /** Interrupt only: leave the page. */
  onLeave?: () => void;
}

export const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.g { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111827; }
.g.banner { margin: 8px 0 12px; border-radius: 10px; border: 1px solid; padding: 12px 14px; }
.g.card { padding: 14px; }
.g.interrupt { position: fixed; inset: 0; z-index: 2147483647; background: rgba(17,24,39,.72); display: flex; align-items: center; justify-content: center; padding: 24px; }
.g.interrupt .box { background: #fff; border-radius: 14px; max-width: 560px; width: 100%; padding: 22px 24px; box-shadow: 0 20px 60px rgba(0,0,0,.35); border-top: 6px solid; }
.lvl-ok { border-color: #10b981; background: #ecfdf5; }
.lvl-caution { border-color: #f59e0b; background: #fffbeb; }
.lvl-likely_scam { border-color: #f97316; background: #fff7ed; }
.lvl-scam { border-color: #dc2626; background: #fef2f2; }
.g.interrupt .box.lvl-ok, .g.interrupt .box.lvl-caution, .g.interrupt .box.lvl-likely_scam, .g.interrupt .box.lvl-scam { background: #fff; }
.head { display: flex; align-items: flex-start; gap: 10px; }
.chip { flex: none; font-weight: 700; font-size: 12px; letter-spacing: .02em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; color: #fff; }
.chip.ok { background: #059669; } .chip.caution { background: #d97706; } .chip.likely_scam { background: #ea580c; } .chip.scam { background: #dc2626; }
.headline { font-weight: 600; font-size: 15px; margin: 0; }
.g.interrupt .headline { font-size: 19px; }
.foot { color: #6b7280; font-size: 12px; margin-top: 2px; }
.items { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; }
.items li { display: grid; grid-template-columns: 8px 1fr; gap: 10px; align-items: start; }
.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 7px; background: #9ca3af; }
.dot.high { background: #dc2626; } .dot.medium { background: #f59e0b; } .dot.low { background: #6b7280; }
.ev { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; background: rgba(17,24,39,.06); padding: 1px 5px; border-radius: 4px; word-break: break-all; }
.detail { display: none; color: #6b7280; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.g.show-detail .detail { display: block; }
.safe { margin: 12px 0 0; padding: 10px 12px; border-radius: 8px; background: rgba(17,24,39,.05); font-size: 13.5px; }
.actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; align-items: center; }
button { font: inherit; font-size: 13px; border-radius: 8px; padding: 7px 12px; cursor: pointer; border: 1px solid #d1d5db; background: #fff; color: #111827; }
button.primary { background: #111827; color: #fff; border-color: #111827; }
button.danger { background: #fff; color: #991b1b; border-color: #fca5a5; }
button.link { border: none; background: none; color: #374151; text-decoration: underline; padding: 4px 2px; }
.spacer { flex: 1; }
.close { border: none; background: none; font-size: 18px; line-height: 1; color: #6b7280; cursor: pointer; padding: 0 2px; }
.brand { color: #6b7280; font-size: 11.5px; margin-top: 10px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Build the panel. Returns the host element to insert; the content lives in its shadow root. */
export function createPanel(data: PanelData, opts: PanelOptions): HTMLElement {
  const host = el("div");
  host.setAttribute("data-impersonation-guard", opts.mode);
  const shadow = host.attachShadow({ mode: "open" });
  const style = el("style"); style.textContent = PANEL_CSS; shadow.appendChild(style);

  const g = el("div", `g ${opts.mode}`);
  const box = opts.mode === "interrupt" ? el("div", `box lvl-${data.level}`) : g;
  if (opts.mode !== "interrupt") g.classList.add(`lvl-${data.level}`);

  const head = el("div", "head");
  head.appendChild(el("span", `chip ${data.level}`, LEVEL_LABEL[data.level]));
  const hwrap = el("div");
  hwrap.style.flex = "1";
  hwrap.appendChild(el("p", "headline", data.headline));
  if (data.footnote) hwrap.appendChild(el("div", "foot", data.footnote));
  head.appendChild(hwrap);
  if (opts.onClose && opts.mode !== "interrupt") {
    const x = el("button", "close", "×"); x.title = "Dismiss"; x.onclick = () => opts.onClose!();
    head.appendChild(x);
  }
  box.appendChild(head);

  if (data.items.length) {
    const ul = el("ul", "items");
    for (const it of data.items) {
      const li = el("li");
      li.appendChild(el("span", `dot ${it.severity ?? "medium"}`));
      const body = el("div");
      const p = el("div");
      p.appendChild(document.createTextNode(it.text));
      if (it.evidence && !it.text.includes(it.evidence)) {
        p.appendChild(document.createTextNode(" "));
        p.appendChild(el("span", "ev", it.evidence));
      }
      body.appendChild(p);
      body.appendChild(el("div", "detail", it.detail));
      li.appendChild(body);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }
  if (data.level !== "ok" || opts.mode === "card") box.appendChild(el("div", "safe", data.safeStep));

  const actions = el("div", "actions");
  if (opts.mode === "interrupt") {
    const leave = el("button", "primary", "Close this page"); leave.onclick = () => opts.onLeave?.();
    const cont = el("button", "danger", "I understand the risk, continue"); cont.onclick = () => opts.onContinue?.();
    actions.appendChild(leave); actions.appendChild(cont);
  }
  if (data.items.length) {
    actions.appendChild(el("span", "spacer"));
    const det = el("button", "link", "Show technical detail");
    det.onclick = () => { g.classList.toggle("show-detail"); det.textContent = g.classList.contains("show-detail") ? "Hide technical detail" : "Show technical detail"; };
    actions.appendChild(det);
  }
  if (actions.childElementCount) box.appendChild(actions);
  box.appendChild(el("div", "brand", "Impersonation Guard · checked on your computer, nothing was sent anywhere"));

  if (opts.mode === "interrupt") g.appendChild(box);
  shadow.appendChild(g);
  return host;
}
