from datetime import datetime

from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Request(Base):
    __tablename__ = "requests"

    id: Mapped[int] = mapped_column(
        primary_key=True,
        index=True
    )

    title: Mapped[str] = mapped_column(
        String(200)
    )

    description: Mapped[str] = mapped_column(
        Text
    )

    status: Mapped[str] = mapped_column(
        String(50),
        default="pending"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow
    )