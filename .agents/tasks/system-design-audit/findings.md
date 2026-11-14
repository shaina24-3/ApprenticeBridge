# ApprenticeBridge — System Design Audit (Findings)

**Mode:** READ-ONLY audit. No code modified.
**Scope:** Backend `ApprenticeBridge-Backend-PRD 2` (FastAPI + PostgreSQL + SQLAlchemy) and Frontend `ApprenticeBridge-Next 3` (Next.js 15 + React 19).
**Date:** Audit of working tree as-is.

---

## Executive summary

ApprenticeBridge is a well-scoped modular monolith with a clean RBAC model (candidate / employer / training_institute / admin), HttpOnly-cookie JWT auth, a deterministic explainable matching engine, a human-in-the-loop AI governance pattern, and a semantic ATS analyzer. The domain logic is sound and the project clearly states its MVP limitations in its README.

However, the codebase is **not yet production-ready**. The most serious issues, in priority order:

1. **Exposed API key + direct third-party calls from the browser.** A real Gemini API key is shipped to every client via `NEXT_PUBLIC_GEMINI_API_KEY`, and the frontend calls the Gemini REST API directly, bypassing the backend. Any visitor can extract and abuse the key.
2. **Auth-bypass fallback in Google OAuth.** If the Firebase env vars are unset, the backend decodes the Google ID token **without signature verification** and there is no environment guard, so a misconfigured production deploy lets anyone forge a JWT and assume any identity (including admin).
3. **Sensitive uploaded files are served publicly with no auth.** Resumes, evidence, and photos live under `/storage/*` mounted as `StaticFiles`; anyone with the URL reads candidate PII. The share-token mechanism is partially defeated because the underlying file is also public.
4. **No schema migrations.** The app uses `Base.metadata.create_all` on startup, which cannot evolve existing tables. The README acknowledges this; for production it blocks safe schema changes and risks data loss.
5. **Disconnected features on the frontend.** The completion-record flow fabricates a `Math.random()` hash client-side and never calls the backend `/completion` endpoint, and the admin "audit log" shown in the UI is partly fabricated client-side (`addAuditLog`), not persisted to the `audit_logs` table.
6. **Monolith frontend component.** `components/ApprenticeBridgeApp.jsx` is 5,022 lines / 284 KB holding ~30 components, all app state, all data fetching, and the AI calls.
7. **Missing indexes on almost every foreign-key / frequently-filtered column**, plus N+1 query loops in the listings and recommendation endpoints.
8. **No rate limiting, no security headers, hardcoded insecure cookie flags, no Docker/CI, no health check that verifies the DB, and only 3 unit tests** (matching service only).

---

## Summary table of findings

