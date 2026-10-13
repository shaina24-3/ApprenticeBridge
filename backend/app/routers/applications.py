from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles
from app.database import get_db
from app.models import User, Application, Apprenticeship, CandidateProfile, CandidateSkill, ApprenticeshipSkill, CandidateCertification, ApprenticeshipCertification, Notification
from app.schemas import ApplicationStatusUpdate
from app.services.matching_service import calculate_match

router=APIRouter(prefix="/applications",tags=["Applications"])

@router.post("/{listing_id}")
def apply(listing_id:int,user:User=Depends(require_roles("candidate")),db:Session=Depends(get_db)):
    listing=db.get(Apprenticeship,listing_id)
    if not listing or listing.status!="published": raise HTTPException(404,"Listing not found")
    if db.query(Application).filter_by(apprenticeship_id=listing_id,candidate_id=user.id).first(): raise HTTPException(409,"Already applied")
    profile=db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if not profile: raise HTTPException(400,"Complete your candidate profile first")
    req=db.query(ApprenticeshipSkill).filter_by(apprenticeship_id=listing_id).all(); cs=db.query(CandidateSkill).filter_by(candidate_id=profile.id).all(); certs=db.query(ApprenticeshipCertification).filter_by(apprenticeship_id=listing_id).all(); ccerts=db.query(CandidateCertification).filter_by(candidate_id=profile.id).all()
    match=calculate_match(profile,listing,req,cs,[x.certification_id for x in certs if x.mandatory],ccerts)
    app=Application(apprenticeship_id=listing_id,candidate_id=user.id,status="applied",match_score=match["score"]); db.add(app)
    db.add(Notification(user_id=listing.employer_id,title="New application",message=f"{user.name} applied to {listing.title}")); db.commit(); db.refresh(app)
    return {"application_id":app.id,"status":app.status,"match_score":app.match_score,"eligible":match["eligible"]}

@router.get("/mine")
def mine(user:User=Depends(require_roles("candidate")),db:Session=Depends(get_db)):
    return db.query(Application).filter_by(candidate_id=user.id).order_by(Application.created_at.desc()).all()

@router.get("/employer/all")
def employer_applications(user:User=Depends(require_roles("employer")),db:Session=Depends(get_db)):
    """Return all applications across all listings owned by this employer, enriched with candidate name and listing title."""
    listings = db.query(Apprenticeship).filter_by(employer_id=user.id).all()
    listing_ids = [l.id for l in listings]
    if not listing_ids:
        return []
    apps = db.query(Application).filter(Application.apprenticeship_id.in_(listing_ids)).order_by(Application.created_at.desc()).all()
    listing_map = {l.id: l for l in listings}
    candidate_map = {u.id: u for u in db.query(User).filter(User.id.in_([a.candidate_id for a in apps])).all()}
    return [
        {
            "id": a.id,
            "apprenticeship_id": a.apprenticeship_id,
            "candidate_id": a.candidate_id,
            "status": a.status,
            "match_score": a.match_score,
            "created_at": a.created_at,
            "listing_title": listing_map[a.apprenticeship_id].title if a.apprenticeship_id in listing_map else "",
            "candidate_name": candidate_map[a.candidate_id].name if a.candidate_id in candidate_map else "Unknown",
            "candidate_email": candidate_map[a.candidate_id].email if a.candidate_id in candidate_map else "",
        }
        for a in apps
    ]

@router.get("/listing/{listing_id}")
def applicants(listing_id:int,user:User=Depends(require_roles("employer")),db:Session=Depends(get_db)):
    listing=db.get(Apprenticeship,listing_id)
    if not listing or listing.employer_id!=user.id: raise HTTPException(404,"Listing not found")
    return db.query(Application).filter_by(apprenticeship_id=listing_id).order_by(Application.match_score.desc()).all()

@router.patch("/{application_id}/status")
def update_status(application_id:int,data:ApplicationStatusUpdate,user:User=Depends(require_roles("employer")),db:Session=Depends(get_db)):
    allowed={"under_review","shortlisted","selected","rejected","interview"}
    if data.status not in allowed: raise HTTPException(400,"Invalid application status")
    app=db.get(Application,application_id)
    listing=db.get(Apprenticeship,app.apprenticeship_id) if app else None
    if not app or not listing or listing.employer_id!=user.id: raise HTTPException(404,"Application not found")
    app.status=data.status
    db.add(Notification(user_id=app.candidate_id,title="Application status updated",message=f"Your application for {listing.title} is now {data.status}.")); db.commit(); db.refresh(app); return app
