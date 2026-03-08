import json
import io
import logging
import shutil
import struct
import tempfile
import time
import uuid
import zipfile
from pathlib import Path

import pyzipper

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from backend.config import CUSTOM_TAF_PATH
from backend.http_headers import content_disposition_attachment
from backend.routers.metadata import (
    _read_custom_json, _write_custom_json, _reload_teddycloud_cache, _extract_audio_ids, CUSTOM_JSON_PATH,
)

log = logging.getLogger("tafforge.projects")

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _scan_project(project_dir: Path) -> dict:
    """Liest Metadaten eines Projektordners."""
    try:
        project_meta = _compose_project_metadata(project_dir)
    except HTTPException:
        project_meta = {}
    meta: dict = {
        "name": project_dir.name,
        "title": str(project_meta.get("title") or project_dir.name),
        "series": str(project_meta.get("series") or ""),
        "episodes": str(project_meta.get("episodes") or ""),
        "language": str(project_meta.get("language") or ""),
        "category": str(project_meta.get("category") or ""),
        "audio_id": str(project_meta.get("audio_id") or ""),
        "taf_file": str(project_meta.get("taf_file") or ""),
        "chapters": project_meta.get("chapters") or [],
        "size_bytes": 0,
        "created": "",
        "has_cover": False,
        "has_label": False,
    }

    # TAF-Datei suchen
    for taf in project_dir.glob("*.taf"):
        meta["size_bytes"] = taf.stat().st_size
        meta["created"] = taf.stat().st_mtime
        if not meta["taf_file"]:
            meta["taf_file"] = taf.name
        break

    # Cover pruefen
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        if (project_dir / f"cover{ext}").exists():
            meta["has_cover"] = True
            break

    meta["has_label"] = (project_dir / "label.pdf").exists()

    return meta


def _sanitize_dirname(name: str) -> str:
    cleaned = "".join(ch for ch in name.strip() if ch not in '<>:"/\\|?*')
    cleaned = " ".join(cleaned.split())
    return cleaned or f"import-{uuid.uuid4().hex[:8]}"


def _unique_dirname(name: str) -> str:
    base = _sanitize_dirname(name)
    candidate = base
    idx = 2
    while (CUSTOM_TAF_PATH / candidate).exists():
        candidate = f"{base} ({idx})"
        idx += 1
    return candidate


def _read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    shift = 0
    value = 0
    while True:
        if pos >= len(buf):
            raise ValueError("Unexpected EOF while reading varint")
        b = buf[pos]
        pos += 1
        value |= (b & 0x7F) << shift
        if not (b & 0x80):
            return value, pos
        shift += 7
        if shift > 63:
            raise ValueError("Varint too large")


def _parse_taf_header(taf_path: Path) -> dict:
    with taf_path.open("rb") as f:
        header = f.read(4096)
    if len(header) < 8:
        return {"audio_id": "", "sha1": "", "track_count": 0}

    payload_len = struct.unpack(">I", header[:4])[0]
    payload = header[4:4 + payload_len]

    audio_id = ""
    sha1_hex = ""
    track_count = 0
    pos = 0
    while pos < len(payload):
        tag, pos = _read_varint(payload, pos)
        field = tag >> 3
        wire = tag & 0x07
        if wire == 0:
            val, pos = _read_varint(payload, pos)
            if field == 3:
                audio_id = str(val)
        elif wire == 2:
            length, pos = _read_varint(payload, pos)
            data = payload[pos:pos + length]
            pos += length
            if field == 1 and len(data) == 20:
                sha1_hex = data.hex()
            if field == 4:
                tpos = 0
                while tpos < len(data):
                    _, tpos = _read_varint(data, tpos)
                    track_count += 1
        else:
            break

    return {"audio_id": audio_id, "sha1": sha1_hex, "track_count": track_count}


def _read_project_meta_json(project_dir: Path) -> dict:
    for json_file in project_dir.glob("*.json"):
        if json_file.name == "tonie.json":
            continue
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(data, dict):
            return data
    return {}


def _find_matching_custom_entry(audio_id: str = "", title: str = "", series: str = "") -> dict:
    audio_id = str(audio_id or "").strip()
    title = str(title or "").strip()
    series = str(series or "").strip()

    for entry in _read_custom_json():
        if audio_id and audio_id in _extract_audio_ids(entry):
            return entry
        if title and entry.get("title") == title and str(entry.get("series") or "") == series:
            return entry
    return {}


def _compose_project_metadata(
    project_dir: Path,
    title_hint: str = "",
    series_hint: str = "",
    episodes_hint: str = "",
) -> dict:
    taf_files = sorted(project_dir.glob("*.taf"))
    if not taf_files:
        raise HTTPException(400, "Keine TAF-Datei im Projekt gefunden")
    taf_file = taf_files[0]

    header_info = _parse_taf_header(taf_file)
    existing = _read_project_meta_json(project_dir)
    existing_title = str(existing.get("title") or "").strip()
    existing_series = str(existing.get("series") or "").strip()
    custom_entry = _find_matching_custom_entry(
        audio_id=str(existing.get("audio_id") or header_info.get("audio_id") or ""),
        title=existing_title or title_hint or taf_file.stem,
        series=existing_series or series_hint,
    )

    title = (
        existing_title
        or str(custom_entry.get("title") or "").strip()
        or title_hint
        or taf_file.stem
    )
    series = (
        existing_series
        or str(custom_entry.get("series") or "").strip()
        or series_hint
        or ""
    )

    chapters_meta = existing.get("chapters") if isinstance(existing.get("chapters"), list) else []
    tracks_meta = existing.get("tracks") if isinstance(existing.get("tracks"), list) else []
    custom_tracks = custom_entry.get("tracks") if isinstance(custom_entry.get("tracks"), list) else []

    chapter_titles: list[str] = []
    if chapters_meta:
        for i, ch in enumerate(chapters_meta):
            if isinstance(ch, dict):
                chapter_titles.append(str(ch.get("title") or f"Kapitel {i + 1}"))
    elif tracks_meta:
        chapter_titles = [str(t) for t in tracks_meta if str(t).strip()]
    elif custom_tracks:
        chapter_titles = [str(t) for t in custom_tracks if str(t).strip()]
    else:
        count = max(1, int(header_info.get("track_count") or 0))
        chapter_titles = [f"Kapitel {i + 1}" for i in range(count)]

    custom_hashes = custom_entry.get("hash") if isinstance(custom_entry.get("hash"), list) else []
    custom_audio_ids = custom_entry.get("audio_id") if isinstance(custom_entry.get("audio_id"), list) else []

    return {
        "audio_id": str(
            existing.get("audio_id")
            or (custom_audio_ids[0] if custom_audio_ids else "")
            or header_info.get("audio_id")
            or ""
        ),
        "hash": str(
            existing.get("hash")
            or (custom_hashes[0] if custom_hashes else "")
            or header_info.get("sha1")
            or ""
        ),
        "title": title,
        "series": series,
        "pic": str(existing.get("pic") or custom_entry.get("pic") or ""),
        "chapters": [{"title": t} for t in chapter_titles],
        "tracks": chapter_titles,
        "taf_file": str(existing.get("taf_file") or taf_file.name),
        "episodes": str(existing.get("episodes") or custom_entry.get("episodes") or episodes_hint or title),
        "language": str(existing.get("language") or custom_entry.get("language") or "de-de"),
        "category": str(existing.get("category") or custom_entry.get("category") or "audio-play"),
    }


def _safe_extract_zip(zf: zipfile.ZipFile | pyzipper.AESZipFile, extract_dir: Path) -> None:
    root = extract_dir.resolve()
    for member in zf.infolist():
        target = (extract_dir / member.filename).resolve()
        if root not in target.parents and target != root:
            raise HTTPException(400, "ZIP enthaelt ungueltige Pfade")
    zf.extractall(extract_dir)


def _copy_project_tree(source_dir: Path, title_hint: str = "") -> tuple[Path, dict]:
    taf_candidates = sorted(source_dir.glob("*.taf"))
    if not taf_candidates:
        raise HTTPException(400, f"Projektordner ohne TAF-Datei: {source_dir.name}")

    meta_hint = {}
    for j in source_dir.glob("*.json"):
        try:
            data = json.loads(j.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(data, dict):
            meta_hint = data
            break

    final_name = _unique_dirname(str(meta_hint.get("title") or title_hint or taf_candidates[0].stem))
    project_dir = CUSTOM_TAF_PATH / final_name
    project_dir.mkdir(parents=True, exist_ok=True)

    for item in source_dir.iterdir():
        target = project_dir / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)

    return project_dir, meta_hint


class MetadataUpdateRequest(BaseModel):
    title: str | None = None
    series: str | None = None
    episodes: str | None = None
    language: str | None = None
    category: str | None = None
    chapters: list[str] | None = None


class BackupExportRequest(BaseModel):
    project_names: list[str]
    include_custom_json: bool = True
    password: str = ""


def _normalize_project_metadata(
    project_dir: Path,
    title_hint: str = "",
    series_hint: str = "",
    episodes_hint: str = "",
) -> dict:
    project_meta = _compose_project_metadata(
        project_dir,
        title_hint=title_hint,
        series_hint=series_hint,
        episodes_hint=episodes_hint,
    )

    meta_name = f"{_sanitize_dirname(project_meta['title'])}.json"
    (project_dir / meta_name).write_text(
        json.dumps(project_meta, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return project_meta


async def _ensure_custom_entry(project_meta: dict, force_update: bool = True) -> dict:
    audio_id = str(project_meta.get("audio_id") or "").strip()
    if not audio_id:
        return {"status": "skipped", "reason": "missing_audio_id"}

    entries = _read_custom_json()
    title = str(project_meta.get("title") or "")
    series = str(project_meta.get("series") or "")

    entry = {
        "no": "0",
        "model": audio_id,
        "audio_id": [audio_id],
        "hash": [str(project_meta.get("hash") or "")] if project_meta.get("hash") else [],
        "title": title,
        "series": series,
        "episodes": str(project_meta.get("episodes") or title),
        "tracks": project_meta.get("tracks") or [],
        "release": str(int(time.time())),
        "language": str(project_meta.get("language") or "de-de"),
        "category": str(project_meta.get("category") or "audio-play"),
        "pic": str(project_meta.get("pic") or ""),
    }

    idx = None
    for i, existing in enumerate(entries):
        if audio_id in _extract_audio_ids(existing):
            idx = i
            break
        if force_update and existing.get("title") == title and existing.get("series", "") == series:
            idx = i
            break

    if idx is not None:
        entries[idx] = entry
        action = "updated"
    else:
        entries.append(entry)
        action = "created"

    _write_custom_json(entries)
    await _reload_teddycloud_cache()
    return {"status": action, "audio_id": audio_id}


@router.get("")
async def list_projects():
    if not CUSTOM_TAF_PATH.exists():
        return {"projects": []}

    projects = []
    for entry in sorted(CUSTOM_TAF_PATH.iterdir()):
        if not entry.is_dir():
            continue
        # Ordner mit mindestens einer TAF oder JSON
        has_content = any(entry.glob("*.taf")) or any(entry.glob("*.json"))
        if has_content:
            projects.append(_scan_project(entry))

    # Neueste zuerst
    projects.sort(key=lambda p: float(p.get("created", 0) or 0), reverse=True)
    return {"projects": projects}


@router.get("/{name:path}/cover")
async def get_project_cover(name: str):
    project_dir = CUSTOM_TAF_PATH / name
    if not project_dir.exists() or not project_dir.is_dir():
        raise HTTPException(404, "Project not found")

    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        cover_path = project_dir / f"cover{ext}"
        if cover_path.exists():
            media_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
            return FileResponse(cover_path, media_type=media_types[ext])

    raise HTTPException(404, "Kein Cover vorhanden")


@router.get("/{name:path}")
async def get_project(name: str):
    project_dir = CUSTOM_TAF_PATH / name
    if not project_dir.exists() or not project_dir.is_dir():
        raise HTTPException(404, "Project not found")
    return _scan_project(project_dir)


@router.patch("/{name:path}/metadata")
async def update_project_metadata(name: str, payload: MetadataUpdateRequest):
    project_dir = CUSTOM_TAF_PATH / name
    if not project_dir.exists() or not project_dir.is_dir():
        raise HTTPException(404, "Project not found")

    meta_data = _normalize_project_metadata(project_dir)
    meta_json_path = project_dir / f"{_sanitize_dirname(str(meta_data.get('title') or project_dir.name))}.json"

    updates: dict = {}
    if payload.title is not None:
        updates["title"] = payload.title
    if payload.series is not None:
        updates["series"] = payload.series
    if payload.episodes is not None:
        updates["episodes"] = payload.episodes
    if payload.language is not None:
        updates["language"] = payload.language
    if payload.category is not None:
        updates["category"] = payload.category

    chapters_updated = False
    if payload.chapters is not None:
        meta_data["chapters"] = [{"title": t} for t in payload.chapters]
        meta_data["tracks"] = list(payload.chapters)
        chapters_updated = True

    if not updates and not chapters_updated:
        raise HTTPException(400, "Keine Felder zum Aktualisieren")

    meta_data.update(updates)
    if "title" in updates:
        new_meta_json_path = project_dir / f"{_sanitize_dirname(str(meta_data.get('title') or project_dir.name))}.json"
        if new_meta_json_path != meta_json_path and meta_json_path.exists():
            try:
                meta_json_path.unlink()
            except OSError:
                pass
        meta_json_path = new_meta_json_path
    meta_json_path.write_text(
        json.dumps(meta_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    audio_id = str(meta_data.get("audio_id") or "").strip()
    if audio_id:
        entries = _read_custom_json()
        for i, existing in enumerate(entries):
            if audio_id in _extract_audio_ids(existing):
                for key in ("title", "series", "episodes", "language", "category"):
                    if key in updates:
                        entries[i][key] = updates[key]
                if chapters_updated:
                    entries[i]["tracks"] = list(payload.chapters)
                _write_custom_json(entries)
                await _reload_teddycloud_cache()
                break

    return {"status": "updated", "name": name, "updates": updates}


@router.delete("/{name:path}")
async def delete_project(
    name: str,
    remove_custom: bool = True,
    remove_by_title: bool = True,
):
    project_dir = CUSTOM_TAF_PATH / name
    if not project_dir.exists() or not project_dir.is_dir():
        raise HTTPException(404, "Project not found")

    # Audio-ID aus Metadaten lesen fuer tonies.custom.json Cleanup
    meta = _scan_project(project_dir)
    audio_id = meta.get("audio_id", "")
    title = meta.get("title", "")
    series = meta.get("series", "")

    # Ordner loeschen
    shutil.rmtree(project_dir)

    # Eintrag aus tonies.custom.json entfernen
    removed_custom = 0
    if remove_custom:
        entries = _read_custom_json()
        new_entries = []
        for e in entries:
            by_audio = bool(audio_id and str(audio_id) in _extract_audio_ids(e))
            by_title = bool(remove_by_title and title and e.get("title") == title and e.get("series", "") == series)
            if by_audio or by_title:
                removed_custom += 1
                continue
            new_entries.append(e)

        if removed_custom > 0:
            _write_custom_json(new_entries)
            await _reload_teddycloud_cache()
            log.info("Custom-JSON Eintraege entfernt: %d (project=%s)", removed_custom, name)

    return {"status": "deleted", "name": name, "removed_custom": removed_custom}


@router.post("/import/taf")
async def import_taf(
    file: UploadFile = File(...),
    title: str = Form(""),
    series: str = Form(""),
    episodes: str = Form(""),
    create_custom_entry: bool = Form(True),
):
    if not file.filename:
        raise HTTPException(400, "No filename")

    ext = Path(file.filename).suffix.lower()
    if ext != ".taf":
        raise HTTPException(400, "Nur .taf Dateien sind erlaubt")

    final_name = _unique_dirname(title or Path(file.filename).stem)
    project_dir = CUSTOM_TAF_PATH / final_name
    project_dir.mkdir(parents=True, exist_ok=True)

    taf_name = f"{_sanitize_dirname(title or Path(file.filename).stem)}.taf"
    taf_dest = project_dir / taf_name
    with taf_dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    meta = _normalize_project_metadata(
        project_dir,
        title_hint=title,
        series_hint=series,
        episodes_hint=episodes,
    )

    custom_res = {"status": "skipped"}
    if create_custom_entry:
        custom_res = await _ensure_custom_entry(meta)

    return {
        "status": "imported",
        "project_id": project_dir.name,
        "title": meta.get("title", project_dir.name),
        "custom": custom_res,
    }


@router.post("/import/zip")
async def import_zip(
    file: UploadFile = File(...),
    create_custom_entry: bool = Form(True),
):
    if not file.filename:
        raise HTTPException(400, "No filename")
    if Path(file.filename).suffix.lower() != ".zip":
        raise HTTPException(400, "Nur .zip Dateien sind erlaubt")

    with tempfile.TemporaryDirectory(prefix="tafforge-import-") as tmp_dir_raw:
        tmp_dir = Path(tmp_dir_raw)
        zip_path = tmp_dir / "import.zip"
        with zip_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        extract_dir = tmp_dir / "extract"
        extract_dir.mkdir(parents=True, exist_ok=True)

        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                _safe_extract_zip(zf, extract_dir)
        except zipfile.BadZipFile as e:
            raise HTTPException(400, f"Ungueltige ZIP-Datei: {e}") from e

        taf_candidates = sorted(extract_dir.rglob("*.taf"))
        if not taf_candidates:
            raise HTTPException(400, "ZIP enthaelt keine TAF-Datei")

        first_taf = taf_candidates[0]
        source_root = first_taf.parent

        meta_hint = {}
        for j in source_root.glob("*.json"):
            try:
                data = json.loads(j.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if isinstance(data, dict):
                meta_hint = data
                break

        project_dir, _ = _copy_project_tree(source_root, title_hint=first_taf.stem)

    meta = _normalize_project_metadata(
        project_dir,
        title_hint=str(meta_hint.get("title") or ""),
        series_hint=str(meta_hint.get("series") or ""),
        episodes_hint=str(meta_hint.get("episodes") or ""),
    )

    custom_res = {"status": "skipped"}
    if create_custom_entry:
        custom_res = await _ensure_custom_entry(meta)

    return {
        "status": "imported",
        "project_id": project_dir.name,
        "title": meta.get("title", project_dir.name),
        "custom": custom_res,
    }


@router.post("/backup/export")
async def export_backup(payload: BackupExportRequest):
    project_names = [n.strip() for n in payload.project_names if n.strip()]
    if not project_names:
        raise HTTPException(400, "Keine Projekte fuer Backup ausgewaehlt")

    selected_dirs: list[Path] = []
    selected_ids: list[str] = []
    for name in project_names:
        project_dir = CUSTOM_TAF_PATH / name
        if not project_dir.exists() or not project_dir.is_dir():
            continue
        if not any(project_dir.glob("*.taf")):
            continue
        selected_dirs.append(project_dir)
        selected_ids.append(name)

    if not selected_dirs:
        raise HTTPException(400, "Keine gueltigen Projekte fuer Backup gefunden")

    manifest: dict = {
        "type": "tafforge-backup",
        "version": 2,
        "created": int(time.time()),
        "projects": selected_ids,
        "include_custom_json": bool(payload.include_custom_json),
        "encrypted": bool(payload.password),
    }

    buf = io.BytesIO()
    if payload.password:
        pwd = payload.password.encode("utf-8")
        zf_ctx = pyzipper.AESZipFile(buf, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES)
        zf_ctx.setpassword(pwd)
    else:
        zf_ctx = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)

    with zf_ctx as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))

        if payload.include_custom_json and CUSTOM_JSON_PATH.exists():
            zf.write(CUSTOM_JSON_PATH, arcname="tonies.custom.json")

        for project_dir in selected_dirs:
            base = f"projects/{project_dir.name}"
            for item in project_dir.rglob("*"):
                if item.is_dir():
                    continue
                rel = item.relative_to(project_dir).as_posix()
                zf.write(item, arcname=f"{base}/{rel}")

    buf.seek(0)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    filename = f"tafforge-backup-{stamp}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": content_disposition_attachment(filename)},
    )


