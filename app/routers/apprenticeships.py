from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.auth.dependencies import get_current_user, require_roles
from app.database import get_db
from app.models import User, Apprenticeship, ApprenticeshipSkill, ApprenticeshipCertification, Skill, Certification, CandidateProfile, CandidateSkill, CandidateCertification
from app.schemas import ApprenticeshipCreate
from app.services.matching_service import calculate_match

router = APIRouter(prefix="/apprenticeships", tags=["Apprenticeships"])

@router.post("")
def create_listing(data: ApprenticeshipCreate, user: User = Depends(require_roles("employer", "admin")), db: Session = Depends(get_db)):
    if data.status not in {"draft", "published"}: raise HTTPException(400, "Status must be draft or published")
    if data.status == "published" and (not data.title.strip() or not data.description.strip()): raise HTTPException(400, "Title and description are required")
    listing = Apprenticeship(employer_id=user.id, **{k:v for k,v in data.model_dump().items() if k not in {"required_skills","mandatory_certifications"}})
    db.add(listing); db.flush()
    for item in data.required_skills:
        skill_id = int(item["skill_id"]); level = item.get("required_level", "beginner"); mandatory = bool(item.get("mandatory", True))
        if not db.get(Skill, skill_id): raise HTTPException(404, f"Skill {skill_id} not found")
        db.add(ApprenticeshipSkill(apprenticeship_id=listing.id, skill_id=skill_id, required_level=level, mandatory=mandatory))
    for cert_id in data.mandatory_certifications:
        if not db.get(Certification, cert_id): raise HTTPException(404, f"Certification {cert_id} not found")
        db.add(ApprenticeshipCertification(apprenticeship_id=listing.id, certification_id=cert_id, mandatory=True))
    db.commit(); db.refresh(listing); return listing

