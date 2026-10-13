from app.database import Base, engine, SessionLocal
from app.models import Skill, Certification, User, Assessment, AssessmentQuestion
from app.auth.security import hash_password

Base.metadata.create_all(bind=engine)
db=SessionLocal()
try:
    skills=[("Python","Programming","Software"),("Java","Programming","Software"),("JavaScript","Programming","Software"),("React","Web Development","Software"),("Node.js","Backend","Software"),("SQL","Database","Software"),("FastAPI","Backend","Software"),("Git","Tools","Software"),("Docker","DevOps","Software"),("AWS","Cloud","Cloud")]
    for name,cat,trade in skills:
        if not db.query(Skill).filter(Skill.name==name).first(): db.add(Skill(name=name,category=cat,trade=trade,skill_type="skill"))
    certs=["AWS Certified Cloud Practitioner","Python Certification","Java Certification"]
    for name in certs:
        if not db.query(Certification).filter(Certification.name==name).first(): db.add(Certification(name=name))
    db.commit()
    admin=db.query(User).filter(User.email=="seed-admin@apprenticebridge.local").first()
    if not admin:
        admin=User(name="Seed Trainer",email="seed-admin@apprenticebridge.local",password_hash=hash_password("SeedAdmin123!"),role="training_institute"); db.add(admin); db.commit()
    python=db.query(Skill).filter(Skill.name=="Python").first()
    if python and not db.query(Assessment).filter(Assessment.skill_id==python.id).first():
        a=Assessment(skill_id=python.id,title="Python Fundamentals",description="Basic Python micro-assessment",status="approved",created_by=admin.id); db.add(a); db.flush()
        qs=[("What is the output type of len([1,2,3])?","int","str","list","float","A"),("Which keyword defines a function?","func","def","function","lambda","B"),("Which structure stores key-value pairs?","list","tuple","dict","set","C")]
        for q,a1,b,c,d,correct in qs: db.add(AssessmentQuestion(assessment_id=a.id,question=q,option_a=a1,option_b=b,option_c=c,option_d=d,correct_option=correct))
        db.commit()
    print("Seed data ready")
finally: db.close()
