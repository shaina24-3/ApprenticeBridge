from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    CandidateProfile,
    UserRole
)
from ..schemas import (
    CandidateProfileCreate,
    CandidateProfileResponse
)
from ..auth_service import get_current_user, require_role


router = APIRouter(
    prefix="/candidate",
    tags=["Candidate"]
)


@router.post(
    "/profile",
    response_model=CandidateProfileResponse
)
def create_profile(
    profile_data: CandidateProfileCreate,
    db: Session = Depends(get_db),
    current_user=Depends(
        require_role(UserRole.CANDIDATE)
    )
):

    profile = CandidateProfile(
        user_id=current_user.id,
        **profile_data.model_dump()
    )

    db.add(profile)
    db.commit()
    db.refresh(profile)

    return profile


@router.get(
    "/profile",
    response_model=CandidateProfileResponse
)
def get_profile(
    db: Session = Depends(get_db),
    current_user=Depends(
        require_role(UserRole.CANDIDATE)
    )
):

    return db.query(CandidateProfile).filter(
        CandidateProfile.user_id == current_user.id
    ).first()