@router.get("")
def list_listings(q: str | None = None, title: str | None = None, skill: str | None = None, location: str | None = None, work_mode: str | None = None, category: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    query = db.query(Apprenticeship).filter(Apprenticeship.status == "published")
    if q: query = query.filter((Apprenticeship.title.ilike(f"%{q}%")) | (Apprenticeship.description.ilike(f"%{q}%")))
    if title: query = query.filter(Apprenticeship.title.ilike(f"%{title}%"))
    if location: query = query.filter(Apprenticeship.location.ilike(f"%{location}%"))
    if work_mode: query = query.filter(Apprenticeship.work_mode == work_mode)
    if category: query = query.filter(Apprenticeship.category == category)
    rows = query.order_by(Apprenticeship.created_at.desc()).offset((page-1)*page_size).limit(page_size).all()
    if skill:
        ids = [s.id for s in db.query(Skill).filter(Skill.name.ilike(f"%{skill}%")).all()]
        if ids:
            listing_ids = {x.apprenticeship_id for x in db.query(ApprenticeshipSkill).filter(ApprenticeshipSkill.skill_id.in_(ids)).all()}
            rows = [r for r in rows if r.id in listing_ids]
        else: rows = []

    # Batch-load skills for ALL listings in one query (eliminates N+1)
    listing_ids = [r.id for r in rows]
    all_skills = {}
    if listing_ids:
        skill_rows = (
            db.query(ApprenticeshipSkill, Skill)
            .join(Skill, Skill.id == ApprenticeshipSkill.skill_id)
            .filter(ApprenticeshipSkill.apprenticeship_id.in_(listing_ids))
            .all()
        )
        for a, s in skill_rows:
            all_skills.setdefault(a.apprenticeship_id, []).append(
                {"skill_id": s.id, "name": s.name, "required_level": a.required_level, "mandatory": a.mandatory}
            )

    items = [{
        "id": listing.id,
        "employer_id": listing.employer_id,
        "title": listing.title,
        "description": listing.description,
        "category": listing.category,
        "location": listing.location,
        "work_mode": listing.work_mode,
        "education_requirement": listing.education_requirement,
        "experience_requirement": listing.experience_requirement,
        "interest_keywords": listing.interest_keywords,
        "status": listing.status,
        "created_at": listing.created_at,
        "required_skills": all_skills.get(listing.id, []),
    } for listing in rows]
    return {"page": page, "page_size": page_size, "items": items}

@router.get("/{listing_id}")
def get_listing(listing_id: int, db: Session = Depends(get_db)):
    listing = db.get(Apprenticeship, listing_id)
    if not listing or listing.status != "published": raise HTTPException(404, "Listing not found")
    skills = db.query(ApprenticeshipSkill, Skill).join(Skill, Skill.id == ApprenticeshipSkill.skill_id).filter(ApprenticeshipSkill.apprenticeship_id == listing_id).all()
    return {"listing": listing, "required_skills": [{"skill_id": s.id, "name": s.name, "required_level": a.required_level, "mandatory": a.mandatory} for a,s in skills]}

@router.put("/{listing_id}")
def update_listing(listing_id: int, data: ApprenticeshipCreate, user: User = Depends(require_roles("employer")), db: Session = Depends(get_db)):
    listing = db.get(Apprenticeship, listing_id)
    if not listing or listing.employer_id != user.id: raise HTTPException(404, "Listing not found")
    for k,v in data.model_dump().items():
        if k not in {"required_skills","mandatory_certifications"}: setattr(listing,k,v)
    db.query(ApprenticeshipSkill).filter_by(apprenticeship_id=listing.id).delete()
    db.query(ApprenticeshipCertification).filter_by(apprenticeship_id=listing.id).delete()
    for item in data.required_skills: db.add(ApprenticeshipSkill(apprenticeship_id=listing.id, skill_id=int(item["skill_id"]), required_level=item.get("required_level","beginner"), mandatory=bool(item.get("mandatory",True))))
    for cert_id in data.mandatory_certifications: db.add(ApprenticeshipCertification(apprenticeship_id=listing.id, certification_id=cert_id, mandatory=True))
    db.commit(); db.refresh(listing); return listing

@router.delete("/{listing_id}")
def delete_listing(listing_id: int, user: User = Depends(require_roles("employer")), db: Session = Depends(get_db)):
    listing = db.get(Apprenticeship, listing_id)
    if not listing or listing.employer_id != user.id: raise HTTPException(404, "Listing not found")
    db.delete(listing); db.commit(); return {"message":"Listing deleted"}

@router.get("/{listing_id}/match")
def listing_match(listing_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    listing = db.get(Apprenticeship, listing_id)
    if not listing or listing.status != "published":
        raise HTTPException(404, "Listing not found")
    # Only candidates have a profile to match against
    if user.role != "candidate":
        return {"score": 0, "eligible": False, "components": {}, "strong_matches": [], "partial_matches": [], "missing_skills": [], "hard_failures": [], "explanation": "Match scores are only available for candidate accounts.", "note": ""}
    profile = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if not profile:
        return {"score": 0, "eligible": False, "components": {}, "strong_matches": [], "partial_matches": [], "missing_skills": [], "hard_failures": [], "explanation": "Complete your candidate profile to see your match score.", "note": ""}
    req = db.query(ApprenticeshipSkill).filter_by(apprenticeship_id=listing.id).all()
    cs = db.query(CandidateSkill).filter_by(candidate_id=profile.id).all()
    certs = db.query(ApprenticeshipCertification).filter_by(apprenticeship_id=listing.id).all()
    ccerts = db.query(CandidateCertification).filter_by(candidate_id=profile.id).all()
    result = calculate_match(profile, listing, req, cs, [x.certification_id for x in certs if x.mandatory], ccerts)
    return {"listing_id": listing.id, **result}

@router.get("/recommended/me")
def recommended(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role != "candidate":
        return []
    profile = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if not profile: return []
    cs = db.query(CandidateSkill).filter_by(candidate_id=profile.id).all(); ccerts = db.query(CandidateCertification).filter_by(candidate_id=profile.id).all()

    # Bulk-load all published listings + their skills + certs (eliminates N+1)
    listings = db.query(Apprenticeship).filter(Apprenticeship.status == "published").all()
    if not listings:
        return []

    listing_ids = [l.id for l in listings]

    # One query for ALL skills across all listings
    all_req_rows = db.query(ApprenticeshipSkill).filter(ApprenticeshipSkill.apprenticeship_id.in_(listing_ids)).all()
    req_by_listing = {}
    for r in all_req_rows:
        req_by_listing.setdefault(r.apprenticeship_id, []).append(r)

    # One query for ALL certifications across all listings
    all_cert_rows = db.query(ApprenticeshipCertification).filter(ApprenticeshipCertification.apprenticeship_id.in_(listing_ids)).all()
    cert_by_listing = {}
    for c in all_cert_rows:
        cert_by_listing.setdefault(c.apprenticeship_id, []).append(c)

    # Compute matches in memory using pre-loaded data
    out = []
    for listing in listings:
        req = req_by_listing.get(listing.id, [])
        certs = cert_by_listing.get(listing.id, [])
        r = calculate_match(profile, listing, req, cs, [x.certification_id for x in certs if x.mandatory], ccerts)
        if r["eligible"]:
            out.append({"listing": listing, "match": r})

    return sorted(out, key=lambda x: x["match"]["score"], reverse=True)
