
import os
import logging

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import require_roles
from app.database import get_db
from app.models import User, CandidateProfile
from app.services.file_service import save_upload
from app.services.ats_model import analyze_resume as run_ats_analysis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/resume", tags=["Resume & ATS"])


class ResumeAnalyzeRequest(BaseModel):
    """Request body for ATS resume analysis."""
    text: str = Field(..., min_length=1, max_length=50000)
    job_description: str | None = Field(default=None, max_length=20000)


@router.post("")
def upload_resume(
    file: UploadFile = File(...),
    user: User = Depends(require_roles("candidate")),
    db: Session = Depends(get_db),
):
    """Upload and save a candidate's PDF resume."""
    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Resume must be a PDF",
        )

    path, checksum, size, name = save_upload(
        file,
        "storage/resumes",
        int(os.getenv("MAX_UPLOAD_MB", "25")),
    )

    profile = (
        db.query(CandidateProfile)
        .filter_by(user_id=user.id)
        .first()
    )

    if not profile:
        profile = CandidateProfile(user_id=user.id)
        db.add(profile)

    profile.resume_url = f"/{path}"
    profile.resume_filename = file.filename or name
    profile.resume_checksum = checksum

    db.commit()

    return {
        "filename": profile.resume_filename,
        "url": profile.resume_url,
        "checksum": checksum,
        "size_bytes": size,
    }


@router.post("/analyze")
def analyze_resume_endpoint(
    body: ResumeAnalyzeRequest,
    user: User = Depends(require_roles("candidate")),
):
    """
    Analyze resume skills, content quality, and job-description relevance.

    Uses a pretrained sentence-transformers model when a job description
    is provided. This endpoint does not make hiring decisions or verify skills.
    """
    if not body.text.strip():
        raise HTTPException(
            status_code=400,
            detail="Resume text cannot be empty.",
        )

    try:
        result = run_ats_analysis(
            resume_text=body.text,
            job_description=body.job_description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("ATS resume analysis failed")
        raise HTTPException(
            status_code=503,
            detail=(
                "Resume analysis is temporarily unavailable. "
                "Check the backend logs and model availability."
            ),
        ) from exc

    matched = result["matched_keywords"]
    recommendations = result["recommendations"]

    # Preserve the existing frontend's expected response fields.
    # This score represents skill coverage across the analyzer's skill list,
    # not resume quality or probability of getting hired.
    from app.services.ats_model import SKILLS

    result["ats_score"] = round(
        len(matched) / len(SKILLS) * 100,
        2,
    )

    result["missing_keywords"] = [
        skill for skill in SKILLS if skill not in matched
    ]

    result["recommendation"] = (
        " ".join(recommendations)
        if recommendations
        else "Your resume includes several useful signals. "
             "Review it against the specific role before applying."
    )

    # Keep the old field name available for frontend compatibility.
    if result.get("job_description_comparison") is not None:
        comparison = result["job_description_comparison"]

        result["jd_comparison"] = {
            "jd_keywords": comparison["job_description_skills"],
            "matched": comparison["matched_skills"],
            "missing": comparison["missing_skills"],
            "jd_match_score": comparison["skill_coverage_score"],
        }

    return result