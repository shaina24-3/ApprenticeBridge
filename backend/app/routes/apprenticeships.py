from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Apprenticeship,
    UserRole
)
from ..schemas import (
    ApprenticeshipCreate,
    ApprenticeshipResponse
)
from ..auth_service import require_role


router = APIRouter(
    prefix="/apprenticeships",
    tags=["Apprenticeships"]
)


@router.post(
    "",
    response_model=ApprenticeshipResponse
)
def create_apprenticeship(
    data: ApprenticeshipCreate,
    db: Session = Depends(get_db),
    current_user=Depends(
        require_role(UserRole.EMPLOYER)
    )
):

    apprenticeship = Apprenticeship(
        employer_id=current_user.id,
        **data.model_dump()
    )

    db.add(apprenticeship)
    db.commit()
    db.refresh(apprenticeship)

    return apprenticeship


@router.get(
    "",
    response_model=list[ApprenticeshipResponse]
)
def get_apprenticeships(
    db: Session = Depends(get_db)
):

    return db.query(Apprenticeship).all()