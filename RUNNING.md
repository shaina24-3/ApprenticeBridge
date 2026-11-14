# Running ApprenticeBridge Locally

## Prerequisites
- Python 3.10+ with pip
- Node.js 18+ with npm
- PostgreSQL running locally

---

## Quick Start (Recommended)

Run both servers at once from `c:\Users\DELL\Documents\`:

```powershell
.\start_apprenticebridge.ps1
```

This opens two terminal windows — backend on port 8000, frontend on port 3000.

---

## One-time Setup

### 1. PostgreSQL — create the database

Open the backend folder and run:

```powershell
cd "c:\Users\DELL\Documents\ApprenticeBridge-Backend-PRD 2\ApprenticeBridge-Backend-PRD 2"
.\setup_db.ps1
```

Enter your postgres superuser password when prompted.  
This creates the `apprenticebridge_user` role and `apprenticebridge` database.

### 2. Backend — seed data and create admin

```powershell
cd "c:\Users\DELL\Documents\ApprenticeBridge-Backend-PRD 2\ApprenticeBridge-Backend-PRD 2"

# Activate venv
c:\Users\DELL\Documents\ApprenticeBridge-Backend-PRD 2\venv311\Scripts\Activate.ps1

# Seed trades, skills, and sample data
python seed_data.py

# Create the admin account
python create_admin.py
```

### 3. Frontend — install packages (first time only)

```powershell
cd "c:\Users\DELL\Documents\ApprenticeBridge-Next 3\ApprenticeBridge-Next 3"
npm install
```

---

## Manual Start (if you prefer separate terminals)

### Terminal 1 — Backend

```powershell
cd "c:\Users\DELL\Documents\ApprenticeBridge-Backend-PRD 2\ApprenticeBridge-Backend-PRD 2"
c:\Users\DELL\Documents\ApprenticeBridge-Backend-PRD 2\venv311\Scripts\uvicorn.exe app.main:app --reload --port 8000
```

API: **http://localhost:8000**  
Swagger docs: **http://localhost:8000/docs**

### Terminal 2 — Frontend

```powershell
cd "c:\Users\DELL\Documents\ApprenticeBridge-Next 3\ApprenticeBridge-Next 3"
npm run dev
```

App: **http://localhost:3000**

---

## Login

Go to **http://localhost:3000** and sign in with:

| Role  | Email                    | Password         |
|-------|--------------------------|------------------|
| Admin | shainagarg419@gmail.com  | ShainaAdmin@2026 |

Or register a new account at **http://localhost:3000/auth/signup**.

---

## Notes

- The backend **must** be running before the frontend can authenticate.
- Auth uses FastAPI's HttpOnly cookie — no Firebase tokens required for email/password login.
- The frontend connects to the backend at `http://localhost:8000` (set in `.env.local`).
- To use Google sign-in, fill in the Firebase keys in `.env.local` and set `FIREBASE_SERVICE_ACCOUNT_PATH` in the backend `.env`.
- Database-dependent features require PostgreSQL to be running.
