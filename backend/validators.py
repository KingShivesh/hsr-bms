from fastapi import HTTPException


def require_full_name(name: str, label: str = "Name") -> str:
    cleaned = " ".join((name or "").strip().split())
    parts = [p for p in cleaned.split(" ") if p]
    if len(parts) < 2 or any(len(p) < 2 for p in parts[:2]):
        raise HTTPException(
            status_code=400,
            detail=f"{label} must include full name, e.g. first and last name",
        )
    return cleaned
