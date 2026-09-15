import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine

from .routes import (
    health,
    auth_routes,
    candidates,
    skills,
    apprenticeships,
    applications,
    ai
)


logging.basicConfig(
    level=logging.INFO
)

logger = logging.getLogger(__name__)


Base.metadata.create_all(
    bind=engine
)


app = FastAPI(
    title="ApprenticeBridge API",
    version="1.0.0"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(health.router)
app.include_router(auth_routes.router)
app.include_router(candidates.router)
app.include_router(skills.router)
app.include_router(apprenticeships.router)
app.include_router(applications.router)
app.include_router(ai.router)


@app.get("/")
def root():

    return {
        "message": "Welcome to ApprenticeBridge API"
    }