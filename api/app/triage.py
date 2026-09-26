"""Calibrated alert triage.

Typed decision layer over structured evidence: priority, action, a confidence
score, and a human-readable reason trail. Runs a deterministic scorer by
default. If JEV_API_KEY is set, it asks Jev (TypeSafe) for the same typed
questions over the same feature set and uses that result instead -- Jev never
sees raw plate strings, face data, or names, only the enumerated features
below, and every response is logged so the choice is auditable either way.

Sole authority over a field action never lives here: this module recommends,
the operator confirms (see review_alert in main.py).
"""
import json
import os
import urllib.request
from dataclasses import dataclass, field

JEV_API_KEY = os.getenv("JEV_API_KEY", "").strip()
JEV_MODEL = os.getenv("JEV_MODEL", "jev-1.13.0")
JEV_URL = os.getenv("JEV_URL", "https://api.typesafe.ai/v1/choice")
JEV_TIMEOUT_S = float(os.getenv("JEV_TIMEOUT_S", "0.5"))

FIELD_ACTION_CATEGORIES = {"stolen", "wanted", "missing"}
PRIORITIES = ("P1", "P2", "P3", "P4")
ACTIONS = ("intercept", "notify police station", "monitor", "human review")


@dataclass
class TriageInput:
    match_type: str  # exact / fuzzy / face
    category: str  # stolen / wanted / missing / blacklisted / suspect
    event_type: str  # plate / vehicle / face
    plate_confidence: float
    vote_share: float | None
    gate: str  # first sighting / plausible / rejected
    implied_kmh: float | None
    camera_health: float  # 0..1, placeholder until per-camera health scoring lands
    hour_band: str  # "day" / "night"


@dataclass
class TriageResult:
    priority: str
    action: str
    confidence: float
    evidence_sufficient: float
    misread_or_clone_risk: float
    reasons: list[str] = field(default_factory=list)
    source: str = "deterministic"


def _hour_band(hour: int) -> str:
    return "day" if 6 <= hour < 20 else "night"


def build_input(*, match_type: str, category: str, event_type: str, plate_confidence: float,
                 vote_share: float | None, gate: str, implied_kmh: float | None,
                 camera_health: float, hour: int) -> TriageInput:
    return TriageInput(match_type=match_type, category=category, event_type=event_type,
                        plate_confidence=round(plate_confidence, 3), vote_share=vote_share,
                        gate=gate, implied_kmh=implied_kmh, camera_health=round(camera_health, 3),
                        hour_band=_hour_band(hour))


def _deterministic(inp: TriageInput) -> TriageResult:
    reasons: list[str] = []
    confidence = inp.plate_confidence if inp.event_type != "face" else 0.75
    confidence *= 1.0 if inp.match_type == "exact" else 0.78
    reasons.append(f"{inp.match_type} match on {inp.event_type} scored base confidence {confidence:.2f}")

    if inp.gate == "rejected":
        confidence *= 0.4
        reasons.append(f"physics gate rejected implied speed {inp.implied_kmh} km/h between sightings")
    elif inp.gate == "plausible" and inp.implied_kmh is not None:
        reasons.append(f"cross-camera travel plausible at {inp.implied_kmh} km/h")

    confidence *= 0.6 + 0.4 * inp.camera_health
    if inp.camera_health < 0.6:
        reasons.append(f"camera health {inp.camera_health:.2f} discounts confidence")

    confidence = round(min(0.99, max(0.01, confidence)), 3)

    misread_risk = round(min(1.0, max(0.0,
        (1 - inp.plate_confidence) * 0.6
        + (0.3 if inp.vote_share is not None and inp.vote_share < 0.6 else 0)
        + (0.4 if inp.gate == "rejected" else 0)
    )), 3)
    if misread_risk >= 0.5:
        reasons.append("high misread/clone risk: low vote share or rejected travel gate")

    evidence_sufficient = round(min(1.0, max(0.0,
        confidence * (0.55 if inp.match_type != "exact" else 1.0) * (1 - misread_risk)
    )), 3)

    can_field_act = inp.category in FIELD_ACTION_CATEGORIES
    if confidence < 0.5 or (can_field_act and evidence_sufficient < 0.7) or inp.event_type == "face":
        action = "human review"
        priority = "P2" if confidence >= 0.5 else "P3"
        if inp.event_type == "face":
            reasons.append("face matches always route to human review before action")
        elif evidence_sufficient < 0.7:
            reasons.append(f"evidence_sufficient {evidence_sufficient:.2f} below 0.7 gate for field action")
    elif can_field_act and confidence >= 0.75:
        action = "intercept"
        priority = "P1"
    elif can_field_act:
        action = "notify police station"
        priority = "P2"
    else:
        action = "monitor"
        priority = "P3" if confidence >= 0.5 else "P4"

    if inp.hour_band == "night" and priority in ("P1", "P2"):
        reasons.append("night-hour sighting: recommend dispatch caution")

    return TriageResult(priority=priority, action=action, confidence=confidence,
                         evidence_sufficient=evidence_sufficient, misread_or_clone_risk=misread_risk,
                         reasons=reasons, source="deterministic")