| # | Area | Finding | Severity |
|---|------|---------|----------|
| S1 | Security | Gemini API key exposed in client bundle; frontend calls Gemini directly | HIGH |
| S2 | Auth/Security | Google OAuth dev fallback decodes JWT without signature verification; no env guard | HIGH |
| S3 | File uploads | Resumes/evidence/photos served publicly via `StaticFiles` (no auth); PII exposure | HIGH |
| S4 | File uploads | Upload type validated only by client-supplied `content_type` (spoofable); ext from user filename | MEDIUM |
| S5 | Auth | Cookie `secure=False` hardcoded; not env-driven; no `HttpOnly`/`SameSite`/`Secure` policy | MEDIUM |
| S6 | Security | No rate limiting on any endpoint (login, register, AI, uploads) | MEDIUM |
| S7 | Security | No security response headers (HSTS, X-Frame-Options, CSP, X-Content-Type-Options) | MEDIUM |
| S8 | Security/CORS | CORS `allow_methods/headers/expose = ["*"]`; origins hardcoded to localhost; `FRONTEND_ORIGIN` env ignored | MEDIUM |
| S9 | RBAC | Evidence review open to any employer/training_institute/admin with no ownership scoping | MEDIUM |
| A1 | Architecture | Route handlers contain inline DB queries + business logic; no service/repository layer | MEDIUM |
| A2 | Architecture | Frontend is one 5,022-line mega-component with ~30 inline sub-components and 30+ `useState` | HIGH (maintainability) |
| A3 | Architecture | Matching logic duplicated: `calculateExplainableMatch` (frontend) vs `calculate_match` (backend) | MEDIUM |
| A4 | Architecture | Frontend audit log fabricated client-side (`addAuditLog`); completion flow never calls backend | HIGH (correctness/integrity) |
| D1 | Database | Schema managed via `create_all`; no Alembic / versioned migrations | HIGH |
| D2 | Database | Missing indexes on most FK + frequently-filtered columns (status, candidate_id, employer_id, etc.) | HIGH |
| D3 | Database | No explicit index on `Application.status`, `Apprenticeship.status/category/location` used in filters | HIGH |
| D4 | Database | Connection pool not tuned (`pool_size`, `max_overflow`, `pool_recycle`, `pool_timeout` unset); no `statement_timeout` | MEDIUM |
| D5 | Database | No explicit transactions/rollback handling for multi-step writes | LOW |
| P1 | Performance | N+1 query in `apprenticeships.list_listings` (skills query per listing) | MEDIUM |
| P2 | Performance | N+1 in `apprenticeships.recommended` (2 queries × every published listing, in-memory loop) | HIGH |
| P3 | Performance | N+1 in `evidence.mine` (`db.get(Skill)` per row) | MEDIUM |
| P4 | Performance | ATS model loaded lazily on first request (cold start blocks the single uvicorn worker) | MEDIUM |
| P5 | Performance | `ilike(f"%{q}%")` leading-wildcard LIKE prevents index use on search | MEDIUM |
| API1 | API design | Most list endpoints lack pagination (applications, users, notifications, skills, evidence, assessments) | MEDIUM |
| API2 | API design | Inconsistent response shapes (ORM objects vs custom dicts; create vs list differ) | MEDIUM |
| API3 | API design | No idempotency / duplicate-request protection beyond the unique application constraint | LOW |
| API4 | API design | No global error handler / standardized error envelope; uncaught exceptions leak default 500s | MEDIUM |
| API5 | API design | Non-MCQ assessment answers auto-pass (any non-empty text = correct), inflating scores | MEDIUM |
| E1 | Error handling | No centralized logging config / request logging / request IDs | MEDIUM |
| E2 | Error handling | `/health` returns static ok; does not verify DB connectivity | MEDIUM |
| C1 | Config | No dev/prod separation; secrets in local `.env` (gitignored — good) but no secret manager | MEDIUM |
| C2 | Config | `FRONTEND_ORIGIN` env defined but ignored; `.env.example` frontend port mismatch (8001 vs 8000) | LOW |
| C3 | Config | Unpinned deps in `requirements.txt` (`sentence-transformers`, `pypdf`, `python-docx`) | MEDIUM |
| C4 | Config | `python-jose` 3.4.0 (unmaintained, known advisories); consider PyJWT | MEDIUM |
| T1 | Testing | Only 3 tests (`test_matching.py`); no tests for auth, routers, schemas, uploads, ATS; no conftest/fixtures | HIGH |
| T2 | Testing | No test command config, no CI, no coverage gate | HIGH |
| DE1 | Deployment | No Dockerfile / docker-compose / CI / ASGI worker tuning; `start_backend.ps1` uses `--reload --host 0.0.0.0` | HIGH |
| DE2 | Deployment | No backup/migration/rollback runbook; no monitoring/observability hooks | MEDIUM |
| F1 | Dependencies | Frontend uses caret ranges; bundles pdfjs worker from a public CDN at runtime (supply-chain/offline risk) | MEDIUM |
| MISC | Code quality | `resume_ats.py.backup` committed; dead `BaseModel if False else object` line in `skills.py`; `datetime.utcnow()` deprecated | LOW |

---

## Detailed findings

### 1. Architecture & separation of concerns

**What exists.** Backend is split into `routers/`, `services/`, `auth/`, `models.py`, `schemas.py`, `database.py`. Two services exist: `matching_service.py` (pure deterministic matching) and `ats_model.py` (semantic ATS). `file_service.py` handles uploads. The `ai.py` router implements a deliberate "AI never decides / human review gate" pattern with deterministic fallbacks.

