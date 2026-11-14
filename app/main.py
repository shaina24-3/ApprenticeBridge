from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.database import Base, engine, SessionLocal
from app.config import ALLOWED_ORIGINS, IS_DEV, STORAGE_ROOT
from app.auth.router import router as auth_router
from app.routers.profiles import router as profiles_router
from app.routers.skills import router as skills_router
from app.routers.certifications import router as certifications_router
from app.routers.apprenticeships import router as apprenticeships_router
from app.routers.assessments import router as assessments_router
from app.routers.evidence import router as evidence_router
from app.routers.applications import router as applications_router
from app.routers.saved import router as saved_router
from app.routers.notifications import router as notifications_router
from app.routers.admin import router as admin_router
from app.routers.analytics import router as analytics_router
from app.routers.completion import router as completion_router
from app.routers.ai import router as ai_router
from app.routers.resume_ats import router as resume_router
from app.routers.requests import router as requests_router

app=FastAPI(title="ApprenticeBridge API",version="2.0.0",description="Apprenticeship Matching & Skill Verification Platform")

# CORS — origins read from env (ALLOWED_ORIGINS), methods/headers permissive
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

# Serve uploaded files (photos, resumes, evidence)
import os
os.makedirs(os.path.join(STORAGE_ROOT, "photos"), exist_ok=True)
os.makedirs(os.path.join(STORAGE_ROOT, "evidence"), exist_ok=True)
os.makedirs(os.path.join(STORAGE_ROOT, "resumes"), exist_ok=True)
app.mount("/storage", StaticFiles(directory=STORAGE_ROOT), name="storage")

@app.get("/health")
def health(): return {"status":"ok","service":"ApprenticeBridge API","version":"2.0.0"}

@app.get("/health/ready")
def health_ready():
    """DB-aware health check — verifies the database is actually reachable."""
    try:
        db = SessionLocal()
        db.execute(Base.metadata.tables.get("users", Base.metadata.tables.get("apprenticeships")).select().limit(1) if Base.metadata.tables else __import__("sqlalchemy").text("SELECT 1"))
        db.close()
        return {"status":"ok","database":"reachable"}
    except Exception as e:
        return {"status":"degraded","database":"unreachable","error":str(e)}

app.include_router(auth_router)
app.include_router(profiles_router)
app.include_router(skills_router)
app.include_router(certifications_router)
app.include_router(apprenticeships_router)
app.include_router(assessments_router)
app.include_router(evidence_router)
app.include_router(applications_router)
app.include_router(saved_router)
app.include_router(notifications_router)
app.include_router(admin_router)
app.include_router(analytics_router)
app.include_router(completion_router)
app.include_router(ai_router)
app.include_router(resume_router)
app.include_router(requests_router)
