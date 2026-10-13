from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, ConfigDict

class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    education: str | None = None
    interests: str | None = None
    experience: str | None = None
    trades: str | None = None
    location: str | None = None

class EmployerProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    company_name: str = Field(min_length=2, max_length=200)
    description: str | None = None
    location: str | None = None
    website: str | None = None

class InstituteProfileUpdate(BaseModel):
    institute_name: str = Field(min_length=2, max_length=200)
    description: str | None = None
    location: str | None = None

class SkillCreate(BaseModel):
    name: str
    category: str | None = None
    trade: str | None = None
    skill_type: str = "skill"

class CandidateSkillCreate(BaseModel):
    skill_id: int
    level: str

class ApprenticeshipCreate(BaseModel):
    title: str
    description: str
    category: str | None = None
    location: str | None = None
    work_mode: str | None = None
    education_requirement: str | None = None
    interest_keywords: str | None = None
    experience_requirement: str | None = None
    status: str = "draft"
    required_skills: list[dict] = Field(default_factory=list)
    mandatory_certifications: list[int] = Field(default_factory=list)

class ApplicationStatusUpdate(BaseModel):
    status: str

class AssessmentCreate(BaseModel):
    skill_id: int
    title: str
    description: str | None = None
    status: str = "draft"
    questions: list[dict]

class AssessmentSubmit(BaseModel):
    answers: dict[int, str]

class EvidenceReview(BaseModel):
    status: str

class CompletionCreate(BaseModel):
    application_id: int
    demonstrated_skill_ids: list[int]
    evidence_ids: list[int] = Field(default_factory=list)

class AIDraftRequest(BaseModel):
    skill_id: int
    trade: str
    count: int = Field(default=5, ge=1, le=10)

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: EmailStr
    role: str
    is_active: bool

class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    message: str
    is_read: bool
    created_at: datetime
