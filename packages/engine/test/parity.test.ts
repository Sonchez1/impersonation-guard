/** The JavaScript engine must reproduce the Python detector's verdicts over the full
 *  benchmark (seed x 10 variants x 2 brand sets = 1,520 messages). fixtures/parity.jsonl is
 *  produced by tools/export_parity.py with impersonation-detector 0.3.0. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Detector, type Message } from "../src/index";

interface Record_ {
  brand_set: string; protected: string[]; id: string; variant: string; label: string;
  message: { body: string; sender_name: string; sender_address: string; subject: string; links: string[] };
  expect: {
    risk: number; action: string; sender_p: number; sender_features: Record<string, number>;
    links: Record<string, number>; lookalikes: [string, string, string[]][];
    intent: { label: string; confidence: number; signals: string[] }; reasons: string[];
  };
}

const path = resolve(__dirname, "../../../fixtures/parity.jsonl");
const records: Record_[] = readFileSync(path, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("parity with the Python detector", () => {
  it("loads the corpus", () => {
    expect(records.length).toBe(1520);
  });

  const detectors = new Map<string, Detector>();
  const mismatches: string[] = [];

  it("reproduces every verdict", async () => {
    for (const r of records) {
      let det = detectors.get(r.brand_set);
      if (!det) { det = new Detector(r.protected); detectors.set(r.brand_set, det); }
      const msg: Message = {
        body: r.message.body, senderName: r.message.sender_name, senderAddress: r.message.sender_address,
        subject: r.message.subject, links: r.message.links,
      };
      const v = await det.analyze(msg);
      const tag = `${r.brand_set}/${r.id}/${r.variant}`;
      const diffs: string[] = [];
      if (v.action !== r.expect.action) diffs.push(`action ${v.action} != ${r.expect.action}`);
      if (Math.abs(v.risk - r.expect.risk) > 2e-3) diffs.push(`risk ${v.risk.toFixed(4)} != ${r.expect.risk}`);
      if (Math.abs((v.senderScore?.probability ?? -1) - r.expect.sender_p) > 2e-3) diffs.push(`sender_p ${v.senderScore?.probability.toFixed(4)} != ${r.expect.sender_p}`);
      const feats = Object.fromEntries(Object.entries(v.senderScore?.features ?? {}).filter(([, x]) => x));
      if (JSON.stringify(feats) !== JSON.stringify(r.expect.sender_features)) diffs.push(`features ${JSON.stringify(feats)} != ${JSON.stringify(r.expect.sender_features)}`);
      const links = Object.fromEntries(Object.entries(v.linkScores).map(([h, s]) => [h, Number(s.probability.toFixed(4))]));
      for (const [h, p] of Object.entries(r.expect.links)) if (Math.abs((links[h] ?? -1) - p) > 2e-3) diffs.push(`link ${h} ${links[h]} != ${p}`);
      if (Object.keys(links).length !== Object.keys(r.expect.links).length) diffs.push(`link set ${Object.keys(links)} != ${Object.keys(r.expect.links)}`);
      if (v.intent?.label !== r.expect.intent.label) diffs.push(`intent ${v.intent?.label} != ${r.expect.intent.label}`);
      if (Math.abs((v.intent?.confidence ?? -1) - r.expect.intent.confidence) > 2e-3) diffs.push(`conf ${v.intent?.confidence} != ${r.expect.intent.confidence}`);
      if (JSON.stringify(v.intent?.signals) !== JSON.stringify(r.expect.intent.signals)) diffs.push(`signals ${v.intent?.signals} != ${r.expect.intent.signals}`);
      const la = v.lookalikes.map((m) => [m.candidate, m.protected, m.reasons]);
      if (JSON.stringify(la) !== JSON.stringify(r.expect.lookalikes)) diffs.push(`lookalikes ${JSON.stringify(la)} != ${JSON.stringify(r.expect.lookalikes)}`);
      if (diffs.length) mismatches.push(`${tag}: ${diffs.join("; ")}`);
    }
    if (mismatches.length) {
      console.log(`${mismatches.length} mismatches\n` + mismatches.slice(0, 40).join("\n"));
    }
    expect(mismatches).toEqual([]);
  });
});
