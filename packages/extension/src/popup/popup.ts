/** The popup: paste a message or drop a screenshot, get a verdict with the evidence. */

import type { Message } from "@impersonation-guard/engine";
import { send, type AnalyzeResponse } from "../shared/protocol";
import { createPanel } from "../ui/panel";

interface Draft { body: string; senderName: string; senderAddress: string; subject: string }

const hasChrome = typeof chrome !== "undefined" && !!chrome.runtime;

async function loadDraft(): Promise<Draft | null> {
  if (!hasChrome || !chrome.storage?.local) return null;
  try { return ((await chrome.storage.local.get("draft")).draft as Draft) ?? null; } catch { return null; }
}

async function saveDraft(d: Draft): Promise<void> {
  if (!hasChrome || !chrome.storage?.local) return;
  try { await chrome.storage.local.set({ draft: d }); } catch { /* ignore */ }
}

/** State a test can await: the promise of the most recent check. */
export const state: { lastRun: Promise<AnalyzeResponse | null> | null } = { lastRun: null };

export function initPopup(doc: Document = document): void {
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const body = $<HTMLTextAreaElement>("body");
  const senderName = $<HTMLInputElement>("senderName");
  const senderAddress = $<HTMLInputElement>("senderAddress");
  const subject = $<HTMLInputElement>("subject");
  const check = $<HTMLButtonElement>("check");
  const clear = $<HTMLButtonElement>("clear");
  const status = $<HTMLElement>("status");
  const result = $<HTMLElement>("result");
  const drop = $<HTMLElement>("drop");
  const file = $<HTMLInputElement>("file");
  const ocrStatus = $<HTMLElement>("ocr-status");
  const settings = $<HTMLAnchorElement>("settings");

  settings.addEventListener("click", (e) => {
    e.preventDefault();
    if (hasChrome && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  });

  const draft = (): Draft => ({ body: body.value, senderName: senderName.value, senderAddress: senderAddress.value, subject: subject.value });
  for (const el of [body, senderName, senderAddress, subject]) el.addEventListener("input", () => { void saveDraft(draft()); });

  void loadDraft().then((d) => {
    if (!d) return;
    body.value = d.body ?? ""; senderName.value = d.senderName ?? ""; senderAddress.value = d.senderAddress ?? ""; subject.value = d.subject ?? "";
  });

  function showError(text: string): void {
    result.replaceChildren();
    const div = doc.createElement("div");
    div.className = "error";
    div.textContent = text;
    result.appendChild(div);
  }

  function describeBackend(res: AnalyzeResponse): string {
    const b = res.backend ?? "rule";
    const engine = b === "rule" ? "rules engine" : b.startsWith("llm:ollama/") ? `${b.slice("llm:ollama/".length)} via Ollama` : b;
    return `Checked on your computer in ${res.ms} ms · ${engine}`;
  }

  async function runCheck(): Promise<AnalyzeResponse | null> {
    const text = body.value.trim();
    if (!text) { showError("Paste a message or drop a screenshot first."); return null; }
    check.disabled = true;
    status.textContent = "Checking…";
    try {
      const message: Message = { body: text, senderName: senderName.value.trim(), senderAddress: senderAddress.value.trim(), subject: subject.value.trim() };
      const res = await send<AnalyzeResponse>({ type: "analyze", message, source: "popup" });
      const panel = createPanel(
        { level: res.explanation.level, headline: res.explanation.headline, items: res.explanation.items, safeStep: res.explanation.safeStep, footnote: describeBackend(res) },
        { mode: "card" },
      );
      result.replaceChildren(panel);
      status.textContent = "";
      return res;
    } catch (e) {
      showError(`Could not check this message: ${(e as Error).message}`);
      status.textContent = "";
      return null;
    } finally {
      check.disabled = false;
    }
  }

  check.addEventListener("click", () => { state.lastRun = runCheck(); });
  body.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { state.lastRun = runCheck(); } });
  clear.addEventListener("click", () => {
    body.value = ""; senderName.value = ""; senderAddress.value = ""; subject.value = "";
    result.replaceChildren(); status.textContent = "";
    void saveDraft(draft());
  });

  // ---- screenshots -----------------------------------------------------------------
  async function handleImage(blob: Blob): Promise<void> {
    ocrStatus.hidden = false;
    ocrStatus.textContent = "Reading the screenshot on your computer…";
    try {
      const { recognize } = await import("./ocr");
      const text = await recognize(blob, (s, p) => {
        if (s === "recognizing text") ocrStatus.textContent = `Reading… ${Math.round(p * 100)}%`;
        else if (s) ocrStatus.textContent = `${s[0].toUpperCase()}${s.slice(1)}…`;
      });
      if (!text) { ocrStatus.textContent = "No text found in that image."; return; }
      body.value = body.value.trim() ? `${body.value.trim()}\n${text}` : text;
      void saveDraft(draft());
      ocrStatus.textContent = "Text added from the screenshot.";
      state.lastRun = runCheck();
    } catch (e) {
      ocrStatus.textContent = `Screenshot reading is unavailable in this build (${(e as Error).message}). Paste the text instead.`;
    }
  }

  drop.addEventListener("click", () => file.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
  file.addEventListener("change", () => { const f = file.files?.[0]; if (f) void handleImage(f); file.value = ""; });
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => {
    const f = [...((e as DragEvent).dataTransfer?.files ?? [])].find((x) => x.type.startsWith("image/"));
    if (f) void handleImage(f);
  });
  doc.addEventListener("paste", (e) => {
    const items = [...((e as ClipboardEvent).clipboardData?.items ?? [])];
    const img = items.find((i) => i.type.startsWith("image/"));
    if (!img) return; // text pastes go to the textarea as usual
    const blob = img.getAsFile();
    if (blob) { e.preventDefault(); void handleImage(blob); }
  });
}

if (typeof document !== "undefined" && !(globalThis as { __guardNoAuto?: boolean }).__guardNoAuto) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initPopup());
  else initPopup();
}
