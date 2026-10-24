/** Service worker: owns settings and the flagged-host list, and routes requests to the
 *  shared core. Nothing here talks to any server except, when the person opts in, their
 *  own local Ollama. */

import { createCore, type Flag } from "./shared/core";
import { DEFAULT_SETTINGS, type Request, type Settings } from "./shared/protocol";

async function getSettings(): Promise<Settings> {
  const stored = (await chrome.storage.sync.get("settings")).settings as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}), ollama: { ...DEFAULT_SETTINGS.ollama, ...(stored?.ollama ?? {}) } };
}

async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings();
  const next: Settings = { ...cur, ...patch, ollama: { ...cur.ollama, ...(patch.ollama ?? {}) } };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

const core = createCore({
  getSettings,
  getFlags: async () => ((await chrome.storage.session.get("flags")).flags as Record<string, Flag>) ?? {},
  setFlags: async (flags) => { await chrome.storage.session.set({ flags }); },
});

chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  (async () => {
    try {
      switch (req.type) {
        case "ping": return sendResponse({ ok: true });
        case "getSettings": return sendResponse(await getSettings());
        case "setSettings": return sendResponse(await setSettings(req.settings));
        case "addOwnDomain": {
          const s = await getSettings();
          const d = req.domain.toLowerCase();
          if (d && !s.ownDomains.includes(d)) await setSettings({ ownDomains: [...s.ownDomains, d] });
          return sendResponse({ ok: true });
        }
        case "analyze": return sendResponse(await core.analyze(req.message, req.source));
        case "checkPage": return sendResponse(await core.checkPage(req));
        default: return sendResponse({ error: "unknown request" });
      }
    } catch (e) {
      sendResponse({ error: (e as Error).message });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.set({ settings: await getSettings() });
});