**Weaknesses.**
- **Business logic lives inside route handlers.** `app/routers/applications.py` (the `apply` endpoint, lines 9–23) is a single line of semicolon-chained DB queries, matching computation, inserts, and notification creation inline — no service layer. Same pattern in `apprenticeships.py` create/update, `completion.py`, `evidence.py` review. The matching service is the only business logic properly extracted. **Severity: MEDIUM.** Direction: move per-resource workflows (apply, complete, evidence review) into services so routers only do HTTP I/O.
- **DB operations are inline in routes.** Every router queries the ORM directly via `Depends(get_db)`. There is no repository/CRUD layer. **Severity: MEDIUM.**
- **Frontend is a monolith.** `components/ApprenticeBridgeApp.jsx` — 5,022 lines, 284 KB — defines the root app plus ~30 sub-components (`LandingPage`, `CandidateAnalyticsView`, `ATSResumeAnalyzerView`, `SkillPassportView`, `AuthModal`, `CandidateDashboardView`, `CandidateAssessmentsView`, `EmployerAssessmentsView`, `AdminDashboardView`, …) and holds all 30+ `useState` hooks and the master `useEffect` data fetch. **Severity: HIGH (maintainability).** Direction: split per-role and per-feature views into separate files/modules; introduce a data layer (React Query/SWR or a thin hook module) to replace the giant `data` prop.
- **Duplicated matching logic.** `ApprenticeBridgeApp.jsx:29` defines `calculateExplainableMatch(candidate, apprenticeship)` (client-side) while `app/services/matching_service.py` defines the authoritative `calculate_match`. Two sources of truth risk drift. **Severity: MEDIUM.** Direction: client should use the backend `/apprenticeships/{id}/match` result for the breakdown; keep the client function only as a thin no-network preview and document the limitation.
- **Fabricated audit trail & dead backend endpoint (frontend).** `addAuditLog` (`ApprenticeBridgeApp.jsx:363–373`) creates fake `id: "log-${Date.now()}"` entries prepended to local state for events like `APPLICATION_SUBMITTED`, `ASSENT_SUBMITTED`, `EVIDENCE_UPLOADED`, `AI_QUESTION_APPROVED`. The admin audit view then mixes real backend `AuditLog` rows (admin actions only) with these fabricated entries. Separately, the employer "Confirm Completion" handler (`ApprenticeBridgeApp.jsx:903–907`) builds `hash = \`RECORD_HASH_${Math.random()…}\`` and toasts success **without calling the backend `/completion` endpoint** (no `completion` helper exists in `lib/api.js`). The server-side tamper-evident `record_hash` (SHA-256, `completion.py`) is therefore never produced. **Severity: HIGH (correctness/integrity).** Direction: route these actions through the backend and persist audit events server-side; wire completion to the existing `/completion` endpoint.

### 2. Database

**What exists.** ~20 SQLAlchemy 2.0 models with sensible unique constraints (`uq_candidate_skill`, `uq_application`, `uq_saved_listing`, etc.), cascade `ondelete="CASCADE"` on profile→user, `record_hash` unique on `CompletionRecord`, `share_token` unique+indexed on `Evidence`. Engine uses `pool_pre_ping=True`.

**Weaknesses.**
- **No migration tooling.** `app/main.py` startup calls `Base.metadata.create_all(bind=engine)`; `seed_data.py` and `create_admin.py` do the same. `create_all` only creates missing tables — it cannot ALTER existing ones, so any column change on a populated table is silently skipped, risking schema drift and data loss. No Alembic directory exists anywhere. The README explicitly flags this as MVP-only. **Severity: HIGH.** Direction: introduce Alembic, autogenerate an initial baseline from current models, and switch startup off `create_all` in production.
- **Missing indexes on foreign keys.** PostgreSQL does **not** auto-index FK columns. Columns queried heavily but unindexed include: `Application.candidate_id` (`/applications/mine`, analytics), `Application.apprenticeship_id` (`/applications/listing/{id}`, employer/all), `Apprenticeship.employer_id` (employer stats, admin listings), `CandidateSkill.candidate_id` (`/skills/me`, matching), `AssessmentAttempt.candidate_id` + `assessment_id` (analytics), `Evidence.candidate_id` (`/evidence/mine`), `Notification.user_id`, `SavedListing.candidate_id`, `AuditLog.actor_id`, `CompletionRecord.*`. Only `User.email`, `User.role`, `Evidence.share_token`, `CompletionRecord.record_hash` are indexed. **Severity: HIGH.** Direction: add indexes on every FK and every filtered column (see next).
- **Missing indexes on filtered non-FK columns.** `Apprenticeship.status` (filtered in `list_listings`, `recommended`, `get_listing`), `Apprenticeship.category` / `location` / `work_mode` (search filters), `Application.status` (employer analytics). **Severity: HIGH.**
- **Connection pool not tuned.** `app/database.py` creates the engine with only `pool_pre_ping=True`; `pool_size` (default 5), `max_overflow`, `pool_recycle`, `pool_timeout` are unset, and there is no `statement_timeout` or `connect_args` keepalive. **Severity: MEDIUM.** Direction: tune pool size to expected concurrency and set a server-side `statement_timeout`.
- **No explicit transactions.** Multi-step writes (e.g., `apply` adds Application + Notification then commits) rely on a single commit with no `try/except/rollback`; a mid-flow `HTTPException` after `db.flush()` leaves the session in an error state without an explicit rollback. **Severity: LOW.**
- **`datetime.utcnow()` deprecation.** Used in model defaults and several routers; deprecated in Python 3.12 in favor of `datetime.now(timezone.utc)`. **Severity: LOW.**

