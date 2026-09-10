from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db
from deps import require_admin
from hsr_config import get_ist_today_str
import models
from validators import require_full_name

router = APIRouter()
MERGE_SCORE_THRESHOLD = 88

class AddMember(BaseModel):
    name: str

class RestoreMember(BaseModel):
    name: str
    phone: str = ""
    visits: int = 0
    spent: int = 0
    loyalty_points: int = 0
    member_type: str = "Regular"
    last_visit: str = "-"
    notes: str = ""

class MergeMembers(BaseModel):
    primary_id: str
    duplicate_id: str


def _next_customer_id(db: Session) -> str:
    members = db.query(models.Member.customer_id).all()
    used = []
    for (customer_id,) in members:
        if customer_id and customer_id.startswith("CUS") and customer_id[3:].isdigit():
            used.append(int(customer_id[3:]))
    return f"CUS{str((max(used) if used else 0) + 1).zfill(3)}"


def _name_tokens(name: str) -> set[str]:
    return {p.lower() for p in (name or "").replace(".", " ").split() if len(p) > 1}


def _ordered_name_tokens(name: str) -> list[str]:
    return [p.lower() for p in (name or "").replace(".", " ").split() if len(p) > 1]


def _edit_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            curr.append(min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + (0 if ca == cb else 1),
            ))
        prev = curr
    return prev[-1]


def _token_close(a: str, b: str) -> bool:
    return _edit_distance(a, b) <= 1 if min(len(a), len(b)) >= 4 else a == b


def _similarity(a: str, b: str) -> int:
    ordered_a, ordered_b = _ordered_name_tokens(a), _ordered_name_tokens(b)
    if len(ordered_a) < 2 or len(ordered_b) < 2:
        return 0

    normalized_a = " ".join(ordered_a)
    normalized_b = " ".join(ordered_b)
    if normalized_a == normalized_b:
        return 100

    first_a, first_b = ordered_a[0], ordered_b[0]
    last_a, last_b = ordered_a[-1], ordered_b[-1]

    if first_a == first_b and last_a == last_b:
        return 98
    if first_a == first_b and _token_close(last_a, last_b):
        return 94
    if _token_close(first_a, first_b) and last_a == last_b:
        return 92

    ta, tb = set(ordered_a), set(ordered_b)
    overlap = len(ta & tb)
    if overlap == len(ta) == len(tb) and len(ta) >= 2:
        return 90
    return 0

def _member_tier(spent: int) -> str:
    if spent >= 25000:
        return "Platinum"
    if spent >= 10000:
        return "Gold"
    if spent >= 3000:
        return "Silver"
    return "Regular"

def _member_payload(member: models.Member):
    return {
        "id": member.customer_id,
        "nm": member.name,
        "vis": member.visits,
        "spt": member.spent,
        "typ": member.member_type,
        "lst": member.last_visit,
        "pts": getattr(member, "loyalty_points", 0) or 0,
        "phone": getattr(member, "phone", "") or "",
    }


@router.get("/search")
def search_members(q: str = "", db: Session = Depends(get_db)):
    if not q or len(q) < 2:
        return []
    matches = db.query(models.Member).filter(
        models.Member.name.ilike(f"%{q}%")
    ).limit(6).all()
    return [{"id": m.customer_id, "nm": m.name} for m in matches]

