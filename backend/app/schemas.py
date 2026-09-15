from datetime import datetime
from pydantic import BaseModel, ConfigDict

from .models import UserRole, ApplicationStatus


class UserCreate(BaseModel):
    name: str
    email: str
    password: str
    role: UserRole = UserRole.CANDIDATE


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole

    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str


class CandidateProfileCreate(BaseModel):
    education: str | None = None
    experience: str | None = None
    interests: str | None = None
    location: str | None = None


class CandidateProfileResponse(CandidateProfileCreate):
    id: int
    user_id: int

    model_config = ConfigDict(from_attributes=True)


class SkillCreate(BaseModel):
    name: str


class SkillResponse(BaseModel):
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


class ApprenticeshipCreate(BaseModel):
    title: str
    description: str
    location: str


class ApprenticeshipResponse(BaseModel):
    id: int
    employer_id: int
    title: str
    description: str
    location: str

    model_config = ConfigDict(from_attributes=True)


class ApplicationCreate(BaseModel):
    apprenticeship_id: int


class ApplicationResponse(BaseModel):
    id: int
    candidate_id: int
    apprenticeship_id: int
    status: ApplicationStatus
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)