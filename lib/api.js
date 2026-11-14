/**
 * lib/api.js
 * Central API client for ApprenticeBridge.
 *
 * All requests go to the FastAPI backend at http://localhost:8000.
 * The backend sets an HttpOnly cookie (access_token) on login.
 * credentials: "include" is required on every request so that cookie
 * is sent automatically by the browser.
 *
 * No API key, no Firebase, no localStorage tokens.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Core fetch wrapper.
 * - Always sends credentials (cookie).
 * - 8-second timeout so a downed backend never hangs the UI.
 * - On 401, returns { error: "...", status: 401 } without throwing.
 * - On any other non-2xx, returns { error: message, status: N }.
 * - On success, returns the parsed JSON body.
 */
async function apiFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  // Allow custom timeout (default 8s; AI/ML endpoints may need 2+ minutes)
  const timeoutMs = options.timeoutMs || 8000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Remove timeoutMs from options so it doesn't leak into fetch config
  const { timeoutMs: _omit, ...fetchOptions } = options;
  const config = {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...fetchOptions.headers },
    signal: controller.signal,
    ...fetchOptions,
  };

  if (options.body instanceof FormData) {
    delete config.headers["Content-Type"];
  }

  try {
    const res = await fetch(url, config);
    clearTimeout(timeout);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text };
    }

    if (!res.ok) {
      const message =
        data?.detail ||
        data?.message ||
        `Request failed with status ${res.status}`;

      // On 401: session expired — caller should redirect to login
      // On 403: role mismatch — provide a clear, actionable message
      if (res.status === 403) {
        return {
          error: "You don't have permission to perform this action. Make sure you're signed in with the correct account type for this feature.",
          status: 403,
          detail: message,
        };
      }

      return { error: message, status: res.status };
    }

    return data;
  } catch (networkError) {
    clearTimeout(timeout);
    const isTimeout = networkError.name === "AbortError";
    return {
      error: isTimeout
        ? `Request timed out after ${timeoutMs / 1000}s. The AI model may still be loading — try again in a moment.`
        : "Cannot reach the server. Make sure the backend is running on port 8000.",
      status: 0,
    };
  }
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export const authApi = {
  /** Register a new user. Role must be candidate | employer | training_institute */
  register: (name, email, password, role) =>
    apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, role }),
    }),

  /** Login — backend sets HttpOnly cookie on success */
  login: (email, password) =>
    apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  /**
   * Google OAuth — send Firebase ID token to backend.
   * Backend verifies the token, creates/fetches the user, sets the cookie.
   * role is only used on first sign-in to assign the account type.
   */
  googleLogin: (idToken, role = "candidate") =>
    apiFetch("/auth/google", {
      method: "POST",
      body: JSON.stringify({ id_token: idToken, role }),
    }),

  /** Logout — backend deletes the cookie */
  logout: () => apiFetch("/auth/logout", { method: "POST" }),

  /** Check who is currently logged in (reads the cookie) */
  me: () => apiFetch("/auth/me"),
};

// ─── Skills ────────────────────────────────────────────────────────────────

export const skillsApi = {
  list: (q = "", trade = "") =>
    apiFetch(`/skills?q=${encodeURIComponent(q)}&trade=${encodeURIComponent(trade)}`),

  mySkills: () => apiFetch("/skills/me"),

  addSkill: (skill_id, level) =>
    apiFetch("/skills/me", {
      method: "POST",
      body: JSON.stringify({ skill_id, level }),
    }),

  // Add a skill by name — auto-creates the skill in the catalog if it doesn't exist
  addSkillByName: (name, level, category = "General", trade = "General") =>
    apiFetch("/skills/me/by-name", {
      method: "POST",
      body: JSON.stringify({ name, level, category, trade }),
    }),

  removeSkill: (skill_id) =>
    apiFetch(`/skills/me/${skill_id}`, { method: "DELETE" }),
};

// ─── Apprenticeships ───────────────────────────────────────────────────────

export const apprenticeshipsApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/apprenticeships${qs ? "?" + qs : ""}`);
  },

  get: (id) => apiFetch(`/apprenticeships/${id}`),

  recommended: () => apiFetch("/apprenticeships/recommended/me"),

  match: (id) => apiFetch(`/apprenticeships/${id}/match`),

  create: (data) =>
    apiFetch("/apprenticeships", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// ─── Applications ──────────────────────────────────────────────────────────

export const applicationsApi = {
  apply: (listingId) =>
    apiFetch(`/applications/${listingId}`, { method: "POST" }),

  mine: () => apiFetch("/applications/mine"),

  forEmployer: () => apiFetch("/applications/employer/all"),

  forListing: (listingId) =>
    apiFetch(`/applications/listing/${listingId}`),

  updateStatus: (applicationId, status) =>
    apiFetch(`/applications/${applicationId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
};

// ─── Evidence ──────────────────────────────────────────────────────────────