### 3. API design

**What exists.** RESTful routers with prefixes/tags; Pydantic schemas for most inputs; one paginated endpoint (`/apprenticeships` with `page`/`page_size`, `Query(ge=1, le=50)`); unique constraint preventing duplicate applications.

**Weaknesses.**
- **Pagination is the exception.** Only `/apprenticeships` paginates. Unpaginated list endpoints include `/applications/mine`, `/applications/employer/all`, `/admin/users` (returns ALL users), `/admin/audit-logs` (only `limit(200)`), `/notifications`, `/skills`, `/evidence/mine`, `/assessments`, `/skills/me`. At scale these return unbounded result sets. **Severity: MEDIUM.** Direction: add `limit`/`offset` (or cursor) + total counts across all list endpoints.
- **Inconsistent response shapes.** `applications.py` `mine` returns ORM `Application` rows directly; `employer_applications` returns hand-built dicts; `apprenticeships.create_listing` returns the listing ORM (no `required_skills`) while `list_listings` returns dicts that include `required_skills`. No `response_model` is declared on most endpoints, so serialization depends on `jsonable_encoder` of arbitrary objects. **Severity: MEDIUM.** Direction: define Pydantic response models per endpoint and attach via `response_model`.
- **No idempotency keys.** Apply relies only on the unique constraint (409 on duplicate) — acceptable, but status updates and AI-draft saves have no idempotency protection against retried POSTs. **Severity: LOW.**
- **No standardized error envelope.** There is no global exception handler; errors are ad-hoc `HTTPException(detail=...)` strings. Uncaught exceptions surface FastAPI's default 500 (potentially with a traceback in dev). **Severity: MEDIUM.** Direction: add a global exception handler returning a consistent `{detail, code}` shape and a logging hook.
- **Assessment scoring weakness.** `assessments.py` submit (lines ~152–170) scores MCQs correctly but treats **any non-empty short/theory answer as correct** (`other_answered = sum(1 for q in other_qs if str(...).strip())`). This inflates scores and lets candidates "verify" skills by typing arbitrary text. **Severity: MEDIUM.** Direction: grade short/theory with the semantic ATS model or require manual review; at minimum flag non-MCQ as "pending review".
- **RBAC gap in assessment ownership view.** `/assessments/employer/mine` is gated to `employer`/`admin`, but `training_institute` can create assessments (`/assessments` create allows `training_institute`), so a training institute cannot list its own assessments through that route. **Severity: LOW.**

### 4. Authentication & security

**What exists.** Argon2 password hashing (`auth/security.py`), HS256 JWT in an `HttpOnly` cookie, `get_current_user` loads the user from the DB by `sub` (so RBAC reads the live DB role, not the token claim — good), `require_roles(*roles)` dependency, Firebase Admin for Google OAuth when configured.

