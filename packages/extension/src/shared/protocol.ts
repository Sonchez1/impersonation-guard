/** Messages between content scripts / popup / options and the background service worker. */

import type { Explanation, Message } from "@impersonation-guard/engine";

export type Level = "ok" | "caution" | "likely_scam" | "scam";

export interface Settings {
  /** Names and domains the person wants defended: their school, bank, employer, platforms. */
  protected: string[];
  /** Domains of the person's own accounts (their .edu, their employer), auto-added when seen. */
  ownDomains: string[];
  ollama: { enabled: boolean; host: string; model: string };
  /** Run the point-of-harm interrupt on every site (default) or only on flagged/lookalike hosts. */
  interruptEverywhere: boolean;
  /** Show a small "nothing suspicious" badge on clean messages too. */
  showOkBadge: boolean;
  /** Bundled brand list on/off. */
  useBundledBrands: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  protected: [],
  ownDomains: [],
  ollama: { enabled: false, host: "http://localhost:11434", model: "llama3.1:8b" },
  interruptEverywhere: true,
  showOkBadge: true,
  useBundledBrands: true,
};

/** Serializable subset of the engine Verdict. */
export interface VerdictLite {
  risk: number;
  action: "allow" | "warn" | "hold" | "block";
  reasons: string[];
  senderProbability: number | null;
  senderFeatures: Record<string, number>;
  linkScores: Record<string, number>;
  lookalikes: { candidate: string; protected: string; reasons: string[] }[];
  intent: { label: string; confidence: number; signals: string[]; rationale: string; backend: string } | null;
  hosts: string[];
  senderFacts: string[];
}

export type Source = "gmail" | "outlook" | "popup" | "page" | "demo";

export type Request =
  | { type: "analyze"; message: Message; source: Source; pageHost?: string }
  | { type: "checkPage"; host: string; href: string; referrer: string; title: string; brandText: string; fields: { password: boolean; otp: boolean } }
  | { type: "getSettings" }
  | { type: "setSettings"; settings: Partial<Settings> }
  | { type: "addOwnDomain"; domain: string }
  | { type: "ping" };

export interface AnalyzeResponse {
  verdict: VerdictLite;
  explanation: Explanation;
  protected: string[];
  backend: string;
  ms: number;
}

export interface CheckPageResponse {
  interrupt: boolean;
  level: Level;
  headline: string;
  items: { text: string; evidence?: string; detail: string }[];
  safeStep: string;
}

export type Response = AnalyzeResponse | CheckPageResponse | Settings | { ok: true } | { error: string };

export type Transport = (req: Request) => Promise<Response>;

/** A demo page or a test can install an in-page transport instead of the service worker. */
export function send<T extends Response>(req: Request): Promise<T> {
  const override = (globalThis as unknown as { __guardTransport?: Transport }).__guardTransport;
  if (override) return override(req) as Promise<T>;
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(req, (res: T | { error: string }) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (res && typeof res === "object" && "error" in res && !("verdict" in res)) return reject(new Error((res as { error: string }).error));
        resolve(res as T);
      });
    } catch (e) {
      reject(e);
    }
  });
}

export const LEVEL_LABEL: Record<Level, string> = {
  ok: "Looks OK",
  caution: "Be careful",
  likely_scam: "Likely a scam",
  scam: "Scam",
};
