"""
Semantic, role-based ATS resume analysis engine.

Uses the pretrained sentence-transformers/all-MiniLM-L6-v2 model to evaluate
resumes against role-specific profiles using semantic similarity rather than
keyword counting. The model is loaded once and reused across all requests.
"""

import logging
import re
from functools import lru_cache

logger = logging.getLogger(__name__)

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


# ─── Role profiles ───────────────────────────────────────────────────────────
# Each role defines the ideal-candidate description (used for overall semantic
# similarity), core skills (with short descriptions for semantic matching),
# project indicators, experience indicators, and education keywords.

ROLE_PROFILES = {
    "backend_engineer": {
        "title": "Backend Engineer",
        "description": (
            "Backend software engineer building server-side applications, REST APIs, "
            "microservices, and database layers. Experienced with server-side languages, "
            "API design, databases, authentication, caching, and deployment. "
            "Builds scalable, secure, well-tested backend systems."
        ),
        "core_skills": [
            ("Python", "Python programming and backend development"),
            ("Java", "Java enterprise backend development"),
            ("Node.js", "Node.js server-side JavaScript development"),
            ("SQL", "SQL database queries and schema design"),
            ("PostgreSQL", "PostgreSQL database management"),
            ("REST API", "RESTful API design and development"),
            ("Django", "Django web framework development"),
            ("FastAPI", "FastAPI Python web framework"),
            ("Docker", "Docker containerization and deployment"),
            ("Authentication", "Authentication and authorization implementation"),
            ("Microservices", "Microservices architecture and design"),
        ],
        "project_indicators": [
            "built a REST API",
            "developed a backend service",
            "designed a database schema",
            "implemented authentication",
            "created a microservice",
            "built a web server",
            "developed an API endpoint",
            "implemented data validation",
        ],
        "experience_indicators": [
            "backend developer",
            "software engineer",
            "API development",
            "server-side development",
            "database design",
            "system architecture",
            "backend internship",
        ],
        "education_keywords": [
            "computer science",
            "software engineering",
            "information technology",
            "engineering degree",
            "bachelor",
            "master",
        ],
    },
    "frontend_developer": {
        "title": "Frontend Developer",
        "description": (
            "Frontend developer building responsive, accessible web interfaces with "
            "modern JavaScript frameworks. Experienced with HTML, CSS, JavaScript, "
            "React or Vue, state management, responsive design, and UI/UX principles. "
            "Creates performant, user-friendly web applications."
        ),
        "core_skills": [
            ("JavaScript", "JavaScript programming for web development"),
            ("React", "React component-based frontend development"),
            ("HTML", "HTML semantic markup and structure"),
            ("CSS", "CSS styling and responsive design"),
            ("TypeScript", "TypeScript type-safe frontend development"),
            ("Tailwind CSS", "Tailwind CSS utility-first styling"),
            ("Next.js", "Next.js React framework development"),
            ("Vue.js", "Vue.js progressive frontend framework"),
            ("Responsive Design", "Responsive web design for mobile and desktop"),
            ("UI/UX", "User interface and user experience design"),
        ],
        "project_indicators": [
            "built a web application",
            "developed a user interface",
            "created a responsive website",
            "built a React component",
            "designed a landing page",
            "developed a dashboard",
            "implemented a form",
            "created a frontend layout",
        ],
        "experience_indicators": [
            "frontend developer",
            "web developer",
            "UI developer",
            "front-end development",
            "react developer",
            "web design",
            "frontend internship",
        ],
        "education_keywords": [
            "computer science",
            "web development",
            "software engineering",
            "information technology",
            "design",
            "bootcamp",
        ],
    },
    "fullstack_developer": {
        "title": "Full Stack Developer",
        "description": (
            "Full stack developer building end-to-end web applications covering both "
            "frontend interfaces and backend services. Experienced with frontend "
            "frameworks, backend languages, databases, APIs, and deployment. "
            "Understands the complete web application stack."
        ),
        "core_skills": [
            ("JavaScript", "JavaScript for both frontend and backend"),
            ("Python", "Python backend development"),
            ("React", "React frontend development"),
            ("Node.js", "Node.js backend development"),
            ("SQL", "SQL database management"),
            ("REST API", "RESTful API design and development"),
            ("PostgreSQL", "PostgreSQL database"),
            ("Docker", "Docker deployment"),
            ("HTML", "HTML web markup"),
            ("CSS", "CSS styling"),
        ],
        "project_indicators": [
            "built a full stack application",
            "developed a web application",
            "built an end-to-end application",
            "developed a MERN stack app",
            "created a web platform",
            "built a full stack project",
            "developed frontend and backend",
        ],
        "experience_indicators": [
            "full stack developer",
            "software engineer",
            "web developer",
            "full-stack development",
            "software development",
            "full stack internship",
        ],
        "education_keywords": [
            "computer science",
            "software engineering",
            "information technology",
            "engineering",
            "bachelor",
            "master",
        ],
    },
    "data_scientist": {
        "title": "Data Scientist",
        "description": (
            "Data scientist analyzing data to extract insights, build predictive models, "
            "and communicate findings. Experienced with Python, statistical analysis, "
            "machine learning, data visualization, SQL, and experiment design. "
            "Works with pandas, numpy, scikit-learn, and visualization tools."
        ),
        "core_skills": [
            ("Python", "Python for data science and analysis"),
            ("SQL", "SQL for data extraction and analysis"),
            ("Pandas", "Pandas data manipulation and analysis"),
            ("NumPy", "NumPy numerical computing"),
            ("scikit-learn", "scikit-learn machine learning models"),
            ("Data Visualization", "Data visualization with charts and dashboards"),
            ("Statistics", "Statistical analysis and hypothesis testing"),
            ("Machine Learning", "Machine learning model building"),
            ("Data Analysis", "Data analysis and exploratory data analysis"),
            ("Tableau", "Tableau or Power BI data visualization"),
        ],
        "project_indicators": [
            "analyzed a dataset",
            "built a predictive model",
            "created a data visualization",
            "performed exploratory data analysis",
            "built a machine learning model",
            "conducted statistical analysis",
            "created a dashboard",
            "developed a data pipeline",
        ],
        "experience_indicators": [
            "data scientist",
            "data analyst",
            "data analysis",
            "machine learning",
            "statistical analysis",
            "data science internship",
            "research assistant",
        ],
        "education_keywords": [
            "data science",
            "statistics",
            "mathematics",
            "computer science",
            "data analytics",
            "bachelor",
            "master",
            "phd",
        ],
    },
    "ai_ml_engineer": {
        "title": "AI/ML Engineer",
        "description": (
            "AI/ML engineer building and deploying machine learning and deep learning "
            "models. Experienced with Python, TensorFlow or PyTorch, NLP, computer vision, "
            "model training, evaluation, and deployment. Works with large language models, "
            "RAG pipelines, and AI application development."
        ),
        "core_skills": [
            ("Python", "Python for machine learning development"),
            ("TensorFlow", "TensorFlow deep learning framework"),
            ("PyTorch", "PyTorch deep learning framework"),
            ("NLP", "Natural language processing techniques"),
            ("Deep Learning", "Deep learning neural network models"),
            ("Machine Learning", "Machine learning model training and evaluation"),
            ("scikit-learn", "scikit-learn for classical ML models"),
            ("LLM", "Large language model application development"),
            ("RAG", "Retrieval augmented generation pipelines"),
            ("Model Deployment", "ML model deployment and serving"),
        ],
        "project_indicators": [
            "trained a neural network",
            "built a machine learning model",
            "developed an AI application",
            "implemented a deep learning model",
            "built an NLP pipeline",
            "fine-tuned a model",
            "developed a RAG system",
            "deployed a machine learning model",
        ],
        "experience_indicators": [
            "machine learning engineer",
            "AI engineer",
            "deep learning",
            "NLP engineer",
            "data scientist",
            "ML research",
            "AI development",
            "ML internship",
        ],
        "education_keywords": [
            "computer science",
            "machine learning",
            "artificial intelligence",
            "data science",
            "mathematics",
            "statistics",
            "bachelor",
            "master",
            "phd",
        ],
    },
    "devops_engineer": {
        "title": "DevOps Engineer",
        "description": (
            "DevOps engineer managing CI/CD pipelines, containerization, cloud "
            "infrastructure, and deployment automation. Experienced with Docker, "
            "Kubernetes, AWS/Azure, CI/CD tools, Infrastructure as Code, monitoring, "
            "and automation. Ensures reliable, scalable deployments."
        ),
        "core_skills": [
            ("Docker", "Docker containerization"),
            ("Kubernetes", "Kubernetes container orchestration"),
            ("AWS", "AWS cloud services and deployment"),
            ("Azure", "Azure cloud platform"),
            ("CI/CD", "CI/CD pipeline automation"),
            ("Linux", "Linux system administration"),
            ("Terraform", "Terraform infrastructure as code"),
            ("Jenkins", "Jenkins or GitHub Actions CI/CD"),
            ("Monitoring", "System monitoring and logging"),
            ("Bash", "Bash scripting and automation"),
        ],
        "project_indicators": [
            "built a CI/CD pipeline",
            "configured Docker containers",
            "deployed to Kubernetes",
            "set up cloud infrastructure",
            "automated a deployment",
            "configured monitoring",
            "built infrastructure as code",
            "set up a pipeline",
        ],
        "experience_indicators": [
            "devops engineer",
            "cloud engineer",
            "site reliability",
            "infrastructure",
            "deployment automation",
            "cloud administration",
            "devops internship",
        ],
        "education_keywords": [
            "computer science",
            "information technology",
            "software engineering",
            "engineering",
            "bachelor",
            "master",
        ],
    },
    "mobile_developer": {
        "title": "Mobile Developer",
        "description": (
            "Mobile developer building native or cross-platform mobile applications. "
            "Experienced with Swift, Kotlin, React Native, or Flutter. Builds "
            "responsive, performant mobile apps with good UX, API integration, and "
            "platform-specific features."
        ),
        "core_skills": [
            ("React Native", "React Native cross-platform mobile development"),
            ("Swift", "Swift iOS native development"),
            ("Kotlin", "Kotlin Android development"),
            ("Flutter", "Flutter cross-platform mobile development"),
            ("Mobile UI", "Mobile user interface design"),
            ("REST API", "REST API integration in mobile apps"),
            ("JavaScript", "JavaScript for React Native"),
            ("Dart", "Dart programming for Flutter"),
        ],
        "project_indicators": [
            "built a mobile app",
            "developed an iOS application",
            "developed an Android app",
            "created a cross-platform app",
            "built a React Native app",
            "developed a Flutter app",
            "published a mobile application",
        ],
        "experience_indicators": [
            "mobile developer",
            "iOS developer",
            "Android developer",
            "app developer",
            "mobile development",
            "mobile internship",
        ],
        "education_keywords": [
            "computer science",
            "software engineering",
            "mobile development",
            "information technology",
            "bachelor",
            "master",
        ],
    },
}