**Weaknesses.**
- **Exposed Gemini key + direct browser-to-Gemini calls.** `NEXT_PUBLIC_GEMINI_API_KEY` is a `NEXT_PUBLIC_*` var, so it is embedded in the client bundle. The frontend calls Gemini directly at `ApprenticeBridgeApp.jsx:406, 442, 4174` (`https://generativelanguage.googleapis.com/.../gemini-3.8-flash:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`). Any visitor can extract the key from the shipped JS. The backend's own `/ai/*` routes (which have governance + fallbacks) are bypassed. **Severity: HIGH.** Direction: move all Gemini calls server-side behind `/ai/*`, revoke and rotate the leaked key, and remove `NEXT_PUBLIC_GEMINI_API_KEY`.
- **Google OAuth signature-bypass fallback.** `_verify_firebase_token` (`auth/router.py:84–119`) only does real `verify_id_token` when `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_PROJECT_ID` is set; otherwise (lines 120+) it base64-decodes the JWT payload **without verifying the signature** and trusts the `email`/`name` it finds. The comment says "never use in production" but there is **no environment guard** — if those env vars are absent in a deploy, an attacker can craft any JWT with any email (including an admin address) and authenticate as that user. **Severity: HIGH.** Direction: refuse the fallback unless `APP_ENV == "development"` (or a `ALLOW_UNVERIFIED_GOOGLE_TOKEN` flag), and hard-fail otherwise.
- **Insecure cookie hardcoded.** `auth/router.py:46–47` (login) and `:196–199` (Google) set `secure=False` with a "set True in production" comment, but it is not configurable. There is no `Secure`/`SameSite=strict` policy toggle. **Severity: MEDIUM.** Direction: drive `secure` from an env flag (true when not localhost).
- **No rate limiting.** Login, register, Google login, AI, and upload endpoints have no throttling. Brute-force and abuse are unmitigated. **Severity: MEDIUM.** Direction: add `slowapi` or a reverse-proxy limiter on auth and AI routes.
- **No security headers.** No middleware sets `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, or a `Content-Security-Policy`. **Severity: MEDIUM.**
- **CORS too broad / config ignored.** `main.py:17–27` sets `allow_methods=["*"]`, `allow_headers=["*"]`, `expose_headers=["*"]` and hardcodes localhost origins. The `FRONTEND_ORIGIN` env var (present in `.env.example` and `.env`) is never read. **Severity: MEDIUM.** Direction: read allowed origins from env and narrow methods/headers.
- **Evidence review over-permissive.** `evidence.review` (`evidence.py:120–143`) allows any `training_institute`, `employer`, or `admin` to approve any candidate's evidence with no ownership/association check; approving also auto-marks the candidate skill verified. An employer unaffiliated with a candidate can verify that candidate's skills. **Severity: MEDIUM.** Direction: scope reviewers to the candidate's institute/listing relationship.
- **Empty password hash for Google users.** `auth/router.py:169` creates Google users with `password_hash=""`. It is `nullable=False` so it passes, and `verify_password` against `""` raises (caught → False), so password login is correctly blocked, but storing an empty string is a smell. **Severity: LOW.** Direction: store a sentinel/NULL-able marker or a random unusable hash.
- **Hardcoded personal email in code.** `create_admin.py:11` defaults `ADMIN_EMAIL` to a personal Gmail address (`shainagarg419@gmail.com`). **Severity: LOW.** Direction: require it from env with no default.

### 5. Error handling

**Weaknesses.**
- **No centralized logging.** `logging.getLogger(__name__)` is used in `resume_ats.py` and `ats_model.py`, but no `basicConfig`/handler/format is configured anywhere; no request logging middleware; no request IDs/correlation. **Severity: MEDIUM.** Direction: configure structured logging and an access middleware.
- **Shallow health check.** `/health` (`main.py:38`) returns a static `{"status":"ok"}` without touching the DB, so it reports healthy during a DB outage. **Severity: MEDIUM.** Direction: add a `/health/ready` that opens a DB connection / runs `SELECT 1`.
- **Uncaught exceptions leak defaults.** Only the ATS route wraps in `try/except` (`resume_ats.py` analyze). Other routes let exceptions propagate to FastAPI's default handler. **Severity: MEDIUM.**

### 6. File uploads

**What exists.** `file_service.save_upload` validates `content_type` against an allowlist, enforces a size cap (default 25 MB via `MAX_UPLOAD_MB`), names files with `uuid4().hex + ext`, and computes a SHA-256 checksum. Photo upload (`profiles.py`) additionally deletes the previous photo.

**Weaknesses.**
- **Files served publicly with no auth.** `main.py` mounts `/storage` as `StaticFiles` over `storage/` (photos, resumes, evidence). Resumes and evidence are candidate PII, yet they are retrievable by URL with no authentication; the `share_token` "gate" only protects the metadata endpoint, not the bytes. UUID filenames make guessing hard but do not constitute access control. **Severity: HIGH.** Direction: serve uploads through an authenticated, authorization-checked endpoint (or a signed-URL object store) rather than `StaticFiles`.
- **Type check is client-supplied.** `file_service.py` and `resume_ats.py` trust `upload.content_type`, which the client sets and can spoof. The stored extension is taken from the user's filename (`Path(upload.filename).suffix`) with no cross-check against the declared content type and no magic-byte sniffing. **Severity: MEDIUM.** Direction: sniff content (e.g., `python-magic`/`filetype`) and validate the extension against the sniffed type.
- **No cleanup of replaced files.** Resume upload (`resume_ats.py:63–84`) overwrites `resume_url`/`resume_checksum` but never deletes the previous file, causing orphaned storage. **Severity: MEDIUM.** Direction: delete the old file on replace (as the photo path already does).
- **Storage path is CWD-relative.** `file_service.save_upload` writes to `Path(folder)` (e.g., `"storage/evidence"`) relative to the working directory; correctness depends on where uvicorn is launched. The photo path (`profiles.py`) computes an absolute path. Inconsistent and fragile. **Severity: LOW.** Direction: resolve an absolute, configurable storage root.

### 7. Performance

**Weaknesses.**
- **N+1 in listings.** `apprenticeships.list_listings` (`apprenticeships.py:30–55`) fetches the page, then for **each listing** runs a separate `ApprenticeshipSkill`/`Skill` join. With `page_size=50` that is 51 queries. The optional `skill` filter then post-filters in Python. **Severity: MEDIUM.** Direction: batch the skills for all page ids in one query.
- **N+1 in recommendations.** `apprenticeships.recommended` (`apprenticeships.py:99–106`) loops over **every** published listing and runs two queries per listing plus `calculate_match`, all in Python — O(listings) queries, unbounded. **Severity: HIGH.** Direction: preload all `ApprenticeshipSkill`/`ApprenticeshipCertification` in bulk and compute in memory (or cap/paginate).
- **N+1 in evidence listing.** `evidence.mine` (`evidence.py:60–78`) calls `db.get(Skill, row.skill_id)` per row. **Severity: MEDIUM.** Direction: join `Skill` once.
- **ATS cold start.** `ats_model.get_model` (`@lru_cache(maxsize=1)`, `ats_model.py:422–427`) loads `sentence-transformers/all-MiniLM-L6-v2` lazily on the first `/resume/analyze` call; the first request blocks the (single) uvicorn worker for download + load. **Severity: MEDIUM.** Direction: warm the model at startup or run analysis in a background worker.
- **Leading-wildcard LIKE.** Search uses `ilike(f"%{q}%")` (`apprenticeships.py:31–34`), so even with an index on `title`/`description` the leading `%` defeats it. **Severity: MEDIUM.** Direction: use trigram (`pg_trgm`) indexes for substring search or full-text search.

### 8. Configuration & environment

**Weaknesses.**
- **No dev/prod separation.** Cookie `secure`, CORS origins, and the Google fallback are hardcoded rather than env-driven; there is no `APP_ENV`/`DEBUG` toggle. `.env` (gitignored — good) holds real secrets locally; there is no secret-manager integration. **Severity: MEDIUM.**
- **Ignored / mismatched config.** `FRONTEND_ORIGIN` is defined in `.env.example`/`.env` but never read by `main.py`. Frontend `.env.example` advertises `NEXT_PUBLIC_API_URL=http://localhost:8001` while the backend runs on 8000 and `api.js` defaults to 8000 — a misleading example. **Severity: LOW.**
- **Unpinned Python deps.** `requirements.txt` pins most packages but leaves `sentence-transformers`, `pypdf`, `python-docx` unpinned (transitive torch version is then uncontrolled). **Severity: MEDIUM.** Direction: pin all versions.
- **Unmaintained security dep.** `python-jose==3.4.0` is unmaintained and carries advisories; PyJWT is the actively maintained alternative. **Severity: MEDIUM.**

