from __future__ import annotations
"""
Deterministic weighted matching service for ApprenticeBridge.

Scoring formula (total = 100 points):
  Skill match         50%  (required skills vs candidate skills, confidence-weighted)
  Semantic match      20%  (all-MiniLM-L6-v2 cosine similarity: profile text vs listing text)
  Education           10%  (keyword overlap between education field and requirement)
  Interests           10%  (keyword overlap between interests/trades and listing keywords)
  Location             5%  (candidate location contains listing location)
  Experience           5%  (keyword overlap between experience and requirement)

Verified skills carry higher confidence than self-declared ones:
  verified / assessment / human_verified  → 1.0
  assessed                                → 0.9
  self_declared                           → 0.6

Hard constraints (Layer A):
  Missing a mandatory certification → eligible = False. Score still calculated.

NOTE: Fully deterministic and explainable. The semantic component uses a pretrained
      embedding model — not a generative AI — and does not make hiring decisions.
"""

LEVELS = {"beginner": 1, "intermediate": 2, "advanced": 3, "expert": 4}

CONFIDENCE = {
    "assessment":     1.0,
    "human_verified": 1.0,
    "verified":       1.0,
    "assessed":       0.9,
    "self_declared":  0.6,
    None:             0.6,
}


def _confidence(candidate_skill) -> float:
    if candidate_skill is None:
        return 0.0
    source      = getattr(candidate_skill, "source", None) or ""
    is_verified = getattr(candidate_skill, "verified", False)
    if is_verified:
        return CONFIDENCE.get(source.lower() if source else "verified", 1.0)
    if source:
        return CONFIDENCE.get(source.lower(), 0.6)
    return 0.6


def level_weight(candidate_level: str | None, required_level: str) -> float:
    if not candidate_level:
        return 0.0
    c = LEVELS.get(candidate_level.lower(), 0)
    r = LEVELS.get(required_level.lower(), 0)
    if c >= r:    return 1.0
    if c == r-1:  return 0.75
    return 0.5 if c > 0 else 0.0


def contains_term(text: str | None, term: str | None) -> bool:
    if not text or not term:
        return False
    return term.strip().lower() in text.lower()


def _any_keyword_match(candidate_text: str | None, keywords_csv: str | None) -> bool:
    """Return True if any comma-separated keyword from keywords_csv appears in candidate_text."""
    if not keywords_csv:
        return True   # no requirement → no penalty
    if not candidate_text:
        return False
    return any(contains_term(candidate_text, kw) for kw in keywords_csv.split(","))


def _candidate_profile_text(candidate, candidate_skills) -> str:
    parts = []
    for field in ("trades", "education", "experience", "interests"):
        val = getattr(candidate, field, None)
        if val:
            parts.append(f"{field.capitalize()}: {val}")
    if candidate_skills:
        names = [
            getattr(s, "name", None) or str(getattr(s, "skill_id", ""))
            for s in candidate_skills
        ]
        names = [n for n in names if n]
        if names:
            parts.append(f"Skills: {', '.join(names)}")
    return " | ".join(parts)


def _listing_text(apprenticeship) -> str:
    parts = []
    for attr in ("title", "category"):
        v = getattr(apprenticeship, attr, None)
        if v:
            parts.append(str(v))
    desc = getattr(apprenticeship, "description", None)
    if desc:
        parts.append(str(desc)[:600])
    for attr in ("interest_keywords", "education_requirement", "experience_requirement"):
        v = getattr(apprenticeship, attr, None)
        if v:
            parts.append(str(v))
    return " | ".join(parts)


def _semantic_similarity(text_a: str, text_b: str) -> float:
    """Cosine similarity via all-MiniLM-L6-v2 (cached, loaded once). Falls back to 0.0."""
    if not text_a.strip() or not text_b.strip():
        return 0.0
    try:
        from app.services.ats_model import get_model
        from sentence_transformers import util as _util
        model = get_model()
        embs = model.encode(
            [text_a[:600], text_b[:600]],
            convert_to_tensor=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return max(0.0, min(1.0, float(_util.cos_sim(embs[0], embs[1]).item())))
    except Exception:
        return 0.0


def calculate_match(
    candidate,
    apprenticeship,
    required_skills,
    candidate_skills,
    mandatory_certifications,
    candidate_certifications,
):
    # ── Skill match ───────────────────────────────────────────────────────────
    cs_map = {x.skill_id: x for x in candidate_skills}
    strong, partial, missing, raw_values = [], [], [], []

    for req in required_skills:
        row  = cs_map.get(req.skill_id)
        lw   = level_weight(row.level if row else None, req.required_level) if row else 0.0
        conf = _confidence(row) if row else 0.0
        eff  = lw * conf
        raw_values.append(eff)
        item = {
            "skill_id":        req.skill_id,
            "required_level":  req.required_level,
            "candidate_level": row.level if row else None,
            "verified":        getattr(row, "verified", False) if row else False,
            "source":          getattr(row, "source", None)   if row else None,
            "confidence":      round(conf, 2),
            "effective_weight":round(eff,  2),
        }
        if eff >= 0.85:    strong.append(item)
        elif eff > 0.0:    partial.append(item)
        else:              missing.append(item)

    skill_fraction = sum(raw_values) / len(raw_values) if raw_values else 0.0

    # ── Semantic profile-to-role match ────────────────────────────────────────
    candidate_text = _candidate_profile_text(candidate, candidate_skills)
    listing_text   = _listing_text(apprenticeship)
    semantic_sim   = _semantic_similarity(candidate_text, listing_text)

    # ── Layer A: Hard constraints ─────────────────────────────────────────────
    hard_failures = []
    if mandatory_certifications:
        owned = {x.certification_id for x in candidate_certifications if x.verified}
        for cid in mandatory_certifications:
            if cid not in owned:
                hard_failures.append({"type": "certification", "certification_id": cid})

    eligible = not hard_failures

    # ── Structured field components ───────────────────────────────────────────
    location_match = 1.0 if (
        not apprenticeship.location
        or contains_term(candidate.location, apprenticeship.location)
    ) else 0.0

    education_match = 1.0 if (
        not apprenticeship.education_requirement
        or _any_keyword_match(candidate.education, apprenticeship.education_requirement)
    ) else 0.0

    interest_match = 1.0 if (
        not apprenticeship.interest_keywords
        or _any_keyword_match(
            (getattr(candidate, "interests", "") or "") + " " + (getattr(candidate, "trades", "") or ""),
            apprenticeship.interest_keywords,
        )
    ) else 0.0

    experience_match = 1.0 if (
        not apprenticeship.experience_requirement
        or _any_keyword_match(
            (getattr(candidate, "experience", "") or "") + " " + (getattr(candidate, "trades", "") or ""),
            apprenticeship.experience_requirement,
        )
    ) else 0.0

    # ── Weighted final score ──────────────────────────────────────────────────
    score = (
        skill_fraction   * 0.50
        + semantic_sim   * 0.20
        + education_match* 0.10
        + interest_match * 0.10
        + location_match * 0.05
        + experience_match * 0.05
    ) * 100

    verified_count      = sum(1 for cs in candidate_skills if getattr(cs, "verified", False))
    self_declared_count = len(candidate_skills) - verified_count

    return {
        "eligible": eligible,
        "score":    round(score, 2),
        "components": {
            "skill_match":      round(skill_fraction * 100, 2),
            "semantic_match":   round(semantic_sim   * 100, 2),
            "education_match":  round(education_match * 100, 2),
            "interest_match":   round(interest_match  * 100, 2),
            "location_match":   round(location_match  * 100, 2),
            "experience_match": round(experience_match * 100, 2),
        },
        "strong_matches":  strong,
        "partial_matches": partial,
        "missing_skills":  missing,
        "hard_failures":   hard_failures,
        "verified_skill_count":      verified_count,
        "self_declared_skill_count": self_declared_count,
        "explanation": (
            f"Skill {round(skill_fraction*100)}% | "
            f"Profile-role fit {round(semantic_sim*100)}% | "
            f"Education {round(education_match*100)}% | "
            f"Interests {round(interest_match*100)}% | "
            f"Location {round(location_match*100)}% | "
            f"Experience {round(experience_match*100)}%"
        ),
        "note": (
            "Score uses verified-skill confidence weighting + semantic "
            "profile-to-role similarity. Deterministic — no generative AI."
        ),
    }
