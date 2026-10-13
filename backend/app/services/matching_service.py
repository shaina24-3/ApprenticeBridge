from __future__ import annotations
"""
Deterministic weighted matching service for ApprenticeBridge.

Scoring formula (total = 100 points):
  Skill match    60%
  Education      15%
  Interests      10%
  Location       10%
  Experience      5%

Verified skills carry higher confidence than self-declared skills:
  verified       → full weight  (confidence multiplier 1.0)
  assessed       → 90% weight   (confidence multiplier 0.9)
  self_declared  → 60% weight   (confidence multiplier 0.6)

Hard constraints (Layer A):
  Missing a mandatory certification → eligible = False regardless of score.
  Score is still calculated for informational purposes.

NOTE: AI is never used here. This is a fully deterministic, explainable algorithm.
"""

LEVELS = {"beginner": 1, "intermediate": 2, "advanced": 3, "expert": 4}

# Confidence multipliers per verification source/status
CONFIDENCE = {
    "assessment":     1.0,   # verified via proctored MCQ
    "human_verified": 1.0,   # approved evidence/certificate
    "verified":       1.0,   # generic verified flag
    "assessed":       0.9,   # self-submitted assessment result
    "self_declared":  0.6,   # candidate-added, unverified
    None:             0.6,   # unknown — treated as self-declared
}


def _confidence(candidate_skill) -> float:
    """
    Return the confidence multiplier for a candidate skill.
    Uses .source if available (backend model), falls back to .status
    (frontend seed-data compatible). Defaults to self-declared (0.6).
    """
    if candidate_skill is None:
        return 0.0
    source = getattr(candidate_skill, "source", None) or ""
    is_verified = getattr(candidate_skill, "verified", False)

    if is_verified:
        return CONFIDENCE.get(source.lower() if source else "verified", 1.0)

    # Non-verified: check source
    if source:
        return CONFIDENCE.get(source.lower(), 0.6)
    return 0.6


def level_weight(candidate_level: str | None, required_level: str) -> float:
    """
    Compare skill levels. Returns a 0–1 fraction representing how well
    the candidate's level meets the requirement.
      - At or above required level → 1.0
      - One level below            → 0.75
      - Two or more levels below   → 0.5
      - No level recorded          → 0.0
    """
    if not candidate_level:
        return 0.0
    c = LEVELS.get(candidate_level.lower(), 0)
    r = LEVELS.get(required_level.lower(), 0)
    if c >= r:
        return 1.0
    if c == r - 1:
        return 0.75
    return 0.5 if c > 0 else 0.0


def contains_term(text: str | None, term: str | None) -> bool:
    if not text or not term:
        return False
    return term.lower() in text.lower()


def calculate_match(
    candidate,
    apprenticeship,
    required_skills,
    candidate_skills,
    mandatory_certifications,
    candidate_certifications,
):
    """
    Calculate an explainable match between a candidate and an apprenticeship listing.

    Parameters
    ----------
    candidate              : CandidateProfile ORM object or SimpleNamespace (for tests)
    apprenticeship         : Apprenticeship ORM object or SimpleNamespace
    required_skills        : list[ApprenticeshipSkill] — skill requirements for the listing
    candidate_skills       : list[CandidateSkill]
    mandatory_certifications : list[int] — certification IDs that are mandatory
    candidate_certifications : list[CandidateCertification]

    Returns
    -------
    dict with keys:
      eligible, score, components, strong_matches, partial_matches,
      missing_skills, hard_failures, verified_skill_count, self_declared_skill_count
    """
    # Build a lookup: skill_id → CandidateSkill
    cs_map = {x.skill_id: x for x in candidate_skills}

    strong, partial, missing = [], [], []
    raw_skill_values = []  # (level_weight × confidence) per required skill

    for req in required_skills:
        row = cs_map.get(req.skill_id)
        lw = level_weight(row.level if row else None, req.required_level) if row else 0.0
        conf = _confidence(row) if row else 0.0
        effective = lw * conf  # verified skill at right level = 1.0; unverified partial = lower

        raw_skill_values.append(effective)

        item = {
            "skill_id": req.skill_id,
            "required_level": req.required_level,
            "candidate_level": row.level if row else None,
            "verified": getattr(row, "verified", False) if row else False,
            "source": getattr(row, "source", None) if row else None,
            "confidence": round(conf, 2),
            "effective_weight": round(effective, 2),
        }

        if effective >= 0.85:
            strong.append(item)
        elif effective > 0.0:
            partial.append(item)
        else:
            missing.append(item)

    skill_match_fraction = (
        sum(raw_skill_values) / len(raw_skill_values) if raw_skill_values else 0.0
    )

    # ── Layer A: Hard Constraints ──────────────────────────────────────────────
    hard_failures = []
    if mandatory_certifications:
        owned_cert_ids = {
            x.certification_id for x in candidate_certifications if x.verified
        }
        for cert_id in mandatory_certifications:
            if cert_id not in owned_cert_ids:
                hard_failures.append({"type": "certification", "certification_id": cert_id})

    eligible = not hard_failures

    # ── Layer B: Weighted Component Scores ────────────────────────────────────
    location_match = 1.0 if (
        not apprenticeship.location
        or contains_term(candidate.location, apprenticeship.location)
    ) else 0.0

    education_match = 1.0 if (
        not apprenticeship.education_requirement
        or contains_term(candidate.education, apprenticeship.education_requirement)
    ) else 0.0

    interest_match = 1.0 if (
        not apprenticeship.interest_keywords
        or any(
            contains_term(candidate.interests, kw.strip())
            for kw in apprenticeship.interest_keywords.split(",")
        )
    ) else 0.0

    experience_match = 1.0 if (
        not apprenticeship.experience_requirement
        or contains_term(candidate.experience, apprenticeship.experience_requirement)
    ) else 0.0

    score = (
        skill_match_fraction * 0.60
        + education_match     * 0.15
        + interest_match      * 0.10
        + location_match      * 0.10
        + experience_match    * 0.05
    ) * 100

    # Counts for transparency
    verified_count = sum(1 for cs in candidate_skills if getattr(cs, "verified", False))
    self_declared_count = len(candidate_skills) - verified_count

    return {
        "eligible": eligible,
        "score": round(score, 2),
        "components": {
            "skill_match":      round(skill_match_fraction * 100, 2),
            "education_match":  round(education_match * 100, 2),
            "interest_match":   round(interest_match * 100, 2),
            "location_match":   round(location_match * 100, 2),
            "experience_match": round(experience_match * 100, 2),
        },
        "strong_matches":  strong,
        "partial_matches": partial,
        "missing_skills":  missing,
        "hard_failures":   hard_failures,
        # Transparency fields
        "verified_skill_count":      verified_count,
        "self_declared_skill_count": self_declared_count,
        "note": (
            "Score boosted by verified skills. "
            "Self-declared skills carry 60% confidence weight. "
            "This score is deterministic — no AI model is involved."
        ),
    }
