from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app.auth.security import decode_access_token
from app.database import get_db
from app.models import User

def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(401, "Authentication required")
    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        raise HTTPException(401, "Invalid or expired session")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(401, "User account is inactive")
    return user

def require_roles(*roles):
    def dependency(current_user: User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(403, "Insufficient permissions")
        return current_user
    return dependency
