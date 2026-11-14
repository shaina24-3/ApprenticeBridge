# ApprenticeBridge — College Demo Setup

## What was changed

The existing React/Tailwind demo flows were preserved and the frontend was migrated into a Next.js project structure. The following requested additions were implemented without changing the existing candidate, employer and admin business flows:

1. Landing/home page with hero section, feature flash cards, how-it-works section and CTA.
2. Responsive role-based sidebar with desktop navigation and mobile drawer.
3. Responsive layouts across the landing page and portals.
4. Candidate Performance Analytics with skill score graph, application-status visualization and profile-completeness metrics.
5. Candidate ATS Resume Analyzer with file/text input, target job-description comparison, keyword matching, skill gaps, ATS warnings and recommendations.
6. Next.js + React + JavaScript + Tailwind CSS project structure.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Demo flow

- The app opens on the new landing page.
- Use **Explore Apprenticeships** or **Enter Platform** to open the Candidate portal.
- Use the desktop role switcher or the mobile **Demo portal** selector to switch between Candidate, Employer and Admin.
- Candidate → **Performance Analytics** shows the new graph/metrics.
- Candidate → **ATS Resume Analyzer** shows the new resume-analysis workflow.

## Important technical note

The supplied application is a frontend demo with in-memory seed data. No existing backend/database contract was present in the supplied source file, so no backend was rewritten. Existing AI calls remain as they were in the original source and still fall back to deterministic behavior when an API response is unavailable.

The ATS analyzer is intentionally rule-based for a reliable college demo and does not require an exposed AI API key. PDF/DOCX extraction uses the project dependencies listed in `package.json`; TXT/MD/CSV/RTF can also be read directly.
