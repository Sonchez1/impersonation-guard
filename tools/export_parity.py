"""Export the Python detector's verdicts over the full benchmark so the JS port can be
checked against them. Run with the impersonation-detector venv."""
import json, sys, dataclasses
from impersonation_detector import Detector, Message
from impersonation_detector.bench.seed import load_seed
from impersonation_detector.bench.variants import VARIANTS, apply_variant

BRAND_SETS = {
    "linkedin": ["linkedin.com", "LinkedIn"],
    "university": ["northfieldstate.edu", "Northfield State University", "NSU"],
}
out = open(sys.argv[1], "w", encoding="utf-8")
n = 0
for key, protected in BRAND_SETS.items():
    det = Detector(protected)
    for item in load_seed(protected):
        for vname in VARIANTS:
            v = apply_variant(vname, item, "NSU" if key == "university" else "LinkedIn")
            msg = v.to_message()
            verdict = det.analyze(msg)
            rec = {
                "brand_set": key, "protected": protected, "id": item.id, "variant": vname,
                "label": item.label,
                "message": {"body": msg.body, "sender_name": msg.sender_name,
                            "sender_address": msg.sender_address, "subject": msg.subject,
                            "links": list(msg.links)},
                "expect": {
                    "risk": round(verdict.risk, 4), "action": verdict.action,
                    "sender_p": round(verdict.sender_score.probability, 4),
                    "sender_features": {k: v for k, v in verdict.sender_score.features.items() if v},
                    "links": {h: round(s.probability, 4) for h, s in verdict.link_scores.items()},
                    "lookalikes": [[m.candidate, m.protected, list(m.reasons)] for m in verdict.lookalikes],
                    "intent": {"label": verdict.intent.label, "confidence": round(verdict.intent.confidence, 3),
                               "signals": list(verdict.intent.signals)},
                    "reasons": verdict.reasons,
                },
            }
            out.write(json.dumps(rec, ensure_ascii=False) + "\n"); n += 1
print("wrote", n)
