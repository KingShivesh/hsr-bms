from datetime import datetime
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from validators import require_full_name

router = APIRouter()
GAME_TYPES = {"8 Ball", "9 Ball", "10 Ball", "Snooker", "Straight Pool"}


class ChallengeBody(BaseModel):
    player_name: str
    game_type: str = "8 Ball"
    preferred_time: str = ""
    note: str = ""


class MatchBody(BaseModel):
    opponent_name: str


def _fmt(c: models.Challenge) -> dict:
    return {
        "id": c.id,
        "player_name": c.player_name,
        "game_type": c.game_type,
        "preferred_time": c.preferred_time or "",
        "note": c.note or "",
        "status": c.status,
        "opponent_name": c.opponent_name or "",
        "created_at": c.created_at,
    }


@router.get("")
def list_challenges(db: Session = Depends(get_db)):
    rows = (
        db.query(models.Challenge)
        .filter(models.Challenge.status == "open")
        .order_by(models.Challenge.ts.desc())
        .all()
    )
    return [_fmt(c) for c in rows]


@router.post("")
def create_challenge(body: ChallengeBody, db: Session = Depends(get_db)):
    player = require_full_name(body.player_name, "Challenge player name")
    game_type = body.game_type.strip() or "8 Ball"
    if game_type not in GAME_TYPES:
        raise HTTPException(status_code=400, detail="Invalid challenge game type")
    challenge = models.Challenge(
        player_name=player,
        game_type=game_type,
        preferred_time=body.preferred_time.strip(),
        note=body.note.strip(),
        status="open",
        created_at=datetime.now().strftime("%d/%m/%Y, %H:%M"),
        ts=time.time() * 1000,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return _fmt(challenge)


@router.post("/{challenge_id}/match")
def match_challenge(challenge_id: int, body: MatchBody, db: Session = Depends(get_db)):
    challenge = db.query(models.Challenge).filter(models.Challenge.id == challenge_id).first()
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if challenge.status != "open":
        raise HTTPException(status_code=400, detail="Challenge is no longer open")
    opponent = require_full_name(body.opponent_name, "Opponent name")
    if opponent.lower() == challenge.player_name.lower():
        raise HTTPException(status_code=400, detail="Opponent must be a different player")
    challenge.opponent_name = opponent
    challenge.status = "matched"
    db.commit()
    return {"ok": True}


@router.delete("/{challenge_id}")
def close_challenge(challenge_id: int, db: Session = Depends(get_db)):
    challenge = db.query(models.Challenge).filter(models.Challenge.id == challenge_id).first()
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    challenge.status = "closed"
    db.commit()
    return {"ok": True}
