import logging

from fastapi import FastAPI

from .database import Base, engine
from .routes import health, requests


logging.basicConfig(
    level=logging.INFO
)

logger = logging.getLogger(__name__)


Base.metadata.create_all(bind=engine)


app = FastAPI(
    title="ApprenticeBridge API",
    version="1.0.0"
)


app.include_router(health.router)
app.include_router(requests.router)


@app.get("/")
def root():
    return {
        "message": "Welcome to ApprenticeBridge API"
    }