from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.auth.dependencies import require_roles
from app.database import get_db
from app.models import User, SavedListing, Apprenticeship

router=APIRouter(prefix="/saved",tags=["Saved Listings"])
@router.post("/{listing_id}")
def save(listing_id:int,user:User=Depends(require_roles("candidate")),db:Session=Depends(get_db)):
    if not db.get(Apprenticeship,listing_id): raise HTTPException(404,"Listing not found")
    if not db.query(SavedListing).filter_by(candidate_id=user.id,apprenticeship_id=listing_id).first(): db.add(SavedListing(candidate_id=user.id,apprenticeship_id=listing_id)); db.commit()
    return {"saved":True}
@router.delete("/{listing_id}")
def unsave(listing_id:int,user:User=Depends(require_roles("candidate")),db:Session=Depends(get_db)):
    row=db.query(SavedListing).filter_by(candidate_id=user.id,apprenticeship_id=listing_id).first()
    if row: db.delete(row); db.commit()
    return {"saved":False}
@router.get("")
def mine(user:User=Depends(require_roles("candidate")),db:Session=Depends(get_db)):
    rows=db.query(SavedListing).filter_by(candidate_id=user.id).all(); return [{"listing_id":r.apprenticeship_id} for r in rows]