### 9. Testing

**Weaknesses.**
- **Coverage is minimal.** The entire suite is `app/tests/test_matching.py` — 3 tests over `calculate_match`/`level_weight` using `SimpleNamespace`. There are no tests for auth (login/register/Google), any router, schemas, file uploads, the ATS engine, RBAC enforcement, or the N+1 paths. No `conftest.py`, no fixtures, no test-DB setup. **Severity: HIGH.** Direction: add a fixture-based test DB, router/client tests (FastAPI `TestClient`), and upload/auth tests.
- **No CI / coverage gate.** No GitHub Actions/CI config, no `pytest.ini`/`pyproject` test config, no coverage target. **Severity: HIGH.**

### 10. Deployment readiness

**Weaknesses.**
- **No containerization / CI / ASGI tuning.** There is no Dockerfile, docker-compose, CI workflow, or Makefile anywhere in the backend tree. The only run script, `start_backend.ps1`, launches `uvicorn app.main:app --reload --host 0.0.0.0` — `--reload` is a dev feature and `0.0.0.0` exposes the process to the network. No worker/process config (e.g., gunicorn + uvicorn workers), no reverse-proxy config, no TLS termination config. **Severity: HIGH.**
- **No backup/migration/observability runbook.** No documented backup strategy, no migration tooling (see D1), no metrics/tracing export, no log aggregation config. **Severity: MEDIUM.**

