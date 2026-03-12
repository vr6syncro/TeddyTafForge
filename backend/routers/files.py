from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from backend.config import (
    ALLOWED_AUDIO_EXTENSIONS,
    ALLOWED_IMAGE_EXTENSIONS,
    LIBRARY_PATH,
    CONTENT_PATH,
)
from backend.path_utils import ensure_within

router = APIRouter(prefix="/api/files", tags=["files"])

BROWSABLE_ROOTS = {
    "library": LIBRARY_PATH,
    "content": CONTENT_PATH,
}


@router.get("/browse")
async def browse_directory(
    root: str = Query("library", description="Root volume: library | content"),
    path: str = Query("", description="Relative sub-path"),
):
    base = BROWSABLE_ROOTS.get(root)
    if base is None:
        raise HTTPException(400, f"Unknown root: {root}")

    target = ensure_within(base, base / path, "Path traversal not allowed")
    if not target.exists():
        raise HTTPException(404, "Path not found")
    if not target.is_dir():
        raise HTTPException(400, "Not a directory")

    entries = []
    for item in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        entry = {
            "name": item.name,
            "type": "dir" if item.is_dir() else "file",
            "path": str(item.relative_to(base)),
        }
        if item.is_file():
            entry["size"] = item.stat().st_size
            entry["ext"] = item.suffix.lower()
        entries.append(entry)

    return {"root": root, "path": path, "entries": entries}


@router.get("/search")
async def search_files(
    root: str = Query("library"),
    query: str = Query(..., min_length=1, description="Search term"),
    audio_only: bool = Query(False),
    images_only: bool = Query(False),
):
    base = BROWSABLE_ROOTS.get(root)
    if base is None:
        raise HTTPException(400, f"Unknown root: {root}")

    if not base.exists():
        return {"results": []}

    allowed_ext = None
    if audio_only:
        allowed_ext = ALLOWED_AUDIO_EXTENSIONS
    elif images_only:
        allowed_ext = ALLOWED_IMAGE_EXTENSIONS

    results = []
    query_lower = query.lower()
    for item in base.rglob("*"):
        if not item.is_file():
            continue
        if query_lower not in item.name.lower():
            continue
        if allowed_ext and item.suffix.lower() not in allowed_ext:
            continue
        results.append({
            "name": item.name,
            "path": str(item.relative_to(base)),
            "size": item.stat().st_size,
            "ext": item.suffix.lower(),
        })
        if len(results) >= 200:
            break

    return {"root": root, "query": query, "results": results}
