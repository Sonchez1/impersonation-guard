/** Settings page: the protected list, learned own domains, behaviour toggles, optional local model. */

import { BRANDS } from "../shared/protected";
import { DEFAULT_SETTINGS, send, type Settings } from "../shared/protocol";

export async function initOptions(doc: Document = document): Promise<void> {
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const protectedBox = $<HTMLTextAreaElement>("protected");
  const own = $<HTMLUListElement>("own");
  const showOkBadge = $<HTMLInputElement>("showOkBadge");
  const interruptEverywhere = $<HTMLInputElement>("interruptEverywhere");
  const useBundledBrands = $<HTMLInputElement>("useBundledBrands");
  const ollamaEnabled = $<HTMLInputElement>("ollamaEnabled");
  const ollamaHost = $<HTMLInputElement>("ollamaHost");
  const ollamaModel = $<HTMLInputElement>("ollamaModel");
  const testOllama = $<HTMLButtonElement>("testOllama");
  const ollamaResult = $<HTMLElement>("ollamaResult");
  const brands = $<HTMLUListElement>("brands");
  const save = $<HTMLButtonElement>("save");
  const saved = $<HTMLElement>("saved");

  let settings: Settings = { ...DEFAULT_SETTINGS };
  let ownDomains: string[] = [];

  function renderOwn(): void {
    own.replaceChildren();
    if (!ownDomains.length) {
      const li = doc.createElement("li"); li.className = "empty"; li.textContent = "None learned yet. They are added when you open your inbox.";
      own.appendChild(li); return;
    }
    for (const d of ownDomains) {
      const li = doc.createElement("li");
      li.appendChild(doc.createTextNode(d));
      const rm = doc.createElement("button"); rm.type = "button"; rm.textContent = "×"; rm.title = `Remove ${d}`;
      rm.addEventListener("click", () => { ownDomains = ownDomains.filter((x) => x !== d); renderOwn(); });
      li.appendChild(rm);
      own.appendChild(li);
    }
  }

  function fill(s: Settings): void {
    settings = s;
    protectedBox.value = s.protected.join("\n");
    ownDomains = [...s.ownDomains];
    renderOwn();
    showOkBadge.checked = s.showOkBadge;
    interruptEverywhere.checked = s.interruptEverywhere;
    useBundledBrands.checked = s.useBundledBrands;
    ollamaEnabled.checked = s.ollama.enabled;
    ollamaHost.value = s.ollama.host;
    ollamaModel.value = s.ollama.model;
  }

  brands.replaceChildren(...BRANDS.map((b) => { const li = doc.createElement("li"); li.textContent = b.name; return li; }));

  try {
    fill(await send<Settings>({ type: "getSettings" }));
  } catch (e) {
    fill({ ...DEFAULT_SETTINGS });
    saved.textContent = `Could not load settings: ${(e as Error).message}`; saved.className = "status err";
  }

  testOllama.addEventListener("click", async () => {
    const host = ollamaHost.value.trim().replace(/\/+$/, "") || DEFAULT_SETTINGS.ollama.host;
    ollamaResult.textContent = "Connecting…"; ollamaResult.className = "status";
    try {
      const resp = await fetch(`${host}/api/tags`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { models?: { name: string }[] };
      const names = (data.models ?? []).map((m) => m.name);
      ollamaResult.textContent = names.length ? `Connected. Models: ${names.join(", ")}` : "Connected, but no models are installed (run: ollama pull llama3.1:8b).";
      ollamaResult.className = "status ok";
    } catch (e) {
      ollamaResult.textContent = `Cannot reach Ollama at ${host}: ${(e as Error).message}. Is it running with OLLAMA_ORIGINS=chrome-extension://*?`;
      ollamaResult.className = "status err";
    }
  });

  save.addEventListener("click", async () => {
    const patch: Partial<Settings> = {
      protected: protectedBox.value.split("\n").map((l) => l.trim()).filter(Boolean),
      ownDomains,
      showOkBadge: showOkBadge.checked,
      interruptEverywhere: interruptEverywhere.checked,
      useBundledBrands: useBundledBrands.checked,
      ollama: { enabled: ollamaEnabled.checked, host: ollamaHost.value.trim() || DEFAULT_SETTINGS.ollama.host, model: ollamaModel.value.trim() || DEFAULT_SETTINGS.ollama.model },
    };
    try {
      fill(await send<Settings>({ type: "setSettings", settings: patch }));
      saved.textContent = "Saved."; saved.className = "status ok";
      setTimeout(() => { if (saved.textContent === "Saved.") saved.textContent = ""; }, 2500);
    } catch (e) {
      saved.textContent = `Could not save: ${(e as Error).message}`; saved.className = "status err";
    }
  });
}

if (typeof document !== "undefined" && !(globalThis as { __guardNoAuto?: boolean }).__guardNoAuto) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { void initOptions(); });
  else void initOptions();
}
