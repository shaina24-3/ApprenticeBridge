from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles
from app.database import get_db
from app.models import User, Apprenticeship, AuditLog

router=APIRouter(prefix="/admin",tags=["Admin"])

def log(db,actor,action,entity_type,entity_id=None,details=None):
    db.add(AuditLog(actor_id=actor.id,action=action,entity_type=entity_type,entity_id=entity_id,details=details)); db.commit()

@router.get("/users")
def users(user:User=Depends(require_roles("admin")),db:Session=Depends(get_db)):
    return db.query(User).order_by(User.created_at.desc()).all()

@router.patch("/users/{user_id}/deactivate")
def deactivate(user_id:int,user:User=Depends(require_roles("admin")),db:Session=Depends(get_db)):
    target=db.get(User,user_id)
    if not target: raise HTTPException(404,"User not found")
    target.is_active=False; db.commit(); log(db,user,"deactivate_user","user",target.id); return {"message":"User deactivated"}

@router.get("/listings")
def listings(user:User=Depends(require_roles("admin")),db:Session=Depends(get_db)):
    return db.query(Apprenticeship).order_by(Apprenticeship.created_at.desc()).all()

@router.patch("/listings/{listing_id}/deactivate")
def deactivate_listing(listing_id:int,user:User=Depends(require_roles("admin")),db:Session=Depends(get_db)):
    listing=db.get(Apprenticeship,listing_id)
    if not listing: raise HTTPException(404,"Listing not found")
    listing.status="deactivated"; db.commit(); log(db,user,"deactivate_listing","apprenticeship",listing.id); return {"message":"Listing deactivated"}

@router.get("/audit-logs")
def audit_logs(user:User=Depends(require_roles("admin")),db:Session=Depends(get_db)):
    return db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(200).all()
