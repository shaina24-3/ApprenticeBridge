from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles
from app.database import get_db
from app.models import User, Assessment, AssessmentQuestion, AssessmentAttempt, CandidateProfile, CandidateSkill
from app.schemas import AssessmentCreate, AssessmentSubmit
from datetime import datetime

router = APIRouter(prefix="/assessments", tags=["Assessments"])

def level_for(score):
    if score >= 85: return "advanced"
    if score >= 70: return "intermediate"
    if score >= 50: return "beginner"
    return "not_verified"

@router.post("")
def create_assessment(data: AssessmentCreate, user: User = Depends(require_roles("training_institute", "admin")), db: Session = Depends(get_db)):
    if data.status not in {"draft","approved"}: data.status="draft"
    a=Assessment(skill_id=data.skill_id,title=data.title,description=data.description,status=data.status,created_by=user.id); db.add(a); db.flush()
    for q in data.questions:
        db.add(AssessmentQuestion(assessment_id=a.id,question=q["question"],option_a=q["option_a"],option_b=q["option_b"],option_c=q["option_c"],option_d=q["option_d"],correct_option=q["correct_option"]))
    db.commit(); db.refresh(a); return a

@router.get("")
def list_assessments(db: Session=Depends(get_db)):
    return db.query(Assessment).filter(Assessment.status=="approved").all()

@router.get("/{assessment_id}")
def get_assessment(assessment_id:int, db:Session=Depends(get_db)):
    a=db.get(Assessment,assessment_id)
    if not a or a.status!="approved": raise HTTPException(404,"Assessment not found")
    qs=db.query(AssessmentQuestion).filter_by(assessment_id=a.id).all()
    return {"id":a.id,"skill_id":a.skill_id,"title":a.title,"description":a.description,"questions":[{"id":q.id,"question":q.question,"options":{"A":q.option_a,"B":q.option_b,"C":q.option_c,"D":q.option_d}} for q in qs]}

@router.post("/{assessment_id}/submit")
def submit(assessment_id:int,data:AssessmentSubmit,user:User=Depends(require_roles("candidate")),db:Session=Depends(get_db)):
    a=db.get(Assessment,assessment_id)
    if not a or a.status!="approved": raise HTTPException(404,"Assessment not found")
    qs=db.query(AssessmentQuestion).filter_by(assessment_id=a.id).all()
    if not qs: raise HTTPException(400,"Assessment has no questions")
    correct=sum(1 for q in qs if data.answers.get(q.id,"X").upper()==q.correct_option.upper())
    score=round(correct/len(qs)*100,2); level=level_for(score)
    attempt=AssessmentAttempt(assessment_id=a.id,candidate_id=user.id,score=score,level=level); db.add(attempt)
    profile=db.query(CandidateProfile).filter_by(user_id=user.id).first()
    if profile and level!="not_verified":
        row=db.query(CandidateSkill).filter_by(candidate_id=profile.id,skill_id=a.skill_id).first()
        if not row: row=CandidateSkill(candidate_id=profile.id,skill_id=a.skill_id,level=level,source="assessment",score=score,verified=True,verified_at=datetime.utcnow()); db.add(row)
        else:
            row.level=level; row.source="assessment"; row.score=score; row.verified=True; row.verified_at=datetime.utcnow()
    db.commit(); db.refresh(attempt)
    return {"attempt_id":attempt.id,"score":score,"level":level,"correct":correct,"total":len(qs)}
