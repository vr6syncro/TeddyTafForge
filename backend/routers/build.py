import asyncio
import json
import logging
import re
import shutil
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import CUSTOM_TAF_PATH
from backend.routers.metadata import (
    _read_custom_json, _write_custom_json, _reload_teddycloud_cache, audio_id_exists,
)
from backend.routers.label import _find_cover
from backend.taf.encoder import TafEncoder, generate_audio_id

log = logging.getLogger("tafforge.build")

PLUGIN_COVERS_DIR = Path("/teddycloud/data/www/plugins/teddytafforge/covers")

router = APIRouter(prefix="/api/build", tags=["build"])


class Chapter(BaseModel):
    title: str = ""
    source: str
    start_time: float | None = None
    end_time: float | None = None


class BuildRequest(BaseModel):
    project_id: str = ""
    title: str = "Custom Tonie"
    series: str = ""
    episodes: str = ""
    language: str = "de-de"
    category: str = "audio-play"
    chapters: list[Chapter]
    bitrate: int = 96
    create_custom_entry: bool = True


class BuildStatus(BaseModel):
    project_id: str
    status: str
    progress: int = 0
    message: str = ""
    taf_path: str = ""


_build_jobs: dict[str, BuildStatus] = {}


def _sanitize_dirname(title: str) -> str:
    """Erzeuge einen dateisystem-sicheren Ordnernamen aus dem Titel."""
    name = title.strip()
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = re.sub(r'\s+', ' ', name)
    if not name:
        name = f"tonie-{uuid.uuid4().hex[:8]}"
    return name


def _unique_dirname(title: str) -> str:
    """Erzeuge einen eindeutigen Ordnernamen (haengt Zahl an falls noetig)."""
    base = _sanitize_dirname(title)
    candidate = base
    counter = 2
    while (CUSTOM_TAF_PATH / candidate).exists():
        candidate = f"{base} ({counter})"
        counter += 1
    return candidate


@router.post("/start")
async def start_build(request: BuildRequest):
    if not request.chapters:
        raise HTTPException(400, "At least one chapter required")
    if len(request.chapters) > 100:
        raise HTTPException(400, "Maximum 100 chapters allowed")

    project_id = request.project_id or f"tbc-{uuid.uuid4()}"
    log.info("Build gestartet: project_id=%s, title='%s', chapters=%d, bitrate=%d",
             project_id, request.title, len(request.chapters), request.bitrate)

    status = BuildStatus(
        project_id=project_id,
        status="queued",
        message="Build in Warteschlange",
    )
    _build_jobs[project_id] = status

    asyncio.create_task(_run_build(project_id, request))

    return {"project_id": project_id, "status": "queued"}


@router.get("/status/{project_id:path}")
async def get_build_status(project_id: str):
    status = _build_jobs.get(project_id)
    if status is None:
        raise HTTPException(404, "Build job not found")
    return status


