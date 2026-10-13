import logging
import re
from functools import lru_cache

from sentence_transformers import SentenceTransformer, util

logger = logging.getLogger(__name__)

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

SKILLS = [
    "python", "java", "javascript", "typescript", "react",
    "next.js", "node.js", "express", "sql", "fastapi",
    "mongodb", "postgresql", "git", "docker", "kubernetes",
    "aws", "azure", "machine learning", "artificial intelligence",
    "generative ai", "tailwind", "html", "css", "graphql",
    "rest api", "data analysis", "pandas", "numpy", "scikit-learn",
    "deep learning", "natural language processing",
    "large language models", "rag", "llm", "api development",
    "unit testing", "ci/cd",
]


def contains_skill(text: str, skill: str) -> bool:
    pattern = rf"(?<!\w){re.escape(skill)}(?!\w)"
    return re.search(pattern, text, re.IGNORECASE) is not None


@lru_cache(maxsize=1)
def get_model() -> SentenceTransformer:
    """Load the pretrained model once and reuse it."""
    logger.info("Loading pretrained ATS model: %s", MODEL_NAME)
    return SentenceTransformer(MODEL_NAME)


def find_skills(text: str) -> list[str]:
    return [skill for skill in SKILLS if contains_skill(text, skill)]


def calculate_semantic_similarity(
    resume_text: str,
    job_description: str,
) -> float:
    """Compare resume and job description using pretrained embeddings."""
    model = get_model()
    embeddings = model.encode(
        [resume_text, job_description],
        convert_to_tensor=True,
        normalize_embeddings=True,
    )
    similarity = util.cos_sim(embeddings[0], embeddings[1]).item()
    return round(max(0.0, min(1.0, similarity)) * 100, 2)


def analyze_resume(
    resume_text: str,
    job_description: str | None = None,
) -> dict:
    """Analyze resume skills and optional job-description relevance."""
    resume_text = resume_text.strip()
    if not resume_text:
        raise ValueError("Resume text cannot be empty.")

    resume_skills = find_skills(resume_text)
    recommendations = []

    if not resume_skills:
        recommendations.append(
            "Add a technical-skills section if relevant to your experience."
        )

    if not re.search(r"\bprojects?\b", resume_text, re.IGNORECASE):
        recommendations.append(
            "Consider adding a Projects section with practical work."
        )

    action_verbs = (
        r"\b(achieved|improved|reduced|increased|built|developed|"
        r"implemented|automated|designed|created|delivered)\b"
    )
    if not re.search(action_verbs, resume_text, re.IGNORECASE):
        recommendations.append(
            "Use action verbs to describe your contributions."
        )

    result = {
        "matched_keywords": resume_skills,
        "detected_skill_count": len(resume_skills),
        "recommendations": recommendations,
        "semantic_similarity_score": None,
        "job_description_comparison": None,
        "ai_note": (
            "This analysis is advisory. Detected skills are not verified, "
            "and scores do not predict hiring outcomes."
        ),
    }

    if job_description and job_description.strip():
        jd_skills = find_skills(job_description)
        matched = [skill for skill in jd_skills if skill in resume_skills]
        missing = [skill for skill in jd_skills if skill not in resume_skills]

        coverage = (
            round(len(matched) / len(jd_skills) * 100, 2)
            if jd_skills
            else None
        )

        semantic_score = calculate_semantic_similarity(
            resume_text,
            job_description.strip(),
        )

        result["semantic_similarity_score"] = semantic_score
        result["job_description_comparison"] = {
            "job_description_skills": jd_skills,
            "matched_skills": matched,
            "missing_skills": missing,
            "skill_coverage_score": coverage,
        }

        if missing:
            recommendations.append(
                "Review these job-related skills and include them only "
                "if you genuinely have the experience: "
                + ", ".join(missing)
                + "."
            )

    return result
