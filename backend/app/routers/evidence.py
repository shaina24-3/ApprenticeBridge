import os
from datetime import datetime
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles
from app.database import get_db
from app.models import User, Evidence, Skill, CandidateProfile, CandidateSkill
from app.services.file_service import save_upload
from app.schemas import EvidenceReview

router=APIRouter(prefix="/evidence",tags=["Evidence"])

@router.post("")
def upload_evidence(skill_id:int=Form(...),file:UploadFile=File(...),user:User=Depends(require_roles("candidate")),db:Session=Depends(get_db)):
    if not db.get(Skill,skill_id): raise HTTPException(404,"Skill not found")
    path,checksum,size,name=save_upload(file,"storage/evidence",int(os.getenv("MAX_UPLOAD_MB","25")))
    row=Evidence(candidate_id=user.id,skill_id=skill_id,file_url=f"/{path}",original_filename=file.filename or name,content_type=file.content_type or "application/octet-stream",size_bytes=size,checksum=checksum)
    db.add(row); db.commit(); db.refresh(row); return row

@router.get("/mine")
def mine(user:User=Depends(require_roles("candidate")),db:Session=Depends(get_db)):
    return db.query(Evidence).filter_by(candidate_id=user.id).order_by(Evidence.created_at.desc()).all()

@router.post("/{evidence_id}/review")
def review(evidence_id:int,data:EvidenceReview,user:User=Depends(require_roles("training_institute","employer","admin")),db:Session=Depends(get_db)):
    if data.status not in {"under_review","approved","rejected"}: raise HTTPException(400,"Invalid evidence status")
    row=db.get(Evidence,evidence_id)
    if not row: raise HTTPException(404,"Evidence not found")
    row.status=data.status; row.reviewed_by=user.id; row.reviewed_at=datetime.utcnow()
    if data.status == "approved":
        profile = db.query(CandidateProfile).filter_by(user_id=row.candidate_id).first()
        if profile:
            candidate_skill = db.query(CandidateSkill).filter_by(candidate_id=profile.id, skill_id=row.skill_id).first()
            if candidate_skill:
                candidate_skill.verified = True
                candidate_skill.source = "human_verified"
                candidate_skill.verified_at = datetime.utcnow()
            else:
                db.add(CandidateSkill(candidate_id=profile.id, skill_id=row.skill_id, level="beginner", source="human_verified", verified=True, verified_at=datetime.utcnow()))
    db.commit(); return row
