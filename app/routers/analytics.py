from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles, get_current_user
from app.database import get_db
from app.models import User, Application, Apprenticeship, CandidateProfile, CandidateSkill, AssessmentAttempt, Assessment, Skill

router=APIRouter(prefix="/analytics",tags=["Analytics"])

@router.get("/admin")
def admin_stats(user:User=Depends(require_roles("admin")),db:Session=Depends(get_db)):
    return {"candidates":db.query(User).filter(User.role=="candidate").count(),"employers":db.query(User).filter(User.role=="employer").count(),"training_institutes":db.query(User).filter(User.role=="training_institute").count(),"apprenticeships":db.query(Apprenticeship).count(),"applications":db.query(Application).count()}

@router.get("/employer")
def employer_stats(user:User=Depends(require_roles("employer")),db:Session=Depends(get_db)):
    listings=db.query(Apprenticeship).filter_by(employer_id=user.id).all(); ids=[x.id for x in listings]
    apps=db.query(Application).filter(Application.apprenticeship_id.in_(ids)).all() if ids else []
    return {"active_apprenticeships":sum(1 for x in listings if x.status=="published"),"total_applicants":len(apps),"shortlisted":sum(1 for x in apps if x.status=="shortlisted"),"selected":sum(1 for x in apps if x.status=="selected")}

@router.get("/candidate")
def candidate_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role != "candidate":
        return {"applications": 0, "shortlisted": 0, "selected": 0,
                "applications_by_month": [], "status_distribution": {"Applied":0,"Shortlisted":0,"Selected":0,"Rejected":0},
                "skills_verified": 0, "skills_unverified": 0}
    apps = db.query(Application).filter_by(candidate_id=user.id).all()

    # Monthly application counts (last 12 months)
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    months = []
    for i in range(11, -1, -1):
        # First day of each month going back 12 months
        month_date = (now.replace(day=1) - timedelta(days=i * 28)).replace(day=1)
        label = month_date.strftime("%b %Y")
        count = sum(
            1 for a in apps
            if a.created_at.year == month_date.year and a.created_at.month == month_date.month
        )
        months.append({"month": label, "count": count})

    # Status distribution — normalise to 4 canonical labels
    status_map = {
        "applied":       "Applied",
        "under_review":  "Applied",
        "shortlisted":   "Shortlisted",
        "interview":     "Shortlisted",
        "selected":      "Selected",
        "rejected":      "Rejected",
    }
    status_counts = {"Applied": 0, "Shortlisted": 0, "Selected": 0, "Rejected": 0}
    for a in apps:
        canonical = status_map.get(a.status.lower(), "Applied")
        status_counts[canonical] += 1

    # Skills breakdown
    profile = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    verified_count = 0
    unverified_count = 0
    if profile:
        skills = db.query(CandidateSkill).filter_by(candidate_id=profile.id).all()
        verified_count   = sum(1 for s in skills if s.verified)
        unverified_count = sum(1 for s in skills if not s.verified)

    return {
        # Legacy fields kept for backward compatibility
        "applications": len(apps),
        "shortlisted":  status_counts["Shortlisted"],
        "selected":     status_counts["Selected"],
        # New structured fields for charts
        "applications_by_month": months,
        "status_distribution":   status_counts,
        "skills_verified":       verified_count,
        "skills_unverified":     unverified_count,
    }


@router.get("/candidate/assessments")
def candidate_assessment_performance(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "candidate":
        return {"attempts": [], "proficiency": [], "total_attempts": 0, "skills_assessed": 0}
    """
    Return all assessment attempts for this candidate, enriched with skill
    name, plus the current proficiency (latest valid score + verification
    status) for each skill.

    Every attempt is a separate row — historical scores are never overwritten.
    """
    from datetime import datetime

    # ── All attempts (joined to Assessment → Skill for the language name) ──
    rows = (
        db.query(AssessmentAttempt, Assessment, Skill)
        .join(Assessment, Assessment.id == AssessmentAttempt.assessment_id)
        .join(Skill, Skill.id == Assessment.skill_id)
        .filter(AssessmentAttempt.candidate_id == user.id)
        .order_by(AssessmentAttempt.completed_at.asc())
        .all()
    )

    attempts = [
        {
            "id":             att.id,
            "assessment_id":  att.assessment_id,
            "skill_id":       skill.id,
            "skill_name":     skill.name,
            "score":          att.score,
            "level":          att.level,
            "completed_at":   att.completed_at.isoformat() if att.completed_at else None,
        }
        for att, asm, skill in rows
    ]

    # ── Current proficiency per skill ──────────────────────────────────────
    # The latest attempt per skill gives the "current" score; CandidateSkill
    # gives the verification status.
    profile = db.query(CandidateProfile).filter_by(user_id=user.id).first()

    # Build a map of skill_id → CandidateSkill row for verification info
    cs_map = {}
    if profile:
        cs_rows = db.query(CandidateSkill).filter_by(candidate_id=profile.id).all()
        cs_map = {cs.skill_id: cs for cs in cs_rows}

    # Find the latest attempt per skill_id
    latest_by_skill = {}  # skill_id → attempt dict
    for a in attempts:
        sid = a["skill_id"]
        if sid not in latest_by_skill:
            latest_by_skill[sid] = a
        else:
            # attempts are sorted ascending by completed_at, so later = more recent
            existing = latest_by_skill[sid]
            if a["completed_at"] and (not existing["completed_at"] or a["completed_at"] > existing["completed_at"]):
                latest_by_skill[sid] = a

    proficiency = []
    for sid, latest in latest_by_skill.items():
        cs = cs_map.get(sid)
        proficiency.append({
            "skill_id":        sid,
            "skill_name":      latest["skill_name"],
            "latest_score":    latest["score"],
            "latest_level":    latest["level"],
            "attempt_count":   sum(1 for a in attempts if a["skill_id"] == sid),
            "verified":        bool(cs.verified) if cs else False,
            "verified_at":     cs.verified_at.isoformat() if cs and cs.verified_at else None,
            "source":          cs.source if cs else None,
        })

    # Sort proficiency by latest_score descending
    proficiency.sort(key=lambda x: x["latest_score"], reverse=True)

    return {
        "attempts":     attempts,
        "proficiency":  proficiency,
        "total_attempts": len(attempts),
        "skills_assessed": len(proficiency),
    }
