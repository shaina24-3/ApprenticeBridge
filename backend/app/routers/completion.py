import hashlib, json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles
from app.database import get_db
from app.models import User, Application, Apprenticeship, CompletionRecord, Evidence, Skill
from app.schemas import CompletionCreate

router=APIRouter(prefix="/completion",tags=["Completion"])
@router.post("")
def complete(data:CompletionCreate,user:User=Depends(require_roles("employer")),db:Session=Depends(get_db)):
    app=db.get(Application,data.application_id)
    if not app: raise HTTPException(404,"Application not found")
    listing=db.get(Apprenticeship,app.apprenticeship_id)
    if not listing or listing.employer_id!=user.id: raise HTTPException(403,"Only the owning employer can confirm completion")
    evidence=db.query(Evidence).filter(Evidence.id.in_(data.evidence_ids)).all() if data.evidence_ids else []
    if any(e.candidate_id!=app.candidate_id or e.status!="approved" for e in evidence): raise HTTPException(400,"All completion evidence must belong to the candidate and be approved")
    payload={"application_id":app.id,"candidate_id":app.candidate_id,"employer_id":user.id,"skills":sorted(data.demonstrated_skill_ids),"evidence":sorted(data.evidence_ids),"timestamp":datetime.utcnow().isoformat()}
    record_hash=hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
    row=CompletionRecord(apprenticeship_id=listing.id,candidate_id=app.candidate_id,employer_id=user.id,demonstrated_skills=json.dumps(data.demonstrated_skill_ids),evidence_references=json.dumps(data.evidence_ids),record_hash=record_hash)
    db.add(row); app.status="selected"; db.commit(); db.refresh(row); return row