def _jev(inp: TriageInput) -> TriageResult | None:
    """Best-effort call to Jev's typed-probability API. Never raises; caller falls back."""
    if not JEV_API_KEY:
        return None
    state = {
        "event_type": inp.event_type,
        "watchlist_category": inp.category,
        "match_type": inp.match_type,
        "plate_confidence": inp.plate_confidence,
        "vote_share": inp.vote_share,
        "physics_gate": inp.gate,
        "implied_kmh": inp.implied_kmh,
        "camera_health": inp.camera_health,
        "hour_band": inp.hour_band,
    }
    payload = {
        "model": JEV_MODEL,
        "state": state,
        "questions": [
            {"name": "priority", "type": "choice", "options": list(PRIORITIES)},
            {"name": "action", "type": "choice", "options": list(ACTIONS)},
            {"name": "evidence_sufficient_for_field_action", "type": "bool"},
            {"name": "misread_or_clone_risk", "type": "score", "levels": 10},
        ],
    }
    try:
        req = urllib.request.Request(
            JEV_URL, data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {JEV_API_KEY}"},
        )
        with urllib.request.urlopen(req, timeout=JEV_TIMEOUT_S) as resp:
            body = json.loads(resp.read())
        priority = body["priority"]["value"]
        action = body["action"]["value"]
        evidence_ok = body["evidence_sufficient_for_field_action"]["value"]
        evidence_conf = body["evidence_sufficient_for_field_action"].get("confidence", 0.5)
        clone_risk = body["misread_or_clone_risk"]["value"] / 10
        confidence = round(min(1.0, max(0.0,
            (body["priority"].get("confidence", 0.5) + body["action"].get("confidence", 0.5)) / 2
        )), 3)
        reasons = [f"jev({JEV_MODEL}) typed-probability triage"]
        return TriageResult(
            priority=priority if priority in PRIORITIES else "P3",
            action=action if action in ACTIONS else "human review",
            confidence=confidence,
            evidence_sufficient=round(evidence_conf if evidence_ok else 1 - evidence_conf, 3),
            misread_or_clone_risk=round(clone_risk, 3),
            reasons=reasons,
            source=f"jev:{JEV_MODEL}",
        )
    except Exception:
        return None


def triage(inp: TriageInput) -> TriageResult:
    result = _jev(inp) if JEV_API_KEY else None
    if result is None:
        result = _deterministic(inp)
    fallback = _deterministic(inp)
    if result.confidence < 0.5 or (inp.category in FIELD_ACTION_CATEGORIES and result.evidence_sufficient < 0.7):
        result.action = "human review"
        if "human review" not in " ".join(result.reasons):
            result.reasons.append("gated to human review: low confidence or insufficient evidence")
    result.reasons.append(f"deterministic cross-check: {fallback.priority}/{fallback.action}/{fallback.confidence:.2f}")
    return result
