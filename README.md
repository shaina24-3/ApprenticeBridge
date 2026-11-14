# ApprenticeBridge — PRD Backend

FastAPI + PostgreSQL backend implementing the core ApprenticeBridge PRD workflows.

## Roles
- Candidate
- Employer
- Training Institute
- Admin

## Core implemented backend areas
Authentication/RBAC, profiles, skill/trade/certification catalog, assessments/scoring, verified skills, evidence upload/review, apprenticeship CRUD/search, deterministic matching/explanations, applications/status workflow, saved listings, notifications, admin moderation/audit logs, analytics, completion records, resume metadata, ATS analysis, and bounded AI endpoints with deterministic fallbacks.

## Setup
1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `SECRET_KEY`.
2. Create/activate a Python 3.11 or 3.12 virtual environment.
3. Install: `pip install -r requirements.txt`
4. Create database `apprenticebridge` in PostgreSQL.
5. Seed: `python seed_data.py`
6. Admin: `python create_admin.py`
7. Run: `uvicorn app.main:app --reload`
8. Docs: `http://127.0.0.1:8000/docs`

## Important
This project uses SQLAlchemy `create_all` for the college MVP. For a production deployment, use Alembic migrations and a private object store for uploaded files.
