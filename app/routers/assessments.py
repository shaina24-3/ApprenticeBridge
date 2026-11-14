from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles, get_current_user
from app.database import get_db
from app.models import User, Assessment, AssessmentQuestion, AssessmentAttempt, CandidateProfile, CandidateSkill, Skill
from app.schemas import AssessmentCreate, AssessmentSubmit
from datetime import datetime

router = APIRouter(prefix="/assessments", tags=["Assessments"])

ALLOWED_DIFFICULTIES = {"easy", "medium", "hard"}
ALLOWED_Q_TYPES      = {"mcq", "short", "theory"}

def level_for(score):
    if score >= 85: return "advanced"
    if score >= 70: return "intermediate"
    if score >= 50: return "beginner"
    return "not_verified"

def _serialize_assessment(a: Assessment, db: Session, include_questions=False, include_correct=False):
    skill = db.get(Skill, a.skill_id)
    creator = db.get(User, a.created_by)
    out = {
        "id":          a.id,
        "skill_id":    a.skill_id,
        "skill_name":  skill.name if skill else "",
        "title":       a.title,
        "description": a.description,
        "difficulty":  a.difficulty,
        "status":      a.status,
        "created_by":  a.created_by,
        "creator_name": creator.name if creator else "",
        "creator_role": creator.role if creator else "",
        "created_at":  a.created_at,
    }
    if include_questions:
        qs = db.query(AssessmentQuestion).filter_by(assessment_id=a.id).all()
        questions = []
        for q in qs:
            qd = {
                "id":            q.id,
                "question_type": q.question_type,
                "question":      q.question,
            }
            if q.question_type == "mcq":
                qd["options"] = {"A": q.option_a, "B": q.option_b, "C": q.option_c, "D": q.option_d}
                if include_correct:
                    qd["correct_option"] = q.correct_option
            else:
                if include_correct:
                    qd["model_answer"] = q.model_answer
            questions.append(qd)
        out["questions"] = questions
        out["question_count"] = len(questions)
        out["mcq_count"]    = sum(1 for q in qs if q.question_type == "mcq")
        out["short_count"]  = sum(1 for q in qs if q.question_type == "short")
        out["theory_count"] = sum(1 for q in qs if q.question_type == "theory")
    else:
        count = db.query(AssessmentQuestion).filter_by(assessment_id=a.id).count()
        out["question_count"] = count
    return out


# ── Create (employers, admins, training institutes) ─────────────────────────

@router.post("")
def create_assessment(
    data: AssessmentCreate,
    user: User = Depends(require_roles("employer", "training_institute", "admin")),
    db: Session = Depends(get_db),
):
    if data.difficulty not in ALLOWED_DIFFICULTIES:
        data.difficulty = "medium"
    if data.status not in {"draft", "approved"}:
        data.status = "approved"

    # Ensure skill exists; if not, create it automatically
    skill = db.get(Skill, data.skill_id)
    if not skill:
        raise HTTPException(404, f"Skill {data.skill_id} not found")

    a = Assessment(
        skill_id=data.skill_id,
        title=data.title,
        description=data.description,
        difficulty=data.difficulty,
        status=data.status,
        created_by=user.id,
    )
    db.add(a)
    db.flush()

    for q in data.questions:
        qtype = q.get("question_type", "mcq")
        if qtype not in ALLOWED_Q_TYPES:
            qtype = "mcq"
        db.add(AssessmentQuestion(
            assessment_id=a.id,
            question_type=qtype,
            question=q.get("question", ""),
            option_a=q.get("option_a") or q.get("option_A"),
            option_b=q.get("option_b") or q.get("option_B"),
            option_c=q.get("option_c") or q.get("option_C"),
            option_d=q.get("option_d") or q.get("option_D"),
            correct_option=q.get("correct_option"),
            model_answer=q.get("model_answer"),
        ))

    db.commit()
    db.refresh(a)
    return _serialize_assessment(a, db, include_questions=True, include_correct=True)


# ── List (candidates see all approved; employers see own) ───────────────────

@router.get("")
def list_assessments(db: Session = Depends(get_db)):
    rows = db.query(Assessment).filter(Assessment.status == "approved").order_by(Assessment.created_at.desc()).all()
    return [_serialize_assessment(r, db, include_questions=False) for r in rows]

@router.get("/employer/mine")
def employer_assessments(user: User = Depends(require_roles("employer", "admin")), db: Session = Depends(get_db)):
    rows = db.query(Assessment).filter(Assessment.created_by == user.id).order_by(Assessment.created_at.desc()).all()
    return [_serialize_assessment(r, db, include_questions=True, include_correct=True) for r in rows]


