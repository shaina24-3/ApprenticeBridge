from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles
from app.database import get_db
from app.models import Certification, CandidateProfile, CandidateCertification, User

router = APIRouter(prefix="/certifications", tags=["Certifications"])

class CertificationCreate(BaseModel):
    name: str
    description: str | None = None

class CandidateCertificationCreate(BaseModel):
    certification_id: int

@router.get("")
def list_certifications(db: Session = Depends(get_db)):
    return db.query(Certification).order_by(Certification.name).all()

@router.post("")
def create_certification(data: CertificationCreate, user: User = Depends(require_roles("admin", "training_institute")), db: Session = Depends(get_db)):
    if db.query(Certification).filter(Certification.name.ilike(data.name)).first():
        raise HTTPException(400, "Certification already exists")
    row = Certification(name=data.name, description=data.description)
    db.add(row); db.commit(); db.refresh(row)
    return row

@router.get("/me")
def my_certifications(user: User = Depends(require_roles("candidate")), db: Session = Depends(get_db)):
    profile = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if not profile: return []
    rows = db.query(CandidateCertification, Certification).join(Certification, Certification.id == CandidateCertification.certification_id).filter(CandidateCertification.candidate_id == profile.id).all()
    return [{"certification_id": c.id, "name": c.name, "verified": cc.verified} for cc, c in rows]

@router.post("/me")
def add_certification(data: CandidateCertificationCreate, user: User = Depends(require_roles("candidate")), db: Session = Depends(get_db)):
    cert = db.get(Certification, data.certification_id)
    if not cert: raise HTTPException(404, "Certification not found")
    profile = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if not profile: profile = CandidateProfile(user_id=user.id); db.add(profile); db.flush()
    row = db.query(CandidateCertification).filter_by(candidate_id=profile.id, certification_id=cert.id).first()
    if not row: row = CandidateCertification(candidate_id=profile.id, certification_id=cert.id, verified=False); db.add(row); db.commit()
    return {"certification_id": cert.id, "name": cert.name, "verified": row.verified}
