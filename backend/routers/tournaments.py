import time
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from audit import log_action
from database import get_db
from deps import require_admin
from hsr_config import format_ist_now
import models

router = APIRouter()


class CreateTournament(BaseModel):
    name: str
    game_type: str = "8 Ball"
    entry_fee: int = 0
    players: List[str]


class RecordWinner(BaseModel):
    winner: str


def _fmt_tournament(t: models.Tournament, db: Session):
    players = db.query(models.TournamentPlayer).filter(
        models.TournamentPlayer.tournament_id == t.id
    ).order_by(models.TournamentPlayer.seed.asc()).all()
    matches = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == t.id
    ).order_by(
        models.TournamentMatch.round_no.asc(),
        models.TournamentMatch.match_no.asc(),
    ).all()
    return {
        "id": t.id,
        "name": t.name,
        "game_type": t.game_type,
        "entry_fee": t.entry_fee,
        "status": t.status,
        "winner_name": t.winner_name,
        "created_at": t.created_at,
        "players": [
            {
                "id": p.id,
                "name": p.name,
                "seed": p.seed,
                "eliminated": p.eliminated,
            }
            for p in players
        ],
        "matches": [
            {
                "id": m.id,
                "round_no": m.round_no,
                "match_no": m.match_no,
                "player1": m.player1,
                "player2": m.player2,
                "winner": m.winner,
                "status": m.status,
                "completed_at": m.completed_at,
            }
            for m in matches
        ],
    }


def _create_round(db: Session, tournament_id: int, round_no: int, names: list[str]) -> None:
    match_no = 1
    for i in range(0, len(names), 2):
        player1 = names[i]
        player2 = names[i + 1] if i + 1 < len(names) else ""
        is_bye = not player2
        db.add(models.TournamentMatch(
            tournament_id=tournament_id,
            round_no=round_no,
            match_no=match_no,
            player1=player1,
            player2=player2,
            winner=player1 if is_bye else "",
            status="completed" if is_bye else "scheduled",
            completed_at=format_ist_now() if is_bye else "",
        ))
        match_no += 1


def _advance_if_round_complete(db: Session, tournament: models.Tournament, round_no: int) -> None:
    current = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tournament.id,
        models.TournamentMatch.round_no == round_no,
    ).order_by(models.TournamentMatch.match_no.asc()).all()
    if not current or any(m.status != "completed" for m in current):
        return

    winners = [m.winner for m in current if m.winner]
    if len(winners) == 1:
        tournament.status = "completed"
        tournament.winner_name = winners[0]
        log_action(
            db,
            "tournament_completed",
            f"{tournament.name} won by {winners[0]}",
            severity="info",
            amount=tournament.entry_fee * len(winners),
        )
        return

    existing_next = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.tournament_id == tournament.id,
        models.TournamentMatch.round_no == round_no + 1,
    ).first()
    if not existing_next:
        _create_round(db, tournament.id, round_no + 1, winners)
        _advance_if_round_complete(db, tournament, round_no + 1)


@router.get("/")
def list_tournaments(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    rows = db.query(models.Tournament).order_by(models.Tournament.ts.desc()).all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "game_type": t.game_type,
            "entry_fee": t.entry_fee,
            "status": t.status,
            "winner_name": t.winner_name,
            "created_at": t.created_at,
        }
        for t in rows
    ]


@router.post("/")
def create_tournament(body: CreateTournament, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    players = [p.strip() for p in body.players if p.strip()]
    if len(players) < 2:
        raise HTTPException(status_code=400, detail="Add at least 2 players")
    if len(set(p.lower() for p in players)) != len(players):
        raise HTTPException(status_code=400, detail="Player names must be unique")

    t = models.Tournament(
        name=body.name.strip() or "Tournament",
        game_type=body.game_type.strip() or "8 Ball",
        entry_fee=max(0, body.entry_fee),
        status="active",
        winner_name="",
        created_at=format_ist_now(),
        ts=time.time() * 1000,
    )
    db.add(t)
    db.flush()

    for index, name in enumerate(players, start=1):
        db.add(models.TournamentPlayer(
            tournament_id=t.id,
            name=name,
            seed=index,
            eliminated=False,
        ))
    _create_round(db, t.id, 1, players)
    _advance_if_round_complete(db, t, 1)
    log_action(
        db,
        "tournament_created",
        f"{t.name} created with {len(players)} players",
        amount=t.entry_fee * len(players),
    )
    db.commit()
    db.refresh(t)
    return _fmt_tournament(t, db)


@router.get("/{tournament_id}")
def get_tournament(tournament_id: int, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    t = db.query(models.Tournament).filter(models.Tournament.id == tournament_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tournament not found")
    return _fmt_tournament(t, db)


@router.post("/{tournament_id}/matches/{match_id}/winner")
def record_winner(
    tournament_id: int,
    match_id: int,
    body: RecordWinner,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    tournament = db.query(models.Tournament).filter(models.Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")
    if tournament.status == "completed":
        raise HTTPException(status_code=400, detail="Tournament already completed")

    match = db.query(models.TournamentMatch).filter(
        models.TournamentMatch.id == match_id,
        models.TournamentMatch.tournament_id == tournament_id,
    ).first()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status == "completed":
        raise HTTPException(status_code=400, detail="Match already completed")

    winner = body.winner.strip()
    if winner not in [match.player1, match.player2]:
        raise HTTPException(status_code=400, detail="Winner must be one of the match players")

    loser = match.player2 if winner == match.player1 else match.player1
    match.winner = winner
    match.status = "completed"
    match.completed_at = format_ist_now()

    player = db.query(models.TournamentPlayer).filter(
        models.TournamentPlayer.tournament_id == tournament_id,
        models.TournamentPlayer.name == loser,
    ).first()
    if player:
        player.eliminated = True

    log_action(
        db,
        "tournament_match_result",
        f"{winner} defeated {loser} in {tournament.name}",
    )
    _advance_if_round_complete(db, tournament, match.round_no)
    db.commit()
    db.refresh(tournament)
    return _fmt_tournament(tournament, db)


@router.post("/{tournament_id}/close")
def close_tournament(tournament_id: int, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    t = db.query(models.Tournament).filter(models.Tournament.id == tournament_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tournament not found")
    t.status = "completed"
    log_action(db, "tournament_closed", f"{t.name} closed manually", severity="warning")
    db.commit()
    return _fmt_tournament(t, db)
