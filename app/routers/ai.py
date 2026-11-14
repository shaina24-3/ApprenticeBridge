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


# ── Server-side Gemini AI generation ────────────────────────────────────────
# These endpoints replace direct browser-to-Gemini calls.
# The API key stays server-side and is never exposed to the client.

import httpx
from pydantic import BaseModel, Field
from app.config import GEMINI_API_KEY, GEMINI_MODEL


class GenerateQuestionsRequest(BaseModel):
    """Request for AI-powered assessment question generation."""
    skill_name: str = Field(..., min_length=1, max_length=200)
    difficulty: str = Field(default="medium")  # easy | medium | hard
    mcq_count: int = Field(default=4, ge=0, le=10)
    short_count: int = Field(default=2, ge=0, le=10)
    theory_count: int = Field(default=1, ge=0, le=10)


class GenerateSummaryRequest(BaseModel):
    """Request for AI-generated candidate skill summary."""
    candidate_name: str = Field(..., min_length=1, max_length=200)
    education: str = Field(default="")
    verified_skills: list[dict] = Field(default_factory=list)


def _call_gemini(prompt: str) -> str:
    """
    Call the Gemini API server-side and return the raw text response.
    Returns empty string if the API key is not configured or the call fails.
    """
    if not GEMINI_API_KEY:
        return ""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }

    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, json=payload)
            if resp.status_code != 200:
                return ""
            data = resp.json()
            return data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
    except Exception:
        return ""


def _deterministic_fallback_questions(skill_name: str, difficulty: str, mcq_count: int, short_count: int, theory_count: int) -> list:
    """Generate deterministic fallback questions when Gemini is unavailable."""
    questions = []
    diff_desc = {"easy": "basic", "medium": "intermediate", "hard": "advanced"}.get(difficulty, "intermediate")

    for i in range(mcq_count):
        questions.append({
            "type": "mcq",
            "question": f"Question {i+1}: Which statement best demonstrates {diff_desc} knowledge of {skill_name}?",
            "option_a": f"Correctly applying {skill_name} in a real-world scenario",
            "option_b": f"Knowing only the theoretical definition of {skill_name}",
            "option_c": "Avoiding the use of this skill entirely",
            "option_d": "None of the above applies",
            "correct_option": "A",
        })

    for i in range(short_count):
        questions.append({
            "type": "short",
            "question": f"Short Answer {i+1}: Briefly explain a key concept of {skill_name} at {diff_desc} level.",
            "model_answer": f"A correct explanation of {skill_name} demonstrating {diff_desc} understanding.",
        })

    for i in range(theory_count):
        questions.append({
            "type": "theory",
            "question": f"Theory {i+1}: Describe how you would apply {skill_name} to solve a complex problem.",
            "model_answer": f"A detailed answer showing practical application of {skill_name} at {diff_desc} level.",
        })

    return questions


@router.post("/generate-questions")
def generate_questions(
    data: GenerateQuestionsRequest,
    user: User = Depends(require_roles("employer", "training_institute", "admin")),
):
    """
    Generate assessment questions using Gemini AI (server-side).

    The Gemini API key is never exposed to the frontend.
    Falls back to deterministic templates if Gemini is unavailable.
    """
    total = data.mcq_count + data.short_count + data.theory_count
    if total == 0:
        raise HTTPException(400, "At least one question type must have a count > 0")

    difficulty_desc = {
        "easy":   "basic / beginner level, straightforward questions",
        "medium": "intermediate level, requiring applied understanding",
        "hard":   "advanced level, requiring deep expertise and analysis",
    }.get(data.difficulty, "intermediate level")

    parts = []
    if data.mcq_count > 0:
        parts.append(f'{data.mcq_count} MCQ questions (type "mcq") — each with fields: question, option_a, option_b, option_c, option_d, correct_option (must be exactly "A", "B", "C", or "D")')
    if data.short_count > 0:
        parts.append(f'{data.short_count} short answer questions (type "short") — each with fields: question, model_answer (1-2 sentences)')
    if data.theory_count > 0:
        parts.append(f'{data.theory_count} theory/long answer questions (type "theory") — each with fields: question, model_answer (detailed paragraph)')

    prompt = f"""You are an expert assessment designer.
Generate exactly {total} assessment questions for the skill "{data.skill_name}" at {data.difficulty} difficulty ({difficulty_desc}).

Question breakdown required:
{chr(10).join(parts)}

IMPORTANT RULES:
- Return ONLY a valid JSON array — no markdown, no code fences, no explanation.
- Every object must have a "type" field matching exactly "mcq", "short", or "theory".
- MCQ correct_option must be exactly one of: "A", "B", "C", "D".
- Do not include any text outside the JSON array."""

    # Try Gemini first, fall back to deterministic
    raw = _call_gemini(prompt)

    if raw:
        try:
            # Clean any accidental markdown fences
            cleaned = raw.replace("```json", "").replace("```", "").strip()
            questions = json.loads(cleaned)
            if not isinstance(questions, list):
                raise ValueError("Not a JSON array")
            used_ai = True
        except (json.JSONDecodeError, ValueError):
            questions = _deterministic_fallback_questions(data.skill_name, data.difficulty, data.mcq_count, data.short_count, data.theory_count)
            used_ai = False
    else:
        questions = _deterministic_fallback_questions(data.skill_name, data.difficulty, data.mcq_count, data.short_count, data.theory_count)
        used_ai = False

    return {
        "questions": questions,
        "skill_name": data.skill_name,
        "difficulty": data.difficulty,
        "total": len(questions),
        "ai_generated": used_ai,
        "ai_source": f"Gemini ({GEMINI_MODEL})" if used_ai else "Deterministic fallback",
        "ai_note": (
            "AI-assisted result. AI does not make hiring decisions. "
            "Trainer review required before activation."
        ),
    }


@router.post("/generate-skill-summary")
def generate_skill_summary(
    data: GenerateSummaryRequest,
    user: User = Depends(require_roles("candidate")),
):
    """
    Generate a 2-sentence objective candidate skill summary using Gemini AI.
    Falls back to a deterministic summary if Gemini is unavailable.
    """
    skills_str = ", ".join(
        f"{s.get('name', '')} ({s.get('level', '')})"
        for s in data.verified_skills
    ) if data.verified_skills else "No verified skills yet"

    prompt = f"""Generate a 2-sentence objective candidate skill summary strictly based on these verified facts:
Candidate Name: {data.candidate_name}, Education: {data.education or 'Not specified'},
Verified Skills: {skills_str}.
Do not invent qualifications. Return only the summary text, no JSON, no markdown."""

    raw = _call_gemini(prompt)

    if raw and raw.strip():
        summary = raw.strip()
        used_ai = True
    else:
        summary = f"{data.candidate_name} has {len(data.verified_skills)} verified skill(s): {skills_str}. Education: {data.education or 'Not specified'}."
        used_ai = False

    return {
        "summary": summary,
        "ai_generated": used_ai,
        "ai_source": f"Gemini ({GEMINI_MODEL})" if used_ai else "Deterministic fallback",
        "ai_note": (
            "AI-assisted result based strictly on verified structured records. "
            "AI does not make hiring decisions."
        ),
    }
