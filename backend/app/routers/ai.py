"""
Responsible AI routes for ApprenticeBridge.

Governance principles enforced here:
  1. AI-generated assessment questions are always saved as DRAFT.
     A trainer or admin must review and approve before candidates see them.
  2. AI-generated candidate summaries are built ONLY from verified structured
     records — never invented.
  3. AI does NOT make hiring decisions.
  4. Every AI response carries an explicit transparency note.
  5. A deterministic fallback exists for every AI path so the platform
     continues to function even if the AI service is unavailable.
"""

import os
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.dependencies import require_roles
from app.database import get_db
from app.models import (
    User, Skill, CandidateSkill, CandidateProfile,
    Assessment, AssessmentQuestion,
)
from app.schemas import AIDraftRequest

router = APIRouter(prefix="/ai", tags=["Responsible AI"])

# ── Shared transparency footer appended to every AI response ─────────────────
AI_TRANSPARENCY = {
    "ai_source": "Gemini (Google Generative AI) — server-side stub pending API key configuration",
    "ai_note": (
        "AI-assisted result. "
        "AI does not make hiring decisions. "
        "Trainer review required before activation. "
        "Results are based strictly on verified structured records."
    ),
    "deterministic_fallback": True,
}


@router.post("/assessment-draft")
def assessment_draft(
    data: AIDraftRequest,
    user: User = Depends(require_roles("training_institute", "admin")),
    db: Session = Depends(get_db),
):
    """
    Generate a DRAFT assessment for a given skill.

    Status is always DRAFT — requires trainer/admin approval before
    candidates can see or attempt the assessment.

    Currently uses a deterministic fallback template. Gemini integration
    can be added by replacing the questions list below with an actual
    API call, without changing the endpoint contract.
    """
    skill = db.get(Skill, data.skill_id)
    if not skill:
        raise HTTPException(404, "Skill not found")

    questions = []
    for i in range(data.count):
        questions.append({
            "question": (
                f"Question {i + 1}: Which statement best demonstrates "
                f"practical knowledge of {skill.name}?"
            ),
            "option_a": f"Applying {skill.name} correctly in a relevant scenario",
            "option_b": f"Knowing only the definition of {skill.name}",
            "option_c": "Avoiding the skill entirely",
            "option_d": "None of the above",
            "correct_option": "A",
            "status": "DRAFT",  # Mandatory — must not be changed to approved here
        })

    return {
        "status": "DRAFT",
        "skill_id": skill.id,
        "skill_name": skill.name,
        "trade": data.trade,
        "questions": questions,
        "message": (
            "Draft generated. Trainer approval is required before "
            "these questions are shown to candidates."
        ),
        **AI_TRANSPARENCY,
    }


@router.post("/assessment-draft/save")
def save_ai_draft(
    data: AIDraftRequest,
    user: User = Depends(require_roles("training_institute", "admin")),
    db: Session = Depends(get_db),
):
    """
    Persist an AI-generated DRAFT assessment to the database.
    Status is always 'draft' — must be approved via /ai/assessments/{id}/approve.
    """
    skill = db.get(Skill, data.skill_id)
    if not skill:
        raise HTTPException(404, "Skill not found")

    assessment = Assessment(
        skill_id=skill.id,
        title=f"AI Draft Assessment — {skill.name}",
        description=f"Trainer-review draft for trade: {data.trade}",
        status="draft",
        created_by=user.id,
    )
    db.add(assessment)
    db.flush()

    for i in range(data.count):
        db.add(AssessmentQuestion(
            assessment_id=assessment.id,
            question=(
                f"Question {i + 1}: Which statement best demonstrates "
                f"practical knowledge of {skill.name}?"
            ),
            option_a=f"Applying {skill.name} correctly in a relevant scenario",
            option_b=f"Knowing only the definition of {skill.name}",
            option_c="Avoiding the skill entirely",
            option_d="None of the above",
            correct_option="A",
        ))

    db.commit()
    db.refresh(assessment)

    return {
        "assessment_id": assessment.id,
        "status": "DRAFT",
        "message": "Saved as DRAFT. Approve via PATCH /ai/assessments/{id}/approve.",
        **AI_TRANSPARENCY,
    }


@router.patch("/assessments/{assessment_id}/approve")
def approve_assessment(
    assessment_id: int,
    user: User = Depends(require_roles("training_institute", "admin")),
    db: Session = Depends(get_db),
):
    """
    Trainer/admin approves a DRAFT assessment for use by candidates.
    This is a mandatory human-review gate — AI cannot auto-approve.
    """
    assessment = db.get(Assessment, assessment_id)
    if not assessment:
        raise HTTPException(404, "Assessment not found")
    if assessment.status == "approved":
        return {"assessment_id": assessment.id, "status": "approved", "message": "Already approved."}

    assessment.status = "approved"
    db.commit()

    return {
        "assessment_id": assessment.id,
        "status": "approved",
        "approved_by_role": user.role,
        "message": (
            "Assessment approved. Candidates can now see and attempt it. "
            "AI-generated questions were human-reviewed before activation."
        ),
    }


@router.get("/candidate-summary")
def verified_skill_summary(
    user: User = Depends(require_roles("candidate")),
    db: Session = Depends(get_db),
):
    """
    Return a structured summary of the candidate's verified skills.

    RESPONSIBLE AI CONSTRAINT:
    This endpoint only reads from verified=True CandidateSkill records.
    It does NOT invent skills, certifications, or experience.
    Gemini can be integrated server-side for natural-language generation;
    the fallback here is deterministic and always available.
    """
    profile = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if not profile:
        return {
            "summary": "Complete your profile and verify skills first.",
            **AI_TRANSPARENCY,
        }

    rows = (
        db.query(CandidateSkill, Skill)
        .join(Skill, Skill.id == CandidateSkill.skill_id)
        .filter(
            CandidateSkill.candidate_id == profile.id,
            CandidateSkill.verified == True,
        )
        .all()
    )

    if not rows:
        return {
            "summary": "No verified skills are recorded yet.",
            "verified_skill_count": 0,
            **AI_TRANSPARENCY,
        }

    skill_descriptions = [
        f"{skill.name} ({cs.level}, score: {cs.score}%)"
        if cs.score else f"{skill.name} ({cs.level})"
        for cs, skill in rows
    ]

    summary = (
        f"Candidate has {len(rows)} verified skill(s): "
        f"{', '.join(skill_descriptions)}. "
        "All entries are sourced from verified structured records only."
    )

    return {
        "summary": summary,
        "verified_skill_count": len(rows),
        "skills": [
            {
                "name": skill.name,
                "level": cs.level,
                "score": cs.score,
                "source": cs.source,
                "verified_at": cs.verified_at.isoformat() if cs.verified_at else None,
            }
            for cs, skill in rows
        ],
        "source": "verified_structured_records_only",
        **AI_TRANSPARENCY,
    }
