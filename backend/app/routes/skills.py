from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Skill
from ..schemas import SkillCreate, SkillResponse


router = APIRouter(
    prefix="/skills",
    tags=["Skills"]
)


@router.post(
    "",
    response_model=SkillResponse
)
def create_skill(
    skill_data: SkillCreate,
    db: Session = Depends(get_db)
):

    skill = Skill(
        name=skill_data.name
    )

    db.add(skill)
    db.commit()
    db.refresh(skill)

    return skill


@router.get(
    "",
    response_model=list[SkillResponse]
)
def get_skills(
    db: Session = Depends(get_db)
):

    return db.query(Skill).all()