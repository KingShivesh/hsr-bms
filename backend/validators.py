from fastapi import HTTPException


def require_full_name(name: str, label: str = "Name") -> str:
    cleaned = " ".join((name or "").strip().split())
    if not cleaned:
        raise HTTPException(
            status_code=400,
            detail=f"{label} is required",
        )
    return cleaned
