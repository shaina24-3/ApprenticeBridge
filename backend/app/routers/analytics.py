from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles
from app.database import get_db
from app.models import User, Application, Apprenticeship

router=APIRouter(prefix="/analytics",tags=["Analytics"])
@router.get("/admin")
def admin_stats(user:User=Depends(require_roles("admin")),db:Session=Depends(get_db)):
    return {"candidates":db.query(User).filter(User.role=="candidate").count(),"employers":db.query(User).filter(User.role=="employer").count(),"training_institutes":db.query(User).filter(User.role=="training_institute").count(),"apprenticeships":db.query(Apprenticeship).count(),"applications":db.query(Application).count()}
@router.get("/employer")
def employer_stats(user:User=Depends(require_roles("employer")),db:Session=Depends(get_db)):
    listings=db.query(Apprenticeship).filter_by(employer_id=user.id).all(); ids=[x.id for x in listings]
    apps=db.query(Application).filter(Application.apprenticeship_id.in_(ids)).all() if ids else []
    return {"active_apprenticeships":sum(1 for x in listings if x.status=="published"),"total_applicants":len(apps),"shortlisted":sum(1 for x in apps if x.status=="shortlisted"),"selected":sum(1 for x in apps if x.status=="selected")}
@router.get("/candidate")
def candidate_stats(user:User=Depends(require_roles("candidate")),db:Session=Depends(get_db)):
    apps=db.query(Application).filter_by(candidate_id=user.id).all()
    return {"applications":len(apps),"shortlisted":sum(1 for x in apps if x.status=="shortlisted"),"selected":sum(1 for x in apps if x.status=="selected")}
