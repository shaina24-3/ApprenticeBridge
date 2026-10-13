from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.database import Base, engine
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

# Allow the Next.js dev server to send credentials (HttpOnly cookie)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3002",   # fallback port when 3000 is occupied
        "http://127.0.0.1:3002",
    ],
    allow_credentials=True,   # Required for cookies to be sent cross-origin
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

# Serve uploaded files (photos, resumes, evidence)
import os
_storage_path = os.path.join(os.path.dirname(__file__), "..", "storage")
os.makedirs(os.path.join(_storage_path, "photos"), exist_ok=True)
app.mount("/storage", StaticFiles(directory=_storage_path), name="storage")

@app.get("/health")
def health(): return {"status":"ok","service":"ApprenticeBridge API","version":"2.0.0"}

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
