from pathlib import Path

from fastapi import HTTPException

from backend.config import CUSTOM_TAF_PATH


def ensure_within(base: Path, target: Path, detail: str) -> Path:
    base_resolved = base.resolve()
    target_resolved = target.resolve(strict=False)
    if target_resolved != base_resolved and base_resolved not in target_resolved.parents:
        raise HTTPException(403, detail)
    return target_resolved


def resolve_project_dir(project_id: str, *, create: bool = False) -> Path:
    project_name = str(project_id or "").strip()
    if not project_name:
        raise HTTPException(400, "Project not found")

    project_dir = ensure_within(CUSTOM_TAF_PATH, CUSTOM_TAF_PATH / project_name, "Project path not allowed")
    if create:
        project_dir.mkdir(parents=True, exist_ok=True)
    return project_dir


def sanitize_uploaded_filename(filename: str, *, fallback: str) -> str:
    raw_name = str(filename or "").replace("\x00", "").replace("\\", "/").split("/")[-1].strip()
    if not raw_name:
        return fallback

    cleaned = "".join(ch for ch in raw_name if ch not in '<>:"/\\|?*')
    cleaned = " ".join(cleaned.split()).strip(" .")
    return cleaned or fallback


def unique_child_path(directory: Path, preferred_name: str) -> Path:
    candidate_name = sanitize_uploaded_filename(preferred_name, fallback="upload")
    stem = Path(candidate_name).stem or "upload"
    suffix = Path(candidate_name).suffix.lower()

    candidate = directory / f"{stem}{suffix}"
    counter = 2
    while candidate.exists():
        candidate = directory / f"{stem} ({counter}){suffix}"
        counter += 1
    return candidate
