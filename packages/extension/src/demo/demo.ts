/** Demo bundle: runs the whole guard inside a plain page, with the analysis core in-page
 *  instead of a service worker, so the inbox banner and the form interrupt can be seen and
 *  tested without installing the extension. Loaded only by fixtures/demo-*.html. */

import { createCore, type Flag } from "../shared/core";
import { DEFAULT_SETTINGS, type Request, type Response, type Settings } from "../shared/protocol";

const meta = document.querySelector<HTMLMetaElement>('meta[name="guard-protected"]')?.content ?? "";
const settings: Settings = {
  ...DEFAULT_SETTINGS,
  protected: meta.split(",").map((s) => s.trim()).filter(Boolean),
};
let flags: Record<string, Flag> = {};
try {
  // Flags survive a navigation from the demo inbox to the demo login page.
  flags = JSON.parse(sessionStorage.getItem("guard-demo-flags") ?? "{}");
} catch { flags = {}; }

const core = createCore({
  getSettings: async () => settings,
  getFlags: async () => flags,
  setFlags: async (f) => { flags = f; try { sessionStorage.setItem("guard-demo-flags", JSON.stringify(f)); } catch { /* ignore */ } },
});

async function transport(req: Request): Promise<Response> {
  switch (req.type) {
    case "ping": return { ok: true };
    case "getSettings": return settings;
    case "setSettings": Object.assign(settings, req.settings); return settings;
    case "addOwnDomain": if (!settings.ownDomains.includes(req.domain)) settings.ownDomains.push(req.domain); return { ok: true };
    case "analyze": return core.analyze(req.message, req.source);
    case "checkPage": return core.checkPage(req);
    default: return { error: "unknown request" };
  }
}

const g = globalThis as unknown as { __guardTransport?: typeof transport; __guardCore?: typeof core; __guardSettings?: Settings };
g.__guardTransport = transport;
g.__guardCore = core;
g.__guardSettings = settings;

(async () => {
  await import("../content/gmail");
  await import("../content/forms");
})();