# Fallback "general" profile used when no role is selected
GENERAL_PROFILE = {
    "title": "General Software Role",
    "description": (
        "Software developer with programming skills, project experience, and "
        "relevant technical knowledge. Builds applications, writes clean code, "
        "and demonstrates practical software development experience."
    ),
    "core_skills": [
        ("Python", "Python programming"),
        ("JavaScript", "JavaScript programming"),
        ("SQL", "SQL database queries"),
        ("Git", "Git version control"),
        ("REST API", "REST API development"),
        ("HTML", "HTML web markup"),
        ("CSS", "CSS styling"),
        ("Docker", "Docker containerization"),
        ("React", "React frontend development"),
        ("Node.js", "Node.js backend development"),
    ],
    "project_indicators": [
        "built a web application",
        "developed a project",
        "created a software application",
        "built an API",
        "developed a feature",
        "implemented a solution",
    ],
    "experience_indicators": [
        "software developer",
        "software engineer",
        "developer",
        "internship",
        "programming",
        "software development",
    ],
    "education_keywords": [
        "computer science",
        "software engineering",
        "information technology",
        "engineering",
        "bachelor",
        "master",
    ],
}


def get_role_profile(role: str) -> dict:
    """Return the role profile for the given key, or the general fallback."""
    return ROLE_PROFILES.get(role, GENERAL_PROFILE)


def get_available_roles() -> list[dict]:
    """Return all available roles for the frontend dropdown."""
    return [{"key": k, "title": v["title"]} for k, v in ROLE_PROFILES.items()]


# ─── Model loading (lazy + cached) ───────────────────────────────────────────

@lru_cache(maxsize=1)
def get_model():
    """Load the pretrained model once and reuse it."""
    from sentence_transformers import SentenceTransformer as _ST
    logger.info("Loading pretrained ATS model: %s", MODEL_NAME)
    return _ST(MODEL_NAME)


def _encode_batch(texts):
    """Encode a batch of texts, returning normalized tensor embeddings."""
    from sentence_transformers import util as _util
    import torch
    model = get_model()
    # Truncate very long texts to keep encoding fast
    truncated = [str(t)[:3000] if len(str(t)) > 3000 else str(t) for t in texts]
    # Ensure all items are plain strings (not lists/tuples)
    clean = [t if isinstance(t, str) else str(t) for t in truncated]
    embeddings = model.encode(clean, convert_to_tensor=True, normalize_embeddings=True, show_progress_bar=False)
    # Ensure 2D shape [n, dim] even for single text
    if embeddings.dim() == 1:
        embeddings = embeddings.unsqueeze(0)
    return embeddings


def _cosine_sim(vec_a, vec_b) -> float:
    """Cosine similarity between two normalized embedding tensors."""
    from sentence_transformers import util as _util
    return float(_util.cos_sim(vec_a, vec_b).item())


