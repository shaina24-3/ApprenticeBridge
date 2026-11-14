import os
from dotenv import load_dotenv
from app.database import Base, engine, SessionLocal
from app.auth.security import hash_password
from app.models import User

load_dotenv()
Base.metadata.create_all(bind=engine)
db=SessionLocal()
try:
    email=os.getenv("ADMIN_EMAIL","shainagarg419@gmail.com")
    password=os.getenv("ADMIN_PASSWORD")
    if not password: raise RuntimeError("Set ADMIN_PASSWORD in .env")
    user=db.query(User).filter(User.email==email).first()
    if user:
        user.role="admin"; user.is_active=True; user.password_hash=hash_password(password)
    else:
        user=User(name="ApprenticeBridge Admin",email=email,password_hash=hash_password(password),role="admin")
        db.add(user)
    db.commit(); print(f"Admin ready: {email}")
finally: db.close()
