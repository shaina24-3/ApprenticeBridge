from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Request
from ..schemas import RequestCreate, RequestResponse

router = APIRouter(
    prefix="/requests",
    tags=["Requests"]
)


@router.post(
    "",
    response_model=RequestResponse
)
def create_request(
    request_data: RequestCreate,
    db: Session = Depends(get_db)
):
    new_request = Request(
        title=request_data.title,
        description=request_data.description
    )

    db.add(new_request)
    db.commit()
    db.refresh(new_request)

    return new_request


@router.get(
    "",
    response_model=list[RequestResponse]
)
def get_requests(
    db: Session = Depends(get_db)
):
    requests = db.query(Request).all()

    return requests