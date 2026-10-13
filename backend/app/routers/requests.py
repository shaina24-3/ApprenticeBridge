from fastapi import APIRouter, Depends
from app.auth.dependencies import get_current_user
from app.models import User
router=APIRouter(prefix="/requests",tags=["Requests"])
@router.get("/me")
def requests_me(user:User=Depends(get_current_user)):
    return {"user_id":user.id,"message":"Request history endpoint ready."}
