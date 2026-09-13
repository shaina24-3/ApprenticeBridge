from datetime import datetime

from pydantic import BaseModel


class RequestCreate(BaseModel):
    title: str
    description: str


class RequestResponse(BaseModel):
    id: int
    title: str
    description: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True