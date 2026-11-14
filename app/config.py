"""
Centralized application configuration.
All environment variables are read here and exposed as typed settings.
This is the single source of truth for all config — no other file should call os.getenv directly.
"""
import os
from dotenv import load_dotenv

load_dotenv()


def _bool(val: str | None, default: bool = False) -> bool:
    if val is None:
        return default
    return val.lower() in ("1", "true", "yes", "on")


# ── Environment ──────────────────────────────────────────────────────────────
APP_ENV = os.getenv("APP_ENV", "development")  # development | production
IS_DEV = APP_ENV == "development"
IS_PROD = APP_ENV == "production"

# ── Database ───────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "")

# ── Security ────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

# Cookie settings — secure in production, not in development
COOKIE_SECURE = IS_PROD
COOKIE_SAMESITE = "lax"
COOKIE_MAX_AGE = ACCESS_TOKEN_EXPIRE_MINUTES * 60

# ── CORS ────────────────────────────────────────────────────────────────────
# Comma-separated list of allowed origins
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:3002,http://127.0.0.1:3002").split(",")
    if o.strip()
]

# ── Admin seed ─────────────────────────────────────────────────────────────
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@apprenticebridge.local")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

# ── Gemini AI ──────────────────────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")

# ── File uploads ────────────────────────────────────────────────────────────
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "25"))
STORAGE_ROOT = os.getenv("STORAGE_ROOT", os.path.join(os.path.dirname(__file__), "..", "storage"))

# ── Google OAuth (Firebase Admin) ──────────────────────────────────────────
FIREBASE_SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "")
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "")

# ── Rate limiting (requests per window) ────────────────────────────────────
RATE_LIMIT_LOGIN = os.getenv("RATE_LIMIT_LOGIN", "5/minute")
RATE_LIMIT_REGISTER = os.getenv("RATE_LIMIT_REGISTER", "3/minute")
RATE_LIMIT_AI = os.getenv("RATE_LIMIT_AI", "10/minute")
