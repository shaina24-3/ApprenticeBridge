from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Application,
    Apprenticeship,
    UserRole
)
from ..schemas import (
    ApplicationCreate,
    ApplicationResponse
)
from ..auth_service import require_role


router = APIRouter(
    prefix="/applications",
    tags=["Applications"]
)


@router.post(
    "",
    response_model=ApplicationResponse
)
def apply(
    data: ApplicationCreate,
    db: Session = Depends(get_db),
    current_user=Depends(
        require_role(UserRole.CANDIDATE)
    )
):

    apprenticeship = db.get(
        Apprenticeship,
        data.apprenticeship_id
    )

    if not apprenticeship:

        raise HTTPException(
            status_code=404,
            detail="Apprenticeship not found"
        )

    application = Application(
        candidate_id=current_user.id,
        apprenticeship_id=data.apprenticeship_id
    )

    db.add(application)
    db.commit()
    db.refresh(application)

    return application


@router.get(
    "/mine",
    response_model=list[ApplicationResponse]
)
def get_my_applications(
    db: Session = Depends(get_db),
    current_user=Depends(
        require_role(UserRole.CANDIDATE)
    )
):

    return db.query(Application).filter(
        Application.candidate_id == current_user.id
    ).all()