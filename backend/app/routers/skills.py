from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.auth.dependencies import get_current_user, require_roles
from app.database import get_db
from app.models import Skill, CandidateProfile, CandidateSkill, User
from app.schemas import SkillCreate, CandidateSkillCreate

router = APIRouter(prefix="/skills", tags=["Skills"])

@router.get("")
def list_skills(q: str | None = None, trade: str | None = None, skill_type: str | None = None, db: Session = Depends(get_db)):
    query = db.query(Skill)
    if q: query = query.filter(Skill.name.ilike(f"%{q}%"))
    if trade: query = query.filter(Skill.trade == trade)
    if skill_type: query = query.filter(Skill.skill_type == skill_type)
    return query.order_by(Skill.name).all()

@router.post("", dependencies=[Depends(require_roles("admin", "training_institute"))])
def create_skill(data: SkillCreate, db: Session = Depends(get_db)):
    if db.query(Skill).filter(Skill.name.ilike(data.name)).first(): raise HTTPException(400, "Skill already exists")
    skill = Skill(**data.model_dump()); db.add(skill); db.commit(); db.refresh(skill); return skill

@router.get("/me")
def my_skills(user: User = Depends(require_roles("candidate")), db: Session = Depends(get_db)):
    profile = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if not profile: return []
    rows = db.query(CandidateSkill, Skill).join(Skill, Skill.id == CandidateSkill.skill_id).filter(CandidateSkill.candidate_id == profile.id).all()
    return [{"skill_id": s.id, "name": s.name, "level": cs.level, "source": cs.source, "verified": cs.verified, "score": cs.score, "verified_at": cs.verified_at} for cs, s in rows]

@router.post("/me")
def add_my_skill(data: CandidateSkillCreate, user: User = Depends(require_roles("candidate")), db: Session = Depends(get_db)):
    profile = db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if not profile: profile = CandidateProfile(user_id=user.id); db.add(profile); db.flush()
    skill = db.get(Skill, data.skill_id)
    if not skill: raise HTTPException(404, "Skill not found")
    row = db.query(CandidateSkill).filter_by(candidate_id=profile.id, skill_id=data.skill_id).first()
    if row: row.level = data.level
    else: row = CandidateSkill(candidate_id=profile.id, skill_id=data.skill_id, level=data.level); db.add(row)
    db.commit(); db.refresh(row); return row
