from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models import User, Notification

router=APIRouter(prefix="/notifications",tags=["Notifications"])
@router.get("")
def notifications(user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    return db.query(Notification).filter_by(user_id=user.id).order_by(Notification.created_at.desc()).all()
@router.patch("/{notification_id}/read")
def mark_read(notification_id:int,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    row=db.query(Notification).filter_by(id=notification_id,user_id=user.id).first()
    if row: row.is_read=True; db.commit()
    return {"read":True}