async def _run_build(project_id: str, request: BuildRequest) -> None:
    status = _build_jobs[project_id]
    project_dir = CUSTOM_TAF_PATH / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    try:
        status.status = "encoding"
        status.message = "TAF wird erstellt..."
        status.progress = 10

        # Audio-ID generieren und gegen offizielle + custom DB pruefen
        audio_id = generate_audio_id()
        collision = audio_id_exists(audio_id)
        retries = 0
        while collision and retries < 10:
            log.warning(
                "Audio-ID %d kollidiert mit '%s' (%s) - generiere neue",
                audio_id, collision["title"], collision["source"],
            )
            await asyncio.sleep(1.1)
            audio_id = generate_audio_id()
            collision = audio_id_exists(audio_id)
            retries += 1

        if collision:
            raise RuntimeError(
                f"Audio-ID Kollision nach {retries} Versuchen: "
                f"{audio_id} existiert in {collision['source']} ('{collision['title']}')"
            )
        log.info("Audio-ID generiert: %d (dezimal, keine Kollision)", audio_id)

        # Decode chapters to raw PCM via FFmpeg
        chapter_pcm: list[bytes] = []
        for i, chapter in enumerate(request.chapters):
            status.progress = 10 + int(60 * i / len(request.chapters))
            status.message = f"Kapitel {i + 1}/{len(request.chapters)} wird dekodiert..."

            source_path = _resolve_source(project_id, chapter.source)
            log.info("Dekodiere Kapitel %d/%d: source='%s', start=%s, end=%s",
                     i + 1, len(request.chapters), source_path,
                     chapter.start_time, chapter.end_time)

            pcm = await _decode_to_pcm(source_path, chapter.start_time, chapter.end_time)
            pcm_duration_s = len(pcm) / (48000 * 2 * 2)
            log.info("Kapitel %d dekodiert: %d Bytes PCM (%.1f Sekunden)",
                     i + 1, len(pcm), pcm_duration_s)
            chapter_pcm.append(pcm)

        status.status = "building"
        status.message = "TAF wird zusammengebaut..."
        status.progress = 75

        # Ordner nach Titel umbenennen
        final_dirname = _unique_dirname(request.title)
        final_dir = CUSTOM_TAF_PATH / final_dirname
        if project_dir != final_dir:
            log.info("Ordner umbenennen: '%s' -> '%s'", project_dir.name, final_dirname)
            project_dir.rename(final_dir)
            project_dir = final_dir

        taf_file = project_dir / f"{_sanitize_dirname(request.title)}.taf"

        # Run the synchronous TAF encoder in a thread
        log.info("Starte TAF-Encoding: file='%s', audio_id=%d, bitrate=%d",
                 taf_file.name, audio_id, request.bitrate)
        build_result = await asyncio.get_event_loop().run_in_executor(
            None, _build_taf, taf_file, chapter_pcm, request.bitrate, audio_id,
        )
        sha1_hex = build_result["sha1_hex"]

        taf_size = taf_file.stat().st_size
        log.info("TAF erstellt: %d Bytes, SHA1=%s", taf_size, sha1_hex)

        status.message = "Metadaten werden geschrieben..."
        status.progress = 90

        # Cover-Bild fuer TeddyCloud bereitstellen (via shared plugins volume)
        pic_url = ""
        cover_path = _find_cover(project_dir)
        if cover_path:
            try:
                PLUGIN_COVERS_DIR.mkdir(parents=True, exist_ok=True)
                cover_dest = PLUGIN_COVERS_DIR / f"{_sanitize_dirname(request.title)}{cover_path.suffix}"
                shutil.copy2(cover_path, cover_dest)
                pic_url = f"/plugins/teddytafforge/covers/{cover_dest.name}"
                log.info("Cover kopiert: '%s' -> pic='%s'", cover_path.name, pic_url)
            except OSError as e:
                log.warning("Cover kopieren fehlgeschlagen: %s", e)

        # {titel}.json im Projektordner erstellen
        track_names = [
            ch.title or f"Kapitel {i + 1}"
            for i, ch in enumerate(request.chapters)
        ]
        project_meta = {
            "audio_id": str(audio_id),
            "hash": sha1_hex,
            "title": request.title,
            "series": request.series,
            "episodes": request.episodes or request.title,
            "language": request.language,
            "category": request.category,
            "pic": pic_url,
            "chapters": [
                {"title": ch.title or f"Kapitel {i + 1}"}
                for i, ch in enumerate(request.chapters)
            ],
            "tracks": track_names,
            "taf_file": taf_file.name,
        }
        meta_json_name = f"{_sanitize_dirname(request.title)}.json"
        meta_json_path = project_dir / meta_json_name
        meta_json_path.write_text(
            json.dumps(project_meta, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        log.info("Projekt-JSON geschrieben: '%s'", meta_json_name)

        # tonies.custom.json: Eintrag im korrekten TeddyCloud-Format
        if request.create_custom_entry:
            status.message = "Custom Tonie wird registriert..."
            status.progress = 95

            entry = {
                "no": "0",
                "model": str(audio_id),
                "audio_id": [str(audio_id)],
                "hash": [sha1_hex],
                "title": request.title,
                "series": request.series,
                "episodes": request.episodes or request.title,
                "tracks": track_names,
                "release": str(int(time.time())),
                "language": request.language,
                "category": request.category,
                "pic": pic_url,
            }

            log.info("Custom-JSON Eintrag: audio_id=[%s], hash=[%s], title='%s'",
                     audio_id, sha1_hex[:16] + "...", request.title)
            log.debug("Custom-JSON Eintrag komplett: %s", json.dumps(entry, indent=2))

            entries = _read_custom_json()

            # Duplikat-Check: existierenden Eintrag mit gleichem Titel+Serie aktualisieren
            existing_idx = None
            for i, e in enumerate(entries):
                if e.get("title") == request.title and e.get("series", "") == request.series:
                    existing_idx = i
                    break

            if existing_idx is not None:
                log.info("Existierenden Eintrag aktualisiert (Index %d)", existing_idx)
                entries[existing_idx] = entry
            else:
                log.info("Neuen Eintrag hinzugefuegt (gesamt: %d)", len(entries) + 1)
                entries.append(entry)

            _write_custom_json(entries)
            await _reload_teddycloud_cache()
            log.info("TeddyCloud Cache Reload ausgeloest")

        # Update project_id im Status auf den neuen Ordnernamen
        status.project_id = final_dirname
        status.status = "done"
        status.message = "Fertig!"
        status.progress = 100
        status.taf_path = str(taf_file.relative_to(CUSTOM_TAF_PATH))

        # Status auch unter neuem Key erreichbar machen
        if final_dirname != project_id:
            _build_jobs[final_dirname] = status

        log.info("Build abgeschlossen: '%s' -> '%s'", request.title, status.taf_path)

    except Exception as e:
        log.error("Build fehlgeschlagen: %s", e, exc_info=True)
        status.status = "error"
        status.message = str(e)
    finally:
        _cleanup_source_audio(project_dir)


def _resolve_source(project_id: str, source_name: str) -> str:
    """Resolve a source filename to full path in the project's source_audio dir."""
    source_dir = CUSTOM_TAF_PATH / project_id / "source_audio"
    candidate = source_dir / source_name
    if candidate.exists():
        return str(candidate)
    return source_name


def _cleanup_source_audio(project_dir: Path) -> None:
    source_dir = project_dir / "source_audio"
    if not source_dir.exists():
        return
    try:
        shutil.rmtree(source_dir)
        log.info("Temp-Quellen entfernt: '%s'", source_dir)
    except OSError as e:
        log.warning("Temp-Quellen konnten nicht entfernt werden: %s", e)


async def _decode_to_pcm(
    source: str,
    start_time: float | None = None,
    end_time: float | None = None,
) -> bytes:
    """Decode audio file to raw PCM (s16le, 48kHz, stereo) via FFmpeg."""
    cmd = ["ffmpeg", "-y"]

    if start_time is not None:
        cmd.extend(["-ss", str(start_time)])
    if end_time is not None:
        cmd.extend(["-to", str(end_time)])

    cmd.extend([
        "-i", source,
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-ar", "48000",
        "-ac", "2",
        "-",
    ])

    log.debug("FFmpeg Befehl: %s", " ".join(cmd))

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        error_msg = stderr.decode()[:500]
        log.error("FFmpeg fehlgeschlagen (code %d): %s", proc.returncode, error_msg)
        raise RuntimeError(f"FFmpeg decode error: {error_msg}")

    log.debug("FFmpeg Output: %d Bytes PCM", len(stdout))
    return stdout


def _build_taf(taf_file: Path, chapter_pcm: list[bytes], bitrate: int, audio_id: int) -> dict:
    """Build a TAF file from PCM chapter data using the TafEncoder.

    Returns dict with sha1_hex and audio_id.
    """
    log.info("TAF-Encoder startet: %d Kapitel, bitrate=%d, audio_id=%d",
             len(chapter_pcm), bitrate, audio_id)

    with TafEncoder(taf_file, audio_id=audio_id, bitrate=bitrate) as enc:
        for i, pcm in enumerate(chapter_pcm):
            enc.new_chapter()
            samples = len(pcm) // (2 * 2)
            log.debug("Kapitel %d: %d Samples (%.1f s)", i + 1, samples, samples / 48000)
            enc.encode(pcm)

        # close() wird durch __exit__ aufgerufen

    log.info("TAF-Encoder fertig: SHA1=%s, audio_id=%d", enc.sha1_hash_hex, enc.audio_id)

    return {
        "sha1_hex": enc.sha1_hash_hex,
        "audio_id": enc.audio_id,
    }