### 11. Dependencies

**Weaknesses.**
- **Frontend runtime CDN dependency.** `ApprenticeBridgeApp.jsx:1805` loads the pdf.js worker from `https://cdnjs.cloudflare.com/.../pdf.worker.min.mjs` at runtime — an external supply-chain dependency that also breaks offline. **Severity: MEDIUM.** Direction: bundle the worker locally (pdfjs-dist ships the worker asset).
- **Frontend caret ranges.** `package.json` uses `^` for all deps (mitigated by a committed `package-lock.json`); no `npm audit`/CI gate. **Severity: LOW.**
- **Heavy ML dependency in the API process.** `sentence-transformers` pulls PyTorch into the same process serving HTTP, coupling model memory to request serving. **Severity: MEDIUM** (relevant to P4).

### 12. Frontend architecture

(See also A2, A4, S1, F1.) Summary of the frontend-specific findings:
- `ApprenticeBridgeApp.jsx` (5,022 lines) is the entire authenticated app: root state, the role-dispatch `useEffect` (`:191–264`), the master `data` object passed to ~30 inline sub-components, the role-based render switches (`:760 CANDIDATE`, `:863 EMPLOYER`, `:947 ADMIN`), and the AI calls (`:400–460`). **Severity: HIGH (maintainability).**
- Data fetching is bespoke `Promise.all` per role with no caching, dedup, retry, or optimistic update; a tab switch does not refetch, but role change re-fetches everything. **Severity: MEDIUM.**
- Client-side PDF/DOCX text extraction (`extractResumeFileText`, `:1797–1825`) duplicates file parsing that the backend already imports `pypdf`/`python-docx` for; resume text is sent to the backend anyway. **Severity: LOW.**
- `NEXT_PUBLIC_API_URL` default in `lib/api.js` is `http://localhost:8000`; the `.env.example` shows `8001` (mismatch). `lib/api.js` has an 8 s default timeout (120 s for ATS) — reasonable, but errors return `{error, status}` rather than throwing, so every caller must remember to check `.error`. **Severity: LOW.**

---

## Conclusions and recommended direction (no solutions implemented)

The platform's domain design — RBAC, deterministic explainable matching, human-gated AI, ATS semantics — is solid and should be preserved. To reach production readiness without changing behavior, prioritize:

1. **Secrets & auth hardening (HIGH):** remove `NEXT_PUBLIC_GEMINI_API_KEY`, route all AI through the backend `/ai/*` routes, gate the Google OAuth unverified-decode fallback behind an explicit dev flag, and make the cookie `Secure` flag env-driven.
2. **Upload access control (HIGH):** stop serving resumes/evidence via public `StaticFiles`; serve through an auth-checked endpoint or signed URLs.
3. **Database (HIGH):** introduce Alembic migrations and add indexes on FK + filtered columns; tune the connection pool.
4. **Query performance (HIGH/MEDIUM):** eliminate the N+1 loops in `recommended`, `list_listings`, and `evidence.mine`; prewarm or background the ATS model.
5. **Frontend integrity (HIGH):** wire the completion flow to `/completion` and persist audit events server-side instead of fabricating them in the UI.
6. **API hardening (MEDIUM):** paginate all list endpoints, standardize the error envelope and response models, fix non-MCQ auto-pass scoring.
7. **Reliability (MEDIUM):** structured logging, request IDs, a DB-aware health check, rate limiting, and security headers.
8. **Deployment & tests (HIGH):** add Dockerfile/CI, replace `--reload` with a production ASGI setup, and build a real test suite (fixtures + `TestClient` across routers/auth/uploads).

These changes are additive and behavior-preserving: they tighten security, performance, and operability without altering the candidate/employer/institute/admin workflows, the matching algorithm, or the AI governance model.