def _max_similarity(target_emb, candidate_embs) -> list[float]:
    """For each candidate embedding, return the max similarity to the target."""
    from sentence_transformers import util as _util
    import torch
    # Ensure both are 2D: target [1, dim], candidates [n, dim]
    if target_emb.dim() == 1:
        target_emb = target_emb.unsqueeze(0)
    if candidate_embs.dim() == 1:
        candidate_embs = candidate_embs.unsqueeze(0)
    # cos_sim returns [1, n]
    sims = _util.cos_sim(target_emb, candidate_embs)[0]  # [n]
    return [float(sims[i].item()) for i in range(sims.shape[0])]


# ─── Semantic analysis helpers ──────────────────────────────────────────────

# Thresholds for semantic matching
SKILL_PRESENT_THRESHOLD = 0.35      # above this = skill likely present
SECTION_DETECT_THRESHOLD = 0.30    # above this = section likely present
HIGH_RELEVANCE_THRESHOLD = 0.55    # above this = strongly relevant


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences/chunks for fine-grained semantic matching."""
    # Split on sentence boundaries, filter very short fragments
    raw = re.split(r'(?<=[.!?])\s+|\n+', text)
    sentences = [s.strip() for s in raw if len(s.strip()) > 10]
    # Also include the full text as one chunk for broad matching
    if text.strip():
        sentences.append(text.strip()[:1500])
    return sentences if sentences else [text.strip()[:1500]]


def _detect_skills_semantically(resume_text: str, skills: list[tuple[str, str]]) -> list[dict]:
    """
    For each (skill_name, skill_description), compute the max semantic similarity
    between the skill description and resume sentences. Returns a list of
    {name, description, similarity, present} dicts.
    """
    if not resume_text.strip() or not skills:
        return []

    sentences = _split_sentences(resume_text)
    # Batch-encode all resume sentences + all skill descriptions
    all_texts = sentences + [desc for _, desc in skills]
    embeddings = _encode_batch(all_texts)

    sentence_embs = embeddings[:len(sentences)]
    skill_embs = embeddings[len(sentences):]

    results = []
    for i, (name, desc) in enumerate(skills):
        # Max similarity between this skill description and any resume sentence
        sims = _max_similarity(skill_embs[i], sentence_embs)
        max_sim = max(sims) if sims else 0.0
        results.append({
            "name": name,
            "similarity": round(max_sim, 4),
            "present": max_sim >= SKILL_PRESENT_THRESHOLD,
            "strong": max_sim >= HIGH_RELEVANCE_THRESHOLD,
        })
    return results


def _score_relevance(resume_text: str, indicator_phrases: list[str]) -> float:
    """
    Score how semantically relevant the resume is to a set of indicator phrases.
    Returns a 0-100 score based on the average of max-similarities.
    """
    if not resume_text.strip() or not indicator_phrases:
        return 0.0

    sentences = _split_sentences(resume_text)
    all_texts = sentences + indicator_phrases
    embeddings = _encode_batch(all_texts)

    sentence_embs = embeddings[:len(sentences)]
    indicator_embs = embeddings[len(sentences):]

    max_sims = []
    for i in range(len(indicator_phrases)):
        sims = _max_similarity(indicator_embs[i], sentence_embs)
        max_sims.append(max(sims) if sims else 0.0)

    # Average of max similarities, scaled to 0-100
    avg_max = sum(max_sims) / len(max_sims) if max_sims else 0.0
    # Scale: 0.0 → 0, 0.5 → 70, 0.7+ → ~100
    score = min(100, round(avg_max * 150))
    return score


def _detect_sections(resume_text: str) -> dict:
    """Detect resume sections using semantic matching + keyword hints."""
    section_queries = {
        "education": ["education section, university, college, degree, academic qualifications"],
        "experience": ["work experience, professional experience, employment history, previous roles"],
        "projects": ["projects section, personal projects, built, developed, project work"],
        "skills": ["technical skills, programming languages, technologies, tools, competencies"],
    }

    sentences = _split_sentences(resume_text)
    all_texts = sentences + list(section_queries.values())
    embeddings = _encode_batch(all_texts)

    sentence_embs = embeddings[:len(sentences)]
    query_embs = embeddings[len(sentences):]

    detected = {}
    for i, section_name in enumerate(section_queries):
        sims = _max_similarity(query_embs[i], sentence_embs)
        max_sim = max(sims) if sims else 0.0
        detected[section_name] = {
            "present": max_sim >= SECTION_DETECT_THRESHOLD,
            "confidence": round(max_sim, 4),
        }
    return detected


def _check_structure(resume_text: str) -> dict:
    """Check resume structure and readability signals."""
    text = resume_text.strip()
    word_count = len(text.split())
    has_email = bool(re.search(r'\b[\w.-]+@[\w.-]+\.[a-z]{2,}\b', text, re.IGNORECASE))
    has_phone = bool(re.search(r'\b(?:\+?\d[\d ()-]{8,}\d)\b', text))
    action_verbs = re.findall(
        r'\b(achieved|improved|reduced|increased|built|developed|implemented|'
        r'automated|designed|created|delivered|led|managed|optimized|launched|'
        r'spearheaded|architected|engineered)\b',
        text, re.IGNORECASE,
    )
    has_action_verbs = len(action_verbs) >= 3

    # Length scoring: 300-800 words is ideal
    if word_count < 100:
        length_score = 20
    elif word_count < 300:
        length_score = 50
    elif word_count <= 800:
        length_score = 100
    elif word_count <= 1200:
        length_score = 85
    else:
        length_score = 70

    # Contact info
    contact_score = (50 if has_email else 0) + (50 if has_phone else 0)

    # Action verbs
    verb_score = 100 if has_action_verbs else (50 if len(action_verbs) > 0 else 20)

    # Section detection
    sections = _detect_sections(text)
    section_count = sum(1 for s in sections.values() if s["present"])
    section_score = round(section_count / 4 * 100)

    # Overall structure score
    structure_score = round(
        length_score * 0.25 +
        contact_score * 0.15 +
        verb_score * 0.20 +
        section_score * 0.40
    )

    return {
        "score": structure_score,
        "details": {
            "word_count": word_count,
            "has_email": has_email,
            "has_phone": has_phone,
            "action_verb_count": len(action_verbs),
            "sections_detected": sections,
            "length_score": length_score,
            "contact_score": contact_score,
            "verb_score": verb_score,
            "section_score": section_score,
        },
    }


# ─── Main analysis function ─────────────────────────────────────────────────

def analyze_resume(
    resume_text: str,
    role: str = "general",
    job_description: str | None = None,
) -> dict:
    """
    Perform a semantic, role-based resume analysis.

    Args:
        resume_text: The full resume text extracted from the file.
        role: Role key from ROLE_PROFILES (e.g. "backend_engineer").
        job_description: Optional JD for more targeted evaluation.

    Returns:
        Structured dict with overall score, category scores, strengths,
        weaknesses, missing skills, and personalized recommendations.
    """
    resume_text = (resume_text or "").strip()
    if not resume_text:
        raise ValueError("Resume text cannot be empty.")

    profile = get_role_profile(role)

    # ── 1. Technical skill relevance ────────────────────────────────────────
    skill_results = _detect_skills_semantically(resume_text, profile["core_skills"])
    present_skills = [s for s in skill_results if s["present"]]
    strong_skills = [s for s in skill_results if s["strong"]]
    missing_skills = [s for s in skill_results if not s["present"]]

    if skill_results:
        technical_score = round(
            (len(present_skills) / len(skill_results)) * 60 +
            (len(strong_skills) / len(skill_results)) * 40
        )
    else:
        technical_score = 0

    # ── 2. Projects and practical experience ─────────────────────────────────
    project_score = _score_relevance(resume_text, profile["project_indicators"])

    # ── 3. Relevant work experience ────────────────────────────────────────
    experience_score = _score_relevance(resume_text, profile["experience_indicators"])

    # ── 4. Education and qualifications ─────────────────────────────────────
    education_score = _score_relevance(resume_text, profile["education_keywords"])

    # ── 5. Resume structure and readability ─────────────────────────────────
    structure = _check_structure(resume_text)
    structure_score = structure["score"]

    # ── 6. Role-specific relevance (semantic similarity to role description) ─
    role_emb = _encode_batch([profile["description"]])[0]
    resume_sentences = _split_sentences(resume_text)
    resume_embs = _encode_batch(resume_sentences)
    role_sims = _max_similarity(role_emb, resume_embs)
    avg_role_sim = sum(role_sims) / len(role_sims) if role_sims else 0.0
    max_role_sim = max(role_sims) if role_sims else 0.0
    # Blend avg and max: max captures "best matching section", avg captures overall fit
    role_relevance_score = round(min(100, ((avg_role_sim * 0.4) + (max_role_sim * 0.6)) * 140))

    # ── Category scores dict ────────────────────────────────────────────────
    category_scores = {
        "technical_skills": technical_score,
        "projects": project_score,
        "experience": experience_score,
        "education": education_score,
        "structure": structure_score,
        "role_relevance": role_relevance_score,
    }

    # ── Overall score (weighted average) ────────────────────────────────────
    weights = {
        "technical_skills": 0.25,
        "projects": 0.20,
        "experience": 0.20,
        "education": 0.10,
        "structure": 0.10,
        "role_relevance": 0.15,
    }
    overall = round(sum(category_scores[k] * weights[k] for k in weights))

    # ── Optional: Job description comparison ────────────────────────────────
    jd_analysis = None
    if job_description and job_description.strip():
        jd_text = job_description.strip()
        jd_emb = _encode_batch([jd_text])[0]
        jd_resume_sims = _max_similarity(jd_emb, resume_embs)
        jd_max_sim = max(jd_resume_sims) if jd_resume_sims else 0.0
        jd_avg_sim = sum(jd_resume_sims) / len(jd_resume_sims) if jd_resume_sims else 0.0
        jd_match_score = round(min(100, ((jd_avg_sim * 0.4) + (jd_max_sim * 0.6)) * 140))

        # Detect JD skills semantically
        jd_skills = _detect_skills_semantically(jd_text, profile["core_skills"])
        jd_present = [s["name"] for s in jd_skills if s["present"]]
        resume_present = set(s["name"] for s in present_skills)
        jd_matched = [s for s in jd_present if s in resume_present]
        jd_missing = [s for s in jd_present if s not in resume_present]

        jd_analysis = {
            "jd_match_score": jd_match_score,
            "jd_required_skills": jd_present,
            "jd_matched_skills": jd_matched,
            "jd_missing_skills": jd_missing,
            "semantic_similarity": round(jd_max_sim, 4),
        }

        # Adjust overall score with JD relevance (30% weight when JD is provided)
        overall = round(overall * 0.7 + jd_match_score * 0.3)

    # ── Strengths and weaknesses ────────────────────────────────────────────
    strengths = []
    weaknesses = []

    # Technical skills
    if strong_skills:
        strengths.append(
            f"Strong match for {len(strong_skills)} key {profile['title']} skills: "
            + ", ".join(s["name"] for s in strong_skills[:5]) + "."
        )
    elif present_skills:
        strengths.append(
            f"Your resume mentions {len(present_skills)} relevant {profile['title']} skills: "
            + ", ".join(s["name"] for s in present_skills[:5]) + "."
        )
    else:
        weaknesses.append(
            f"No clearly detectable {profile['title']} technical skills found. "
            f"Add a Skills section listing technologies relevant to this role."
        )

    if missing_skills:
        weaknesses.append(
            f"{len(missing_skills)} expected skills for {profile['title']} were not "
            f"semantically detected: "
            + ", ".join(s["name"] for s in missing_skills[:5]) + "."
        )

    # Projects
    if project_score >= 60:
        strengths.append(f"Good evidence of relevant projects for a {profile['title']} role ({project_score}%).")
    elif project_score >= 35:
        weaknesses.append(f"Limited project evidence for a {profile['title']} role ({project_score}%). Add concrete project descriptions.")
    else:
        weaknesses.append(f"Very little project evidence detected ({project_score}%). Build and document {profile['title']}-relevant projects.")

    # Experience
    if experience_score >= 60:
        strengths.append(f"Relevant work experience detected for a {profile['title']} role ({experience_score}%).")
    elif experience_score >= 35:
        weaknesses.append(f"Limited relevant experience for this role ({experience_score}%). Highlight transferable skills and relevant responsibilities.")
    else:
        weaknesses.append(f"Limited relevant experience detected ({experience_score}%). Consider internships or freelance {profile['title']} work.")

    # Education
    if education_score >= 50:
        strengths.append(f"Relevant educational background detected ({education_score}%).")
    else:
        weaknesses.append(f"Educational background for this role is not clearly visible ({education_score}%). Ensure your education section is clearly labeled.")

    # Structure
    struct_details = structure["details"]
    if struct_details["word_count"] < 200:
        weaknesses.append(f"Resume is quite short ({struct_details['word_count']} words). Add more detail about projects and experience.")
    if not struct_details["has_email"]:
        weaknesses.append("No email address detected. Add contact information for ATS parsing.")
    if struct_details["action_verb_count"] < 3:
        weaknesses.append(f"Few action verbs detected ({struct_details['action_verb_count']}). Use verbs like 'built', 'developed', 'implemented'.")
    sections_detected = struct_details["sections_detected"]
    missing_sections = [s for s, info in sections_detected.items() if not info["present"]]
    if missing_sections:
        weaknesses.append(f"Some standard resume sections not clearly detected: {', '.join(missing_sections)}. Structure your resume with clear section headings.")

    if structure_score >= 70:
        strengths.append(f"Well-structured resume ({structure_score}%) with clear sections and good length.")

    # Role relevance
    if role_relevance_score >= 65:
        strengths.append(f"Strong overall alignment with the {profile['title']} role ({role_relevance_score}%).")
    elif role_relevance_score >= 40:
        weaknesses.append(f"Moderate alignment with the {profile['title']} role ({role_relevance_score}%). Tailor your resume to better match this role.")
    else:
        weaknesses.append(f"Low alignment with the {profile['title']} role ({role_relevance_score}%). This resume may be better suited for a different role.")

    # ── Personalized recommendations ────────────────────────────────────────
    recommendations = []

    # Missing skills
    if missing_skills:
        top_missing = [s["name"] for s in missing_skills[:4]]
        recommendations.append(
            f"Strengthen these {profile['title']} skills if you have experience with them: "
            + ", ".join(top_missing) + ". Add them to your Skills section with brief evidence."
        )

    # Projects to build
    if project_score < 50:
        project_ideas = {
            "backend_engineer": "Build a REST API with authentication, a database-backed CRUD app, or a microservice.",
            "frontend_developer": "Build a responsive web app with React, a portfolio site, or an interactive dashboard.",
            "fullstack_developer": "Build a full-stack application with a React frontend and a Python/Node.js backend API.",
            "data_scientist": "Analyze a public dataset, build a predictive model, or create a data visualization dashboard.",
            "ai_ml_engineer": "Train and deploy a machine learning model, build an NLP pipeline, or create a RAG application.",
            "devops_engineer": "Set up a CI/CD pipeline, containerize an app with Docker, or deploy to a cloud provider.",
            "mobile_developer": "Build a mobile app with API integration and publish it to a store.",
        }
        idea = project_ideas.get(role, "Build a project relevant to your target role.")
        recommendations.append(f"Build a portfolio project: {idea}")

    # Experience
    if experience_score < 50:
        recommendations.append(
            "Add measurable work experience or internships. Use bullet points starting with action verbs "
            "and include quantified outcomes (e.g., 'reduced load time by 30%')."
        )

    # Structure
    if struct_details["word_count"] < 300:
        recommendations.append("Expand your resume to 300-800 words with concrete project and experience details.")
    if struct_details["action_verb_count"] < 5:
        recommendations.append("Start bullet points with strong action verbs: built, developed, implemented, designed, optimized, automated.")
    if missing_sections:
        recommendations.append(f"Add clearly labeled sections for: {', '.join(missing_sections)}. Use standard headings like 'Education', 'Experience', 'Projects', 'Skills'.")

    # Bullet point rewriting suggestion
    if overall < 60:
        recommendations.append(
            "Rewrite generic bullet points to be more specific and role-relevant. "
            "Instead of 'worked on a project', write 'built a REST API using Python and FastAPI that handled 1000+ requests/day'."
        )

    # JD-specific
    if jd_analysis and jd_analysis["jd_missing_skills"]:
        recommendations.append(
            f"For this specific job description, consider adding evidence for: "
            + ", ".join(jd_analysis["jd_missing_skills"][:4])
            + " — but only if you genuinely have the experience."
        )

    # If no major issues
    if not weaknesses:
        recommendations.append(
            f"Your resume is well-aligned for a {profile['title']} role. "
            "Focus on quantifying your achievements and tailoring bullet points to specific job descriptions."
        )

    # ── AI transparency note ─────────────────────────────────────────────────
    ai_note = (
        "This analysis uses semantic AI embeddings (sentence-transformers/all-MiniLM-L6-v2) "
        "to evaluate resume content against role-specific profiles. Scores are advisory and "
        "do not guarantee hiring outcomes. Always review recommendations critically."
    )

    return {
        "overall_score": overall,
        "role": role,
        "role_title": profile["title"],
        "category_scores": category_scores,
        "detected_skills": [{"name": s["name"], "similarity": s["similarity"], "present": s["present"]} for s in present_skills],
        "missing_skills": [s["name"] for s in missing_skills],
        "strengths": strengths,
        "weaknesses": weaknesses,
        "recommendations": recommendations,
        "structure_details": {
            "word_count": struct_details["word_count"],
            "has_email": struct_details["has_email"],
            "has_phone": struct_details["has_phone"],
            "action_verb_count": struct_details["action_verb_count"],
            "sections_detected": {k: v["present"] for k, v in struct_details["sections_detected"].items()},
        },
        "job_description_analysis": jd_analysis,
        "ai_note": ai_note,
        "model": MODEL_NAME,
    }
