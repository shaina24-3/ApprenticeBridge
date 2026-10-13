import os, hashlib, shutil, uuid
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles, get_current_user
from app.database import get_db
from app.models import User, CandidateProfile, EmployerProfile, InstituteProfile, CandidateSkill, Skill
from app.schemas import ProfileUpdate, EmployerProfileUpdate, InstituteProfileUpdate

router = APIRouter(tags=["Profiles"])

PHOTOS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "storage", "photos")
os.makedirs(PHOTOS_DIR, exist_ok=True)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_PHOTO_MB = 5

# ── Photo upload (shared by both roles) ────────────────────────────────────

@router.post("/profile/photo")
async def upload_photo(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Only JPEG, PNG, WebP or GIF images are allowed.")
    contents = await file.read()
    if len(contents) > MAX_PHOTO_MB * 1024 * 1024:
        raise HTTPException(400, f"Photo must be under {MAX_PHOTO_MB} MB.")

    # Delete old photo file if it exists
    if user.photo_url:
        old_path = os.path.join(PHOTOS_DIR, os.path.basename(user.photo_url))
        if os.path.exists(old_path):
            os.remove(old_path)

    ext = (file.filename or "photo.jpg").rsplit(".", 1)[-1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"
    dest = os.path.join(PHOTOS_DIR, filename)
    with open(dest, "wb") as f:
        f.write(contents)

    user.photo_url = f"/storage/photos/{filename}"
    db.commit()
    return {"photo_url": user.photo_url}

# ── Candidate ───────────────────────────────────────────────────────────────

@router.get("/candidates/me")
def get_candidate_profile(user: User = Depends(require_roles("candidate")), db: Session = Depends(get_db)):
    p = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    base = {
        "user_id": user.id,
        "name": user.name,
        "photo_url": user.photo_url,
        "education": None, "interests": None, "experience": None, "trades": None, "location": None,
    }
    if p:
        base.update({
            "education": p.education, "interests": p.interests, "experience": p.experience,
            "trades": p.trades, "location": p.location,
        })
    return base

@router.put("/candidates/me")
def update_candidate_profile(data: ProfileUpdate, user: User = Depends(require_roles("candidate")), db: Session = Depends(get_db)):
    # Update name on User row if provided
    if data.name and data.name.strip():
        user.name = data.name.strip()

    p = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if not p:
        p = CandidateProfile(user_id=user.id)
        db.add(p)

    profile_fields = {"education", "interests", "experience", "trades", "location"}
    for k, v in data.model_dump().items():
        if k in profile_fields:
            setattr(p, k, v)

    db.commit()
    db.refresh(p)
    return {
        "user_id": user.id, "name": user.name, "photo_url": user.photo_url,
        "education": p.education, "interests": p.interests, "experience": p.experience,
        "trades": p.trades, "location": p.location,
    }

# ── Candidate skills (add / delete) ────────────────────────────────────────

@router.delete("/skills/me/{skill_id}", status_code=204)
def remove_my_skill(skill_id: int, user: User = Depends(require_roles("candidate")), db: Session = Depends(get_db)):
    profile = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if not profile:
        raise HTTPException(404, "Profile not found")
    row = db.query(CandidateSkill).filter_by(candidate_id=profile.id, skill_id=skill_id).first()
    if not row:
        raise HTTPException(404, "Skill not found on your profile")
    db.delete(row)
    db.commit()

# ── Employer ────────────────────────────────────────────────────────────────

@router.get("/employers/me")
def get_employer_profile(user: User = Depends(require_roles("employer")), db: Session = Depends(get_db)):
    p = db.query(EmployerProfile).filter_by(user_id=user.id).first()
    base = {"user_id": user.id, "name": user.name, "photo_url": user.photo_url}
    if p:
        base.update({
            "company_name": p.company_name, "description": p.description,
            "location": p.location, "website": p.website,
        })
    return base

@router.put("/employers/me")
def update_employer_profile(data: EmployerProfileUpdate, user: User = Depends(require_roles("employer")), db: Session = Depends(get_db)):
    if data.name and data.name.strip():
        user.name = data.name.strip()

    p = db.query(EmployerProfile).filter_by(user_id=user.id).first()
    if not p:
        p = EmployerProfile(user_id=user.id, company_name=data.company_name)
        db.add(p)

    employer_fields = {"company_name", "description", "location", "website"}
    for k, v in data.model_dump().items():
        if k in employer_fields:
            setattr(p, k, v)

    db.commit()
    db.refresh(p)
    return {
        "user_id": user.id, "name": user.name, "photo_url": user.photo_url,
        "company_name": p.company_name, "description": p.description,
        "location": p.location, "website": p.website,
    }

# ── Institute ───────────────────────────────────────────────────────────────

@router.get("/institutes/me")
def get_institute_profile(user: User = Depends(require_roles("training_institute")), db: Session = Depends(get_db)):
    p = db.query(InstituteProfile).filter_by(user_id=user.id).first()
    return p or {"user_id": user.id}

@router.put("/institutes/me")
def update_institute_profile(data: InstituteProfileUpdate, user: User = Depends(require_roles("training_institute")), db: Session = Depends(get_db)):
    p = db.query(InstituteProfile).filter_by(user_id=user.id).first()
    if not p: p = InstituteProfile(user_id=user.id); db.add(p)
    for k, v in data.model_dump().items(): setattr(p, k, v)
    db.commit(); db.refresh(p); return p