export const evidenceApi = {
  mine: () => apiFetch("/evidence/mine"),

  upload: (skillId, file) => {
    const form = new FormData();
    form.append("skill_id", skillId);
    form.append("file", file);
    return apiFetch("/evidence", { method: "POST", body: form });
  },

  // Generate a public share link for an evidence item
  share: (evidenceId) =>
    apiFetch(`/evidence/${evidenceId}/share`, { method: "POST" }),

  // Revoke an existing share link
  revokeShare: (evidenceId) =>
    apiFetch(`/evidence/${evidenceId}/share`, { method: "DELETE" }),

  // Fetch a shared evidence item by token (public, no auth needed)
  viewShared: (token) => apiFetch(`/evidence/shared/${token}`),

  review: (evidenceId, status) =>
    apiFetch(`/evidence/${evidenceId}/review`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
};

// ─── Assessments ───────────────────────────────────────────────────────────

export const assessmentsApi = {
  list: () => apiFetch("/assessments"),
  get: (id) => apiFetch(`/assessments/${id}`),
  mine: () => apiFetch("/assessments/employer/mine"),
  myAttempts: () => apiFetch("/assessments/my-attempts"),
  create: (data) =>
    apiFetch("/assessments", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) =>
    apiFetch(`/assessments/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id) =>
    apiFetch(`/assessments/${id}`, { method: "DELETE" }),
  submit: (assessmentId, answers) =>
    apiFetch(`/assessments/${assessmentId}/submit`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),
};

// ─── Notifications ─────────────────────────────────────────────────────────

export const notificationsApi = {
  list: () => apiFetch("/notifications"),
  markRead: (id) =>
    apiFetch(`/notifications/${id}/read`, { method: "PATCH" }),
};

// ─── Analytics ─────────────────────────────────────────────────────────────

export const analyticsApi = {
  candidate: () => apiFetch("/analytics/candidate"),
  employer: () => apiFetch("/analytics/employer"),
  admin: () => apiFetch("/analytics/admin"),
  // Assessment performance: all attempts + current proficiency per skill
  candidateAssessments: () => apiFetch("/analytics/candidate/assessments"),
};

// ─── Profile ───────────────────────────────────────────────────────────────

export const profilesApi = {
  getCandidateProfile: () => apiFetch("/candidates/me"),
  updateCandidateProfile: (data) =>
    apiFetch("/candidates/me", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getEmployerProfile: () => apiFetch("/employers/me"),
  updateEmployerProfile: (data) =>
    apiFetch("/employers/me", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  uploadPhoto: (file) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch("/profile/photo", { method: "POST", body: form });
  },
};

// ─── Saved listings ────────────────────────────────────────────────────────

export const savedApi = {
  list: () => apiFetch("/saved"),
  save: (listingId) =>
    apiFetch(`/saved/${listingId}`, { method: "POST" }),
  unsave: (listingId) =>
    apiFetch(`/saved/${listingId}`, { method: "DELETE" }),
};

// ─── Admin ─────────────────────────────────────────────────────────────────

export const adminApi = {
  users: () => apiFetch("/admin/users"),
  deactivateUser: (id) =>
    apiFetch(`/admin/users/${id}/deactivate`, { method: "PATCH" }),
  listings: () => apiFetch("/admin/listings"),
  auditLogs: () => apiFetch("/admin/audit-logs"),
};

// ─── Resume / ATS ────────────────────────────────────────────────────────────

export const resumeApi = {
  // Get available role profiles for the dropdown
  getRoles: () => apiFetch("/resume/roles"),

  // Semantic, role-based resume analysis
  // Uses a 120s timeout because the Hugging Face model takes time to load + encode
  analyze: (text, role = "general", jobDescription = null) =>
    apiFetch("/resume/analyze", {
      method: "POST",
      timeoutMs: 120000,
      body: JSON.stringify({
        text,
        role,
        job_description: jobDescription || undefined,
      }),
    }),
};

// ─── AI (server-side Gemini — key never exposed to client) ──────────────────

export const aiApi = {
  // Generate assessment questions via server-side Gemini
  generateQuestions: (skillName, difficulty, mcqCount, shortCount, theoryCount) =>
    apiFetch("/ai/generate-questions", {
      method: "POST",
      timeoutMs: 120000,
      body: JSON.stringify({
        skill_name: skillName,
        difficulty,
        mcq_count: mcqCount,
        short_count: shortCount,
        theory_count: theoryCount,
      }),
    }),

  // Generate candidate skill summary via server-side Gemini
  generateSkillSummary: (candidateName, education, verifiedSkills) =>
    apiFetch("/ai/generate-skill-summary", {
      method: "POST",
      timeoutMs: 60000,
      body: JSON.stringify({
        candidate_name: candidateName,
        education,
        verified_skills: verifiedSkills,
      }),
    }),
};

export default apiFetch;
