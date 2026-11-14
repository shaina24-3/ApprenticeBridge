"""
Resume upload + ATS analysis router.

The analyze endpoint uses the semantic, role-based analysis engine in
app.services.ats_model to evaluate resumes against role-specific profiles
using Hugging Face sentence embeddings.
"""

import os
import logging

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import require_roles, get_current_user
from app.database import get_db
from app.models import User, CandidateProfile
from app.services.file_service import save_upload
from app.services.ats_model import analyze_resume as run_ats_analysis, get_available_roles

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/resume", tags=["Resume & ATS"])


class ResumeAnalyzeRequest(BaseModel):
    """Request body for semantic ATS resume analysis."""
    text: str = Field(..., min_length=1, max_length=50000)
    role: str = Field(default="general", description="Role key from ROLE_PROFILES, e.g. backend_engineer")
    job_description: str | None = Field(default=None, max_length=20000)


@router.get("/roles")
def list_roles():
    """Return the available role profiles for the frontend dropdown."""
    return {"roles": get_available_roles()}


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
    user: User = Depends(get_current_user),
):
    """
    Semantic, role-based ATS resume analysis.

    Uses Hugging Face sentence embeddings to evaluate the resume against a
    role-specific profile. Generates category scores, strengths, weaknesses,
    missing skills, and personalized recommendations.

    The optional job_description enables more targeted evaluation.
    """
    if not body.text.strip():
        raise HTTPException(
            status_code=400,
            detail="Resume text cannot be empty.",
        )

    try:
        result = run_ats_analysis(
            resume_text=body.text,
            role=body.role or "general",
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

    return result
