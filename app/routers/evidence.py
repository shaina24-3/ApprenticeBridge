import os
import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles, get_current_user
from app.database import get_db
from app.models import User, Evidence, Skill, CandidateProfile, CandidateSkill
from app.services.file_service import save_upload
from app.schemas import EvidenceReview

router = APIRouter(prefix="/evidence", tags=["Evidence"])


@router.post("")
def upload_evidence(
    skill_id: int = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(require_roles("candidate")),
    db: Session = Depends(get_db),
):
    if not db.get(Skill, skill_id):
        raise HTTPException(404, "Skill not found")
    path, checksum, size, name = save_upload(
        file, "storage/evidence", int(os.getenv("MAX_UPLOAD_MB", "25"))
    )
    row = Evidence(
        candidate_id=user.id,
        skill_id=skill_id,
        file_url=f"/{path}",
        original_filename=file.filename or name,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size,
        checksum=checksum,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    # Eagerly load skill name for the response
    skill = db.get(Skill, skill_id)
    return {
        "id": row.id,
        "file_url": row.file_url,
        "original_filename": row.original_filename,
        "content_type": row.content_type,
        "size_bytes": row.size_bytes,
        "status": row.status,
        "share_token": row.share_token,
        "created_at": row.created_at,
        "skill_id": skill_id,
        "skill_name": skill.name if skill else "",
    }


@router.get("/mine")
def mine(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role != "candidate": return []
    rows = (
        db.query(Evidence)
        .filter_by(candidate_id=user.id)
        .order_by(Evidence.created_at.desc())
        .all()
    )
    result = []
    for row in rows:
        skill = db.get(Skill, row.skill_id)
        result.append({
            "id": row.id,
            "file_url": row.file_url,
            "original_filename": row.original_filename,
            "content_type": row.content_type,
            "size_bytes": row.size_bytes,
            "status": row.status,
            "share_token": row.share_token,
            "created_at": row.created_at,
            "skill_id": row.skill_id,
            "skill_name": skill.name if skill else "",
        })
    return result


@router.post("/{evidence_id}/share")
def generate_share_link(
    evidence_id: int,
    user: User = Depends(require_roles("candidate")),
    db: Session = Depends(get_db),
):
    """Generate (or return existing) a shareable token for this evidence item."""
    row = db.get(Evidence, evidence_id)
    if not row:
        raise HTTPException(404, "Evidence not found")
    if row.candidate_id != user.id:
        raise HTTPException(403, "Not your evidence")
    if not row.share_token:
        row.share_token = secrets.token_urlsafe(32)
        db.commit()
        db.refresh(row)
    return {"share_token": row.share_token, "evidence_id": row.id}


@router.delete("/{evidence_id}/share")
def revoke_share_link(
    evidence_id: int,
    user: User = Depends(require_roles("candidate")),
    db: Session = Depends(get_db),
):
    """Revoke an existing share token."""
    row = db.get(Evidence, evidence_id)
    if not row:
        raise HTTPException(404, "Evidence not found")
    if row.candidate_id != user.id:
        raise HTTPException(403, "Not your evidence")
    row.share_token = None
    db.commit()
    return {"revoked": True}


@router.get("/shared/{token}")
def view_shared(token: str, db: Session = Depends(get_db)):
    """Public endpoint — no auth needed. Returns evidence metadata for the given share token."""
    row = db.query(Evidence).filter_by(share_token=token).first()
    if not row:
        raise HTTPException(404, "Share link not found or has been revoked")
    owner = db.get(User, row.candidate_id)
    skill = db.get(Skill, row.skill_id)
    return {
        "id": row.id,
        "original_filename": row.original_filename,
        "content_type": row.content_type,
        "file_url": row.file_url,
        "status": row.status,
        "created_at": row.created_at,
        "candidate_name": owner.name if owner else "Candidate",
        "skill_name": skill.name if skill else "",
    }


@router.post("/{evidence_id}/review")
def review(
    evidence_id: int,
    data: EvidenceReview,
    user: User = Depends(require_roles("training_institute", "employer", "admin")),
    db: Session = Depends(get_db),
):
    if data.status not in {"under_review", "approved", "rejected"}:
        raise HTTPException(400, "Invalid evidence status")
    row = db.get(Evidence, evidence_id)
    if not row:
        raise HTTPException(404, "Evidence not found")
    row.status = data.status
    row.reviewed_by = user.id
    row.reviewed_at = datetime.utcnow()
    if data.status == "approved":
        profile = db.query(CandidateProfile).filter_by(user_id=row.candidate_id).first()
        if profile:
            candidate_skill = db.query(CandidateSkill).filter_by(
                candidate_id=profile.id, skill_id=row.skill_id
            ).first()
            if candidate_skill:
                candidate_skill.verified = True
                candidate_skill.source = "human_verified"
                candidate_skill.verified_at = datetime.utcnow()
            else:
                db.add(CandidateSkill(
                    candidate_id=profile.id, skill_id=row.skill_id,
                    level="beginner", source="human_verified",
                    verified=True, verified_at=datetime.utcnow(),
                ))
    db.commit()
    return row
