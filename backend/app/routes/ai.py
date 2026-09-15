from fastapi import APIRouter

from ..services.ai_service import generate_assessment


router = APIRouter(
    prefix="/ai",
    tags=["AI"]
)


@router.post("/assessment")
def create_assessment(topic: str):

    return generate_assessment(topic)