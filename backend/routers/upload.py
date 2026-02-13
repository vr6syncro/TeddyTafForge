import logging
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

from backend.config import (
    ALLOWED_AUDIO_EXTENSIONS,
    ALLOWED_IMAGE_EXTENSIONS,
    CUSTOM_TAF_PATH,
)

log = logging.getLogger("tafforge.upload")

router = APIRouter(prefix="/api/upload", tags=["upload"])


def _ensure_project_dir(project_id: str) -> Path:
    project_dir = CUSTOM_TAF_PATH / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    return project_dir


@router.post("/audio")
async def upload_audio(
    file: UploadFile = File(...),
    project_id: str = Form(""),
):
    if not file.filename:
        raise HTTPException(400, "No filename")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(400, f"Unsupported audio format: {ext}")

    if not project_id:
        project_id = f"tbc-{uuid.uuid4()}"

    project_dir = _ensure_project_dir(project_id)
    audio_dir = project_dir / "source_audio"
    audio_dir.mkdir(exist_ok=True)

    dest = audio_dir / file.filename
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    size = dest.stat().st_size
    log.info("Audio hochgeladen: '%s' (%d Bytes) -> project=%s", file.filename, size, project_id)
    return {
        "project_id": project_id,
        "filename": file.filename,
        "path": str(dest.relative_to(CUSTOM_TAF_PATH)),
        "size": size,
    }


@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    project_id: str = Form(...),
    image_type: str = Form("cover", description="cover | track"),
    track_index: int = Form(0),
):
    if not file.filename:
        raise HTTPException(400, "No filename")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(400, f"Unsupported image format: {ext}")

    project_dir = _ensure_project_dir(project_id)

    if image_type == "cover":
        for old_ext in (".jpg", ".jpeg", ".png", ".webp"):
            old_cover = project_dir / f"cover{old_ext}"
            if old_cover.exists() and old_ext != ext:
                old_cover.unlink()
        dest = project_dir / f"cover{ext}"
    else:
        tracks_dir = project_dir / "tracks"
        tracks_dir.mkdir(exist_ok=True)
        dest = tracks_dir / f"track_{track_index:03d}{ext}"

    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    log.info("Bild hochgeladen: '%s' (%s) -> project=%s", dest.name, image_type, project_id)
    return {
        "project_id": project_id,
        "image_type": image_type,
        "filename": dest.name,
        "path": str(dest.relative_to(CUSTOM_TAF_PATH)),
    }