@router.post("/backup/import")
async def import_backup(
    file: UploadFile = File(...),
    create_custom_entry: bool = Form(True),
    import_custom_json: bool = Form(True),
    password: str = Form(""),
):
    if not file.filename:
        raise HTTPException(400, "No filename")
    if Path(file.filename).suffix.lower() != ".zip":
        raise HTTPException(400, "Nur .zip Dateien sind erlaubt")

    imported_projects: list[dict] = []
    imported_count = 0
    skipped_count = 0
    merged_custom = False

    with tempfile.TemporaryDirectory(prefix="tafforge-backup-import-") as tmp_dir_raw:
        tmp_dir = Path(tmp_dir_raw)
        zip_path = tmp_dir / "backup.zip"
        with zip_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        extract_dir = tmp_dir / "extract"
        extract_dir.mkdir(parents=True, exist_ok=True)

        try:
            if password:
                with pyzipper.AESZipFile(zip_path, "r") as zf:
                    zf.setpassword(password.encode("utf-8"))
                    _safe_extract_zip(zf, extract_dir)
            else:
                try:
                    with zipfile.ZipFile(zip_path, "r") as zf:
                        _safe_extract_zip(zf, extract_dir)
                except RuntimeError as e:
                    if "password" in str(e).lower() or "encrypted" in str(e).lower():
                        raise HTTPException(400, "Backup ist passwortgeschuetzt") from e
                    raise
        except pyzipper.BadZipFile as e:
            raise HTTPException(400, f"Ungueltige ZIP-Datei oder falsches Passwort: {e}") from e
        except zipfile.BadZipFile as e:
            raise HTTPException(400, f"Ungueltige ZIP-Datei: {e}") from e

        project_roots = [p for p in (extract_dir / "projects").iterdir()] if (extract_dir / "projects").exists() else []
        valid_project_roots = [p for p in project_roots if p.is_dir() and any(p.glob("*.taf"))]
        if not valid_project_roots:
            raise HTTPException(400, "Backup enthaelt keine importierbaren Projekte")

        existing_audio_ids: set[str] = set()
        for entry in sorted(CUSTOM_TAF_PATH.iterdir()) if CUSTOM_TAF_PATH.exists() else []:
            if not entry.is_dir():
                continue
            pmeta = _read_project_meta_json(entry)
            aid = str(pmeta.get("audio_id") or "").strip()
            if aid:
                existing_audio_ids.add(aid)

        for source_root in sorted(valid_project_roots):
            source_meta = _read_project_meta_json(source_root)
            source_aid = str(source_meta.get("audio_id") or "").strip()
            if source_aid and source_aid in existing_audio_ids:
                skipped_count += 1
                log.info("Backup-Import: Projekt uebersprungen (audio_id %s existiert bereits)", source_aid)
                continue

            project_dir, meta_hint = _copy_project_tree(source_root, title_hint=source_root.name)
            meta = _normalize_project_metadata(
                project_dir,
                title_hint=str(meta_hint.get("title") or source_root.name),
                series_hint=str(meta_hint.get("series") or ""),
                episodes_hint=str(meta_hint.get("episodes") or ""),
            )
            imported_count += 1
            new_aid = str(meta.get("audio_id") or "").strip()
            if new_aid:
                existing_audio_ids.add(new_aid)
            imported_projects.append(
                {
                    "project_id": project_dir.name,
                    "title": meta.get("title", project_dir.name),
                    "audio_id": new_aid,
                }
            )
            if create_custom_entry:
                await _ensure_custom_entry(meta)

        backup_custom_path = extract_dir / "tonies.custom.json"
        if import_custom_json and backup_custom_path.exists():
            try:
                backup_entries = json.loads(backup_custom_path.read_text(encoding="utf-8"))
                if isinstance(backup_entries, list):
                    existing = _read_custom_json()
                    existing_ids: set[str] = set()
                    for e in existing:
                        for aid in _extract_audio_ids(e):
                            existing_ids.add(aid)
                    deduped = [
                        entry for entry in backup_entries
                        if not any(aid in existing_ids for aid in _extract_audio_ids(entry))
                    ]
                    if deduped:
                        _write_custom_json(existing + deduped)
                    elif backup_entries:
                        log.info("Backup custom.json: alle Eintraege bereits vorhanden, uebersprungen")
                    merged_custom = bool(deduped)
            except (json.JSONDecodeError, OSError):
                log.warning("Backup tonies.custom.json konnte nicht gemerged werden")

        if merged_custom:
            await _reload_teddycloud_cache()

    return {
        "status": "imported",
        "imported_count": imported_count,
        "skipped_count": skipped_count,
        "projects": imported_projects,
        "merged_custom_json": merged_custom,
    }


@router.post("/cleanup-temp/{name:path}")
async def cleanup_temp_project(name: str):
    project_dir = CUSTOM_TAF_PATH / name
    if not project_dir.exists() or not project_dir.is_dir():
        return {"status": "not_found", "name": name}

    source_dir = project_dir / "source_audio"
    removed = False
    if source_dir.exists():
        shutil.rmtree(source_dir, ignore_errors=True)
        removed = True

    # Falls nur temporaere Reste uebrig sind, Ordner komplett entfernen.
    remaining_files = [p for p in project_dir.rglob("*") if p.is_file()]
    if not remaining_files:
        shutil.rmtree(project_dir, ignore_errors=True)
        return {"status": "removed_project", "name": name, "removed_temp": removed}

    return {"status": "cleaned", "name": name, "removed_temp": removed}
