import hashlib
import os
from pathlib import Path
from uuid import uuid4
from fastapi import HTTPException, UploadFile

ALLOWED = {"application/pdf", "image/jpeg", "image/png", "video/mp4", "video/quicktime"}

def save_upload(upload: UploadFile, folder: str, max_mb: int = 25):
    if upload.content_type not in ALLOWED: raise HTTPException(400,"Unsupported file type")
    data = upload.file.read()
    if len(data) > max_mb*1024*1024: raise HTTPException(400,"File too large")
    checksum=hashlib.sha256(data).hexdigest()
    ext=Path(upload.filename or "file").suffix.lower()
    name=f"{uuid4().hex}{ext}"
    path=Path(folder)/name; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)
    return str(path), checksum, len(data), name
