import { describe, expect, it } from "vitest";
import { createCore, type Flag } from "../src/shared/core";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/protocol";

function core(settings: Partial<Settings> = {}) {
  let flags: Record<string, Flag> = {};
  return createCore({
    getSettings: async () => ({ ...DEFAULT_SETTINGS, ...settings }),
    getFlags: async () => flags,
    setFlags: async (f) => { flags = f; },
  });
}

/** Consumer-mode behaviour on ordinary inbox mail. */
describe("consumer mode on real inbox mail", () => {
  it("monitoring digest linking to an employer's internal brand-affixed domain is caution, not scam", async () => {
    const r = await core({ protected: ["acmecorp.com", "Acme Corp"] }).analyze({
      body: "The Daily Digest for Acme Corp. Here's what happened in monitoring on October 22. Metric Alerts: 78 total events, 78 alerts triggered. [P4] [Triggered] Internal service rollout failure rate https://argocd.acmecorp-internal.com/applications/foo https://app.monitoringvendor.com/monitors/123",
      senderName: "Monitoring", senderAddress: "no-reply@monitoringvendor.com", subject: "Your daily monitoring digest",
      links: ["https://argocd.acmecorp-internal.com/applications/foo", "https://app.monitoringvendor.com/monitors/123"],
    }, "test");
    expect(r.verdict.action).toBe("warn");
    expect(r.explanation.level).toBe("caution");
    expect(r.explanation.items.map((i) => i.kind)).not.toContain("deceptive_link");
    expect(r.explanation.safeStep).toContain("Settings");
  });

  it("LinkedIn jobs digest from a subdomain of the real domain is OK", async () => {
    const r = await core().analyze({
      body: "Your weekly jobs round-up. New jobs just for you, sent every week. TikTok Inc. Software Engineer Graduate (Ads Infra) - 2027 Start $128-256K/yr https://www.linkedin.com/jobs/view/1",
      senderName: "LinkedIn", senderAddress: "linkedin@e.linkedin.com", subject: "You may be a top applicant for Software Engineer Graduate",
      links: ["https://www.linkedin.com/jobs/view/1"],
    }, "test");
    expect(r.verdict.action).toBe("allow");
  });

  it("a genuine scam still blocks: lookalike sender plus a credential request", async () => {
    const r = await core().analyze({
      body: "This is the LinkedIn Security Team. Unusual login detected. Verify your identity at https://linkedin-verify.app/login within 24 hours or your account will be suspended.",
      senderName: "LinkedIn Support", senderAddress: "li.support@gmail.com", subject: "Action required",
    }, "test");
    expect(r.verdict.action).toBe("block");
  });

  it("a brand-affixed link with a credential request is not capped", async () => {
    const r = await core().analyze({
      body: "Your PayPal account has been limited. Confirm your identity at https://paypal-secure-center.com/login to restore access.",
      senderName: "PayPal", senderAddress: "service@notice-mail.com", subject: "Account limited",
    }, "test");
    expect(["hold", "block"]).toContain(r.verdict.action);
  });

  it("a long marketing email is analyzed in well under a second", async () => {
    const para = "The Figma agent is now generally available and uses AI credits. We've made a number of improvements, including to output quality and the ability to handle longer-running tasks. See https://www.figma.com/blog/agent for details. ";
    const body = para.repeat(200); // ~45 KB
    const t0 = Date.now();
    const r = await core().analyze({ body, senderName: "Figma", senderAddress: "announcements@figma.com", subject: "The Figma agent is ready to build with you" }, "test");
    const ms = Date.now() - t0;
    expect(r.verdict.action).toBe("allow");
    expect(ms).toBeLessThan(800);
  });
});
