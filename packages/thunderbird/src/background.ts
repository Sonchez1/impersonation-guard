/** Background page: owns settings and the flagged-host list, registers the message-display
 *  script, and answers its analyze requests. Reuses the extension's shared analysis core and
 *  settings shape verbatim. Nothing here talks to any server except, when the person opts in,
 *  their own local Ollama. */

import { createCore, type Flag } from "../../extension/src/shared/core";
import { DEFAULT_SETTINGS, type Settings } from "../../extension/src/shared/protocol";
import { toMessage } from "./message";
import type { MessageHeader, MessageList, MessageSender } from "./thunderbird";

async function getSettings(): Promise<Settings> {
  const stored = (await messenger.storage.local.get("settings")).settings as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}), ollama: { ...DEFAULT_SETTINGS.ollama, ...(stored?.ollama ?? {}) } };
}

async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings();
  const next: Settings = { ...cur, ...patch, ollama: { ...cur.ollama, ...(patch.ollama ?? {}) } };
  await messenger.storage.local.set({ settings: next });
  return next;
}

const core = createCore({
  getSettings,
  getFlags: async () => ((await messenger.storage.local.get("flags")).flags as Record<string, Flag>) ?? {},
  setFlags: async (flags) => { await messenger.storage.local.set({ flags }); },
});

/** The requests the message-display script and the options page send us. */
type TbRequest =
  | { type: "analyzeDisplayed" }
  | { type: "getSettings" }
  | { type: "setSettings"; settings: Partial<Settings> }
  | { type: "addOwnDomain"; domain: string }
  | { type: "ping" };

function headersOf(list: MessageList | MessageHeader[]): MessageHeader[] {
  if (Array.isArray(list)) return list;
  return list?.messages ?? [];
}

export async function handle(req: TbRequest, sender: MessageSender): Promise<unknown> {
  switch (req.type) {
    case "ping":
      return { ok: true };
    case "getSettings":
      return getSettings();
    case "setSettings":
      return setSettings(req.settings);
    case "addOwnDomain": {
      const s = await getSettings();
      const d = req.domain.toLowerCase();
      if (d && !s.ownDomains.includes(d)) await setSettings({ ownDomains: [...s.ownDomains, d] });
      return { ok: true };
    }
    case "analyzeDisplayed": {
      const tabId = sender.tab?.id;
      if (tabId == null) return { error: "no tab for this message-display script" };
      const headers = headersOf(await messenger.messageDisplay.getDisplayedMessages(tabId));
      if (!headers.length) return { empty: true };
      const header = headers[0];
      const full = await messenger.messages.getFull(header.id);
      const message = toMessage(header, full);
      const res = await core.analyze(message, "thunderbird");
      const s = await getSettings();
      return { ...res, showOkBadge: s.showOkBadge };
    }
    default:
      return { error: "unknown request" };
  }
}

function start(): void {
  messenger.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handle(message as TbRequest, sender)
      .then((r) => sendResponse(r))
      .catch((e: unknown) => sendResponse({ error: (e as Error).message }));
    return true; // keep the channel open for the async reply
  });

  // Put the banner on every message the user opens. Registered scripts apply to newly
  // displayed messages; the script pulls its verdict from us as soon as it loads.
  messenger.messageDisplayScripts
    .register({ js: [{ file: "message-display.js" }], runAt: "document_end" })
    .catch((e: unknown) => console.error("[impersonation-guard] could not register display script:", e));

  messenger.runtime.onInstalled.addListener(async () => {
    await messenger.storage.local.set({ settings: await getSettings() });
  });
}

if (typeof messenger !== "undefined" && !(globalThis as { __guardNoStart?: boolean }).__guardNoStart) start();