@router.get("/my-attempts")
def my_attempts(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return the latest attempt per assessment for the current user."""
    rows = (
        db.query(AssessmentAttempt, Assessment)
        .join(Assessment, Assessment.id == AssessmentAttempt.assessment_id)
        .filter(AssessmentAttempt.candidate_id == user.id)
        .order_by(AssessmentAttempt.completed_at.desc())
        .all()
    )
    by_assessment = {}
    for att, asm in rows:
        aid = att.assessment_id
        existing = by_assessment.get(aid)
        if existing is None or (att.completed_at and att.completed_at.isoformat() > existing["completed_at"]):
            by_assessment[aid] = {
                "assessment_id": att.assessment_id,
                "attempt_id": att.id,
                "score": att.score,
                "level": att.level,
                "completed_at": att.completed_at.isoformat() if att.completed_at else None,
                "title": asm.title,
                "skill_id": asm.skill_id,
            }
    return list(by_assessment.values())


# ── Get single ──────────────────────────────────────────────────────────────

@router.get("/{assessment_id}")
def get_assessment(assessment_id: int, db: Session = Depends(get_db)):
    a = db.get(Assessment, assessment_id)
    if not a or a.status != "approved":
        raise HTTPException(404, "Assessment not found")
    return _serialize_assessment(a, db, include_questions=True, include_correct=False)


# ── Update ──────────────────────────────────────────────────────────────────

@router.put("/{assessment_id}")
def update_assessment(
    assessment_id: int,
    data: AssessmentCreate,
    user: User = Depends(require_roles("employer", "training_institute", "admin")),
    db: Session = Depends(get_db),
):
    a = db.get(Assessment, assessment_id)
    if not a or a.created_by != user.id:
        raise HTTPException(404, "Assessment not found")

    a.title       = data.title
    a.description = data.description
    a.difficulty  = data.difficulty if data.difficulty in ALLOWED_DIFFICULTIES else "medium"
    a.status      = data.status if data.status in {"draft", "approved"} else "approved"

    # Replace questions
    db.query(AssessmentQuestion).filter_by(assessment_id=a.id).delete()
    for q in data.questions:
        qtype = q.get("question_type", "mcq")
        if qtype not in ALLOWED_Q_TYPES: qtype = "mcq"
        db.add(AssessmentQuestion(
            assessment_id=a.id,
            question_type=qtype,
            question=q.get("question", ""),
            option_a=q.get("option_a"),
            option_b=q.get("option_b"),
            option_c=q.get("option_c"),
            option_d=q.get("option_d"),
            correct_option=q.get("correct_option"),
            model_answer=q.get("model_answer"),
        ))

    db.commit()
    db.refresh(a)
    return _serialize_assessment(a, db, include_questions=True, include_correct=True)


# ── Delete ──────────────────────────────────────────────────────────────────

@router.delete("/{assessment_id}", status_code=204)
def delete_assessment(
    assessment_id: int,
    user: User = Depends(require_roles("employer", "admin")),
    db: Session = Depends(get_db),
):
    a = db.get(Assessment, assessment_id)
    if not a or a.created_by != user.id:
        raise HTTPException(404, "Assessment not found")
    db.delete(a)
    db.commit()


# ── Submit (candidates) ─────────────────────────────────────────────────────

@router.post("/{assessment_id}/submit")
def submit(
    assessment_id: int,
    data: AssessmentSubmit,
    user: User = Depends(require_roles("candidate")),
    db: Session = Depends(get_db),
):
    a = db.get(Assessment, assessment_id)
    if not a or a.status != "approved":
        raise HTTPException(404, "Assessment not found")

    qs = db.query(AssessmentQuestion).filter_by(assessment_id=a.id).all()
    if not qs:
        raise HTTPException(400, "Assessment has no questions")

    # Score MCQ questions automatically; non-MCQ count as correct if answered
    mcq_qs   = [q for q in qs if q.question_type == "mcq"]
    other_qs = [q for q in qs if q.question_type != "mcq"]

    mcq_correct = sum(
        1 for q in mcq_qs
        if data.answers.get(q.id, "").upper() == (q.correct_option or "").upper()
    )
    other_answered = sum(1 for q in other_qs if str(data.answers.get(q.id, "")).strip())

    total_score_items = len(qs)
    total_correct     = mcq_correct + other_answered
    score = round(total_correct / total_score_items * 100, 2) if total_score_items else 0
    level = level_for(score)

    attempt = AssessmentAttempt(assessment_id=a.id, candidate_id=user.id, score=score, level=level)
    db.add(attempt)

    # Auto-update candidate skill
    profile = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if profile and level != "not_verified":
        row = db.query(CandidateSkill).filter_by(candidate_id=profile.id, skill_id=a.skill_id).first()
        if not row:
            row = CandidateSkill(candidate_id=profile.id, skill_id=a.skill_id, level=level, source="assessment", score=score, verified=True, verified_at=datetime.utcnow())
            db.add(row)
        else:
            row.level = level; row.source = "assessment"; row.score = score
            row.verified = True; row.verified_at = datetime.utcnow()

    db.commit()
    db.refresh(attempt)
    return {"attempt_id": attempt.id, "score": score, "level": level, "correct": total_correct, "total": total_score_items}


# (my-attempts route is defined above, before /{assessment_id})
