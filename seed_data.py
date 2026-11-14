from app.database import Base, engine, SessionLocal
from app.models import Skill, Certification, User, Assessment, AssessmentQuestion
from app.auth.security import hash_password

Base.metadata.create_all(bind=engine)
db=SessionLocal()
try:
    skills=[
        # Programming languages
        ("Python","Programming","Software"),("Java","Programming","Software"),
        ("JavaScript","Programming","Software"),("TypeScript","Programming","Software"),
        ("C","Programming","Software"),("C++","Programming","Software"),
        ("C#","Programming","Software"),("Go","Programming","Software"),
        ("Rust","Programming","Software"),("Swift","Programming","Software"),
        ("Kotlin","Programming","Software"),("Ruby","Programming","Software"),
        ("PHP","Programming","Software"),("Scala","Programming","Software"),
        ("R","Data Science","Data"),("MATLAB","Engineering","Engineering"),
        ("Dart","Programming","Software"),("Lua","Programming","Software"),
        # Web / Frontend
        ("React","Web Development","Software"),("Next.js","Web Development","Software"),
        ("Vue.js","Web Development","Software"),("Angular","Web Development","Software"),
        ("HTML","Web Development","Software"),("CSS","Web Development","Software"),
        ("Tailwind CSS","Web Development","Software"),("Bootstrap","Web Development","Software"),
        # Backend / APIs
        ("Node.js","Backend","Software"),("FastAPI","Backend","Software"),
        ("Django","Backend","Software"),("Flask","Backend","Software"),
        ("Express.js","Backend","Software"),("Spring Boot","Backend","Software"),
        ("REST API","Backend","Software"),("GraphQL","Backend","Software"),
        # Databases
        ("SQL","Database","Software"),("PostgreSQL","Database","Software"),
        ("MySQL","Database","Software"),("MongoDB","Database","Software"),
        ("Redis","Database","Software"),("SQLite","Database","Software"),
        # DevOps / Cloud
        ("Git","Tools","Software"),("Docker","DevOps","Software"),
        ("Kubernetes","DevOps","Software"),("AWS","Cloud","Cloud"),
        ("Azure","Cloud","Cloud"),("Google Cloud","Cloud","Cloud"),
        ("CI/CD","DevOps","Software"),("Linux","Systems","Software"),
        ("Bash","Systems","Software"),("Terraform","DevOps","Cloud"),
        # Data / AI / ML
        ("Machine Learning","Data Science","Data"),("Deep Learning","Data Science","Data"),
        ("TensorFlow","Data Science","Data"),("PyTorch","Data Science","Data"),
        ("Pandas","Data Science","Data"),("NumPy","Data Science","Data"),
        ("Data Analysis","Data Science","Data"),("Power BI","Data Science","Data"),
        ("Tableau","Data Science","Data"),("NLP","Data Science","Data"),
        # Trades / Vocational
        ("Electrical Wiring","Electrical","Electrical"),("Circuit Design","Electrical","Electrical"),
        ("Plumbing","Plumbing","Construction"),("Carpentry","Carpentry","Construction"),
        ("Welding","Welding","Engineering"),("HVAC","HVAC","Engineering"),
        ("Bricklaying","Construction","Construction"),("Plastering","Construction","Construction"),
        ("Painting and Decorating","Construction","Construction"),
        ("CAD Design","Engineering","Engineering"),("AutoCAD","Engineering","Engineering"),
        ("CNC Machining","Manufacturing","Engineering"),
        # Business / Soft skills
        ("Project Management","Management","Business"),("Agile","Management","Business"),
        ("Scrum","Management","Business"),("Communication","Soft Skills","Business"),
        ("Problem Solving","Soft Skills","Business"),("Teamwork","Soft Skills","Business"),
        ("Customer Service","Business","Business"),("Microsoft Office","Tools","Business"),
        ("Excel","Tools","Business"),("Marketing","Business","Business"),
        ("Accounting","Finance","Business"),("Cybersecurity","Security","Software"),
    ]
    for name,cat,trade in skills:
        if not db.query(Skill).filter(Skill.name.ilike(name)).first():
            db.add(Skill(name=name,category=cat,trade=trade,skill_type="skill"))
    certs=["AWS Certified Cloud Practitioner","Python Certification","Java Certification",
           "Microsoft Azure Fundamentals","Google Cloud Associate","CompTIA Security+"]
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