@router.get("/")
def get_members(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    members = db.query(models.Member).order_by(models.Member.spent.desc()).all()
    return [_member_payload(m) for m in members]

@router.get("/duplicates")
def find_duplicate_members(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    members = db.query(models.Member).all()
    groups = []
    seen = set()
    for i, a in enumerate(members):
        matches = []
        for b in members[i + 1:]:
            score = _similarity(a.name, b.name)
            if score >= MERGE_SCORE_THRESHOLD:
                matches.append({
                    "id": b.customer_id,
                    "name": b.name,
                    "visits": b.visits,
                    "spent": b.spent,
                    "type": b.member_type,
                    "score": score,
                })
        if matches and a.customer_id not in seen:
            seen.add(a.customer_id)
            groups.append({
                "primary": {
                    "id": a.customer_id,
                    "name": a.name,
                    "visits": a.visits,
                    "spent": a.spent,
                    "type": a.member_type,
                },
                "matches": matches,
            })
    return groups

@router.post("/")
def add_member(body: AddMember, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    name = require_full_name(body.name, "Member name")

    exists = db.query(models.Member).filter(
        models.Member.name.ilike(name)
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="Member already exists")

    customer_id = _next_customer_id(db)

    db.add(models.Member(
        customer_id = customer_id,
        name        = name,
        visits      = 0,
        spent       = 0,
        member_type = "Regular",
        last_visit  = "-"
    ))
    db.commit()
    return {"ok": True, "id": customer_id}

@router.post("/merge")
def merge_members(body: MergeMembers, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    if body.primary_id == body.duplicate_id:
        raise HTTPException(status_code=400, detail="Choose two different members")
    primary = db.query(models.Member).filter(models.Member.customer_id == body.primary_id).first()
    duplicate = db.query(models.Member).filter(models.Member.customer_id == body.duplicate_id).first()
    if not primary or not duplicate:
        raise HTTPException(status_code=404, detail="Member not found")
    if _similarity(primary.name, duplicate.name) < MERGE_SCORE_THRESHOLD:
        raise HTTPException(
            status_code=400,
            detail="These names are not similar enough to merge automatically",
        )

    primary.visits += duplicate.visits
    primary.spent += duplicate.spent
    if primary.member_type != "Premium" and duplicate.member_type == "Premium":
        primary.member_type = "Premium"
    if duplicate.last_visit != "-" and (
        primary.last_visit == "-" or duplicate.last_visit > primary.last_visit
    ):
        primary.last_visit = duplicate.last_visit

    for t in db.query(models.Transaction).filter(models.Transaction.customer_name.ilike(duplicate.name)).all():
        t.customer_name = primary.name

    db.delete(duplicate)
    db.commit()
    return {"ok": True}

@router.post("/{customer_id}/upgrade")
def upgrade_member(customer_id: str, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    m = db.query(models.Member).filter(models.Member.customer_id == customer_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    m.member_type = "Regular" if m.member_type == "Premium" else "Premium"
    db.commit()
    return {"ok": True, "typ": m.member_type}

@router.post("/{customer_id}/restore")
def restore_member(
    customer_id: str,
    body: RestoreMember,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    name = " ".join((body.name or "").strip().split())
    if not name:
        raise HTTPException(status_code=400, detail="Member name is required")
    member = db.query(models.Member).filter(models.Member.customer_id == customer_id).first()
    if not member:
        member = models.Member(customer_id=customer_id)
        db.add(member)
    member.name = name
    member.phone = body.phone or ""
    member.visits = max(0, int(body.visits or 0))
    member.spent = max(0, int(body.spent or 0))
    member.loyalty_points = max(0, int(body.loyalty_points or 0))
    member.member_type = body.member_type or _member_tier(member.spent)
    member.last_visit = body.last_visit or "-"
    member.notes = body.notes or ""
    db.commit()
    db.refresh(member)
    return _member_payload(member)

@router.delete("/{customer_id}")
def delete_member(customer_id: str, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    member = db.query(models.Member).filter(models.Member.customer_id == customer_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(member)
    db.commit()
    return {"ok": True}

def update_member_on_checkout(name: str, amount: int, db: Session):
    clean_name = " ".join((name or "").strip().split())
    if not clean_name or clean_name.lower() in {"lp session", "walk in customer", "player one", "player two"}:
        return
    member = db.query(models.Member).filter(
        models.Member.name.ilike(clean_name)
    ).first()
    if not member:
        member = models.Member(
            customer_id=_next_customer_id(db),
            name=clean_name,
            visits=0,
            spent=0,
            member_type="Regular",
            last_visit="-",
        )
        db.add(member)
        db.flush()
    member.visits += 1
    member.spent += max(0, int(amount or 0))
    member.loyalty_points = (getattr(member, "loyalty_points", 0) or 0) + max(0, int(amount or 0)) // 100
    member.member_type = _member_tier(member.spent)
    member.last_visit = get_ist_today_str()
