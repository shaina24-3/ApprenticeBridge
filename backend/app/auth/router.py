import os
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models import User
from app.schemas import RegisterRequest, LoginRequest

router = APIRouter(prefix="/auth", tags=["Authentication"])
ALLOWED_ROLES = {"candidate", "employer", "training_institute"}

# ── Email / password ─────────────────────────────────────────────────────────

@router.post("/register")
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    if data.role not in ALLOWED_ROLES:
        raise HTTPException(400, "Invalid role. Must be candidate, employer, or training_institute.")
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(400, "Email already registered")
    user = User(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"message": "Registration successful", "user_id": user.id, "role": user.role}


@router.post("/login")
def login(data: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    if not user.is_active:
        raise HTTPException(403, "Account is inactive. Contact the administrator.")
    response.set_cookie(
        "access_token",
        create_access_token(user.id, user.role),
        httponly=True,
        secure=False,       # set True in production (HTTPS)
        samesite="lax",
        max_age=3600,
    )
    return {
        "message": "Login successful",
        "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role},
    }


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("access_token")
    return {"message": "Logout successful"}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "role": current_user.role,
        "is_active": current_user.is_active,
        "photo_url": current_user.photo_url,
    }


# ── Google OAuth ─────────────────────────────────────────────────────────────

class GoogleLoginRequest(BaseModel):
    id_token: str
    role: str = "candidate"  # used only when creating a new account


def _verify_firebase_token(id_token: str) -> dict:
    """
    Verify a Firebase ID token using firebase-admin SDK.
    Returns the decoded token dict with uid, email, name.

    Falls back gracefully with a clear error if firebase-admin
    is not installed or the project is not configured.
    """
    try:
        import firebase_admin
        from firebase_admin import auth as firebase_auth, credentials

        # Initialise the Firebase Admin SDK once
        if not firebase_admin._apps:
            # SERVICE_ACCOUNT_PATH is optional — if not set, uses Application
            # Default Credentials (works on GCP / Cloud Run automatically).
            sa_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
            if sa_path and os.path.exists(sa_path):
                cred = credentials.Certificate(sa_path)
            else:
                # Try Application Default Credentials
                cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred)

        decoded = firebase_auth.verify_id_token(id_token)
        return decoded

    except ImportError:
        raise HTTPException(
            501,
            "firebase-admin is not installed. "
            "Run: pip install firebase-admin==6.5.0"
        )
    except Exception as exc:
        raise HTTPException(401, f"Invalid Google token: {exc}")


@router.post("/google")
def google_login(
    data: GoogleLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Accept a Firebase ID token obtained from the frontend (signInWithPopup).
    Verify it server-side, create or find the user, set the HttpOnly JWT cookie.

    Role is only applied when creating a brand-new user.
    Existing users keep their stored role.
    """
    role = data.role if data.role in ALLOWED_ROLES else "candidate"

    decoded = _verify_firebase_token(data.id_token)
    email   = decoded.get("email")
    name    = decoded.get("name") or decoded.get("email", "").split("@")[0]

    if not email:
        raise HTTPException(400, "Google account must have an email address.")

    # Find or create user
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # New user — create with the role selected in the UI
        user = User(
            name=name,
            email=email,
            password_hash="",   # no password — Google-only account
            role=role,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif not user.is_active:
        raise HTTPException(403, "Account is inactive.")

    # Issue JWT cookie
    response.set_cookie(
        "access_token",
        create_access_token(user.id, user.role),
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=3600,
    )
    return {
        "message": "Google login successful",
        "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role},
    }
