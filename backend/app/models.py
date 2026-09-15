from datetime import datetime

from sqlalchemy import (
    String,
    Text,
    DateTime,
    ForeignKey,
    Enum,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

import enum


class UserRole(str, enum.Enum):
    CANDIDATE = "candidate"
    EMPLOYER = "employer"
    TRAINING_INSTITUTE = "training_institute"
    ADMIN = "admin"


class ApplicationStatus(str, enum.Enum):
    APPLIED = "applied"
    SHORTLISTED = "shortlisted"
    REJECTED = "rejected"
    ACCEPTED = "accepted"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        primary_key=True,
        index=True
    )

    name: Mapped[str] = mapped_column(
        String(100)
    )

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True
    )

    password_hash: Mapped[str] = mapped_column(
        String(255)
    )

    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole),
        default=UserRole.CANDIDATE
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow
    )

    candidate_profile = relationship(
        "CandidateProfile",
        back_populates="user",
        uselist=False
    )

    apprenticeships = relationship(
        "Apprenticeship",
        back_populates="employer"
    )

    applications = relationship(
        "Application",
        back_populates="candidate"
    )


class CandidateProfile(Base):
    __tablename__ = "candidate_profiles"

    id: Mapped[int] = mapped_column(
        primary_key=True,
        index=True
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        unique=True
    )

    education: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    experience: Mapped[str | None] = mapped_column(
        Text,
        nullable=True
    )

    interests: Mapped[str | None] = mapped_column(
        Text,
        nullable=True
    )

    location: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    user = relationship(
        "User",
        back_populates="candidate_profile"
    )


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(
        primary_key=True,
        index=True
    )

    name: Mapped[str] = mapped_column(
        String(100),
        unique=True
    )


class CandidateSkill(Base):
    __tablename__ = "candidate_skills"

    id: Mapped[int] = mapped_column(
        primary_key=True,
        index=True
    )

    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("users.id")
    )

    skill_id: Mapped[int] = mapped_column(
        ForeignKey("skills.id")
    )

    __table_args__ = (
        UniqueConstraint(
            "candidate_id",
            "skill_id"
        ),
    )


class Apprenticeship(Base):
    __tablename__ = "apprenticeships"

    id: Mapped[int] = mapped_column(
        primary_key=True,
        index=True
    )

    employer_id: Mapped[int] = mapped_column(
        ForeignKey("users.id")
    )

    title: Mapped[str] = mapped_column(
        String(200)
    )

    description: Mapped[str] = mapped_column(
        Text
    )

    location: Mapped[str] = mapped_column(
        String(255)
    )

    employer = relationship(
        "User",
        back_populates="apprenticeships"
    )

    applications = relationship(
        "Application",
        back_populates="apprenticeship"
    )


class ApprenticeshipSkill(Base):
    __tablename__ = "apprenticeship_skills"

    id: Mapped[int] = mapped_column(
        primary_key=True,
        index=True
    )

    apprenticeship_id: Mapped[int] = mapped_column(
        ForeignKey("apprenticeships.id")
    )

    skill_id: Mapped[int] = mapped_column(
        ForeignKey("skills.id")
    )

    __table_args__ = (
        UniqueConstraint(
            "apprenticeship_id",
            "skill_id"
        ),
    )


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(
        primary_key=True,
        index=True
    )

    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("users.id")
    )

    apprenticeship_id: Mapped[int] = mapped_column(
        ForeignKey("apprenticeships.id")
    )

    status: Mapped[ApplicationStatus] = mapped_column(
        Enum(ApplicationStatus),
        default=ApplicationStatus.APPLIED
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow
    )

    candidate = relationship(
        "User",
        back_populates="applications"
    )

    apprenticeship = relationship(
        "Apprenticeship",
        back_populates="applications"
    )