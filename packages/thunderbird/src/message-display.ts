/** Runs inside the displayed message. Asks the background to analyze the message currently
 *  shown in this tab, then puts the evidence banner at the top of the message, above its
 *  content. The panel renderer and the explanation are the same ones the Chrome extension
 *  uses, so the verdict and its wording are identical across both. */

import { createPanel } from "../../extension/src/ui/panel";
import type { AnalyzeResponse } from "../../extension/src/shared/protocol";

type DisplayResponse =
  | (AnalyzeResponse & { showOkBadge: boolean })
  | { error: string }
  | { empty: true }
  | undefined;

const BANNER_ATTR = "data-impersonation-guard";

function footnote(res: AnalyzeResponse): string {
  const by = res.backend.startsWith("llm:")
    ? `by ${res.backend.replace(/^llm:(ollama\/)?/, "")}${res.backend.includes("ollama") ? " via Ollama" : ""}`
    : "by the rules engine";
  return `Checked on your computer ${by} in ${res.ms} ms`;
}

function removeExistingBanner(doc: Document): void {
  try {
    for (const old of Array.from(doc.querySelectorAll(`[${BANNER_ATTR}="banner"]`))) old.remove();
  } catch { /* ignore */ }
}

/** Render the banner for one analyze response into `doc`; returns the inserted host, if any. */
export function renderBanner(resp: DisplayResponse, doc: Document = document): HTMLElement | null {
  if (!resp || "error" in resp || "empty" in resp) return null;
  removeExistingBanner(doc);
  if (resp.explanation.level === "ok" && !resp.showOkBadge) return null;
  const panel = createPanel(
    { ...resp.explanation, backend: resp.backend, ms: resp.ms, footnote: footnote(resp) },
    { mode: "banner", onClose: () => { try { panel.remove(); } catch { /* ignore */ } } },
  );
  const body = doc.body;
  if (!body) return null;
  body.insertBefore(panel, body.firstChild);
  return panel;
}

export async function run(doc: Document = document): Promise<HTMLElement | null> {
  let resp: DisplayResponse;
  try {
    resp = (await messenger.runtime.sendMessage({ type: "analyzeDisplayed" })) as DisplayResponse;
  } catch (e) {
    console.debug("[impersonation-guard] analyze request failed:", e);
    return null;
  }
  return renderBanner(resp, doc);
}

if (typeof messenger !== "undefined" && !(globalThis as { __guardNoRun?: boolean }).__guardNoRun) {
  void run();
}
