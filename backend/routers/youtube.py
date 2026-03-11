import asyncio
import logging
import mimetypes
import uuid
import httpx
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from backend.config import (
    CUSTOM_TAF_PATH,
    is_debug_enabled,
    ALLOW_NON_YOUTUBE_SOURCES,
    YTDLP_ALLOWED_DOMAINS,
    YTDLP_ENABLE_YOUTUBE_CLIENT_FALLBACK,
    YTDLP_OPTIONS,
)
from backend.http_headers import content_disposition_attachment
from backend.path_utils import resolve_project_dir, sanitize_uploaded_filename

log = logging.getLogger("tafforge.youtube")

router = APIRouter(prefix="/api/youtube", tags=["youtube"])


class YoutubeRequest(BaseModel):
    url: str
    project_id: str = ""


class YoutubeChapter(BaseModel):
    title: str
    start_time: float
    end_time: float | None = None


class YoutubeThumbnailRequest(BaseModel):
    url: str


def _error_detail(code: str, message: str, hint: str = "", raw: str = "") -> dict:
    detail: dict[str, str] = {
        "code": code,
        "message": message,
    }
    if hint:
        detail["hint"] = hint
    if raw and is_debug_enabled():
        detail["debug"] = raw[:800]
    return detail


def _raise_yt_download_error(err: Exception) -> None:
    raw = str(err).strip()
    low = raw.lower()

    if "private video" in low:
        raise HTTPException(
            403,
            _error_detail(
                "YT_PRIVATE",
                "Diese Quelle ist privat und kann nicht geladen werden.",
                "Nutze ein oeffentliches Video oder ein Video mit Zugriff fuer den Server.",
                raw,
            ),
        ) from err
    if "sign in to confirm your age" in low or "age-restricted" in low:
        raise HTTPException(
            403,
            _error_detail(
                "YT_AGE_RESTRICTED",
                "Diese Quelle ist altersbeschraenkt.",
                "Ohne passende Cookies/Login kann der Server es nicht abrufen.",
                raw,
            ),
        ) from err
    if "not available in your country" in low or "geo" in low and "blocked" in low:
        raise HTTPException(
            403,
            _error_detail(
                "YT_GEO_BLOCKED",
                "Diese Quelle ist regional eingeschraenkt.",
                "Der Server-Standort hat keinen Zugriff auf dieses Video.",
                raw,
            ),
        ) from err
    if "429" in low or "too many requests" in low or "rate limit" in low:
        raise HTTPException(
            429,
            _error_detail(
                "YT_RATE_LIMIT",
                "YouTube hat den Abruf voruebergehend limitiert.",
                "Bitte spaeter erneut versuchen.",
                raw,
            ),
        ) from err
    if "video unavailable" in low or "this video is unavailable" in low:
        raise HTTPException(
            404,
            _error_detail(
                "YT_UNAVAILABLE",
                "Diese Quelle ist nicht verfuegbar.",
                "Pruefe, ob das Video geloescht oder gesperrt wurde.",
                raw,
            ),
        ) from err
    if "unsupported url" in low or "invalid url" in low:
        raise HTTPException(
            400,
            _error_detail(
                "YT_INVALID_URL",
                "Die URL wird von yt-dlp nicht als gueltiger Medien-Link erkannt.",
                "Nutze einen direkten Link der unterstuetzten Plattform.",
                raw,
            ),
        ) from err

    raise HTTPException(
        400,
        _error_detail(
            "YT_DOWNLOAD_ERROR",
            "yt-dlp konnte fuer diese URL keine nutzbare Quelle liefern.",
            "Die Quelle kann privat, gesperrt, nicht unterstuetzt oder temporar nicht abrufbar sein.",
            raw,
        ),
    ) from err


def _raise_internal_error(code: str, message: str, err: Exception) -> None:
    raise HTTPException(500, _error_detail(code, message, raw=str(err))) from err


def _is_youtube_like_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return "youtube.com" in host or "youtu.be" in host


def _merge_dicts(base: dict, override: dict) -> dict:
    merged = dict(base)
    for key, value in override.items():
        if (
            key in merged
            and isinstance(merged[key], dict)
            and isinstance(value, dict)
        ):
            merged[key] = _merge_dicts(merged[key], value)
        else:
            merged[key] = value
    return merged


def _build_ydl_base_options() -> dict:
    defaults = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "extract_flat": False,
        "socket_timeout": 20,
        "retries": 3,
        "fragment_retries": 3,
        "skip_unavailable_fragments": True,
    }
    custom = YTDLP_OPTIONS if isinstance(YTDLP_OPTIONS, dict) else {}
    return _merge_dicts(defaults, custom)


def _build_info_attempts(url: str) -> list[dict]:
    base = _build_ydl_base_options()
    base["skip_download"] = True

    attempts = [base]
    if _is_youtube_like_url(url) and YTDLP_ENABLE_YOUTUBE_CLIENT_FALLBACK:
        clients = [["android"], ["web_safari"], ["tv"], ["ios", "web"]]
        for client_set in clients:
            attempt = _merge_dicts(base, {"extractor_args": {"youtube": {"player_client": client_set}}})
            attempts.append(attempt)
    return attempts


def _build_download_attempts(url: str, audio_dir: Path) -> list[dict]:
    base = _build_ydl_base_options()
    base = _merge_dicts(
        base,
        {
            "format": "bestaudio[ext=m4a]/bestaudio/best",
            "outtmpl": str(audio_dir / "%(id)s.%(ext)s"),
            "restrictfilenames": True,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ],
        },
    )

    attempts = [base]
    if _is_youtube_like_url(url) and YTDLP_ENABLE_YOUTUBE_CLIENT_FALLBACK:
        clients = [["android"], ["web_safari"], ["tv"], ["ios", "web"]]
        for client_set in clients:
            attempt = _merge_dicts(base, {"extractor_args": {"youtube": {"player_client": client_set}}})
            attempts.append(attempt)
    return attempts


def _ensure_project_dir(project_id: str) -> Path:
    return resolve_project_dir(project_id, create=True)


def _validate_url(url: str) -> None:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            400,
            _error_detail(
                "SOURCE_INVALID_URL",
                "Ungueltige URL.",
                "Bitte einen vollstaendigen Link mit http(s) angeben.",
            ),
        )

    host = (parsed.hostname or "").lower()
    if YTDLP_ALLOWED_DOMAINS:
        allowed = any(host == d or host.endswith(f".{d}") for d in YTDLP_ALLOWED_DOMAINS)
        if not allowed:
            raise HTTPException(
                403,
                _error_detail(
                    "SOURCE_DOMAIN_NOT_ALLOWED",
                    "Diese Domain ist durch Server-Policy nicht erlaubt.",
                    "Passe YTDLP_ALLOWED_DOMAINS an, um die Domain freizuschalten.",
                ),
            )

    if not ALLOW_NON_YOUTUBE_SOURCES and not _is_youtube_like_url(url):
        raise HTTPException(
            403,
            _error_detail(
                "SOURCE_NOT_ALLOWED",
                "Nur YouTube-Quellen sind aktuell erlaubt.",
                "Setze ALLOW_NON_YOUTUBE_SOURCES=true fuer weitere via yt-dlp unterstuetzte Seiten.",
            ),
        )


def _normalize_chapters(raw_chapters: list[dict] | None, duration: float) -> list[dict]:
    if not raw_chapters:
        return []

    normalized: list[dict] = []
    for idx, ch in enumerate(raw_chapters):
        start = float(ch.get("start_time") or 0.0)
        end_raw = ch.get("end_time")
        end = float(end_raw) if end_raw is not None else None
        if end is None and idx + 1 < len(raw_chapters):
            next_start = raw_chapters[idx + 1].get("start_time")
            end = float(next_start) if next_start is not None else None
        if end is None and duration > 0:
            end = duration

        title = str(ch.get("title") or f"Kapitel {idx + 1}")
        normalized.append(
            {
                "title": title.strip() or f"Kapitel {idx + 1}",
                "start_time": max(0.0, start),
                "end_time": end if end is None else max(0.0, end),
            }
        )

    return normalized


def _extract_info_sync(url: str) -> dict:
    last_error: Exception | None = None
    for opts in _build_info_attempts(url):
        try:
            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
            if not info:
                raise RuntimeError("Keine Video-Informationen gefunden")
            if "entries" in info and info["entries"]:
                return info["entries"][0]
            return info
        except DownloadError as e:
            last_error = e
            continue
    if last_error:
        raise last_error
    raise RuntimeError("Keine Video-Informationen gefunden")


def _pick_thumbnail_url(info: dict) -> str:
    thumb = str(info.get("thumbnail") or "").strip()
    if thumb:
        return thumb
    thumbs = info.get("thumbnails")
    if isinstance(thumbs, list):
        for item in reversed(thumbs):
            candidate = str((item or {}).get("url") or "").strip()
            if candidate:
                return candidate
    return ""


def _download_audio_sync(url: str, audio_dir: Path) -> dict:
    last_error: Exception | None = None
    for opts in _build_download_attempts(url, audio_dir):
        try:
            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
            if not info:
                raise RuntimeError("Download fehlgeschlagen")
            if "entries" in info and info["entries"]:
                return info["entries"][0]
            return info
        except DownloadError as e:
            last_error = e
            continue
    if last_error:
        raise last_error
    raise RuntimeError("Download fehlgeschlagen")


def _locate_downloaded_file(audio_dir: Path, video_id: str) -> Path:
    candidates = sorted(
        (
            p for p in audio_dir.glob(f"{video_id}.*")
            if p.is_file() and p.suffix.lower() != ".part"
        ),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise RuntimeError("Download-Datei wurde nicht gefunden")
    return candidates[0]


@router.post("/info")
async def youtube_info(request: YoutubeRequest):
    _validate_url(request.url)
    try:
        info = await asyncio.get_event_loop().run_in_executor(
            None,
            _extract_info_sync,
            request.url.strip(),
        )
    except DownloadError as e:
        _raise_yt_download_error(e)
    except Exception as e:
        _raise_internal_error("YT_INFO_INTERNAL", "Fehler beim Abrufen der YouTube-Infos.", e)

    duration = float(info.get("duration") or 0.0)
    chapters = _normalize_chapters(info.get("chapters"), duration)
    return {
        "title": info.get("title", ""),
        "duration": duration,
        "uploader": info.get("uploader", ""),
        "provider": info.get("extractor_key", ""),
        "thumbnail": _pick_thumbnail_url(info),
        "chapters": chapters,
    }


@router.post("/download")
async def youtube_download(request: YoutubeRequest):
    _validate_url(request.url)
    project_id = request.project_id or f"tbc-{uuid.uuid4()}"
    project_dir = _ensure_project_dir(project_id)
    audio_dir = project_dir / "source_audio"
    audio_dir.mkdir(exist_ok=True)

    try:
        info = await asyncio.get_event_loop().run_in_executor(
            None,
            _download_audio_sync,
            request.url.strip(),
            audio_dir,
        )
    except DownloadError as e:
        _raise_yt_download_error(e)
    except Exception as e:
        _raise_internal_error("YT_DOWNLOAD_INTERNAL", "Fehler beim Download.", e)

    video_id = str(info.get("id") or "").strip()
    if not video_id:
        raise HTTPException(500, "Video-ID konnte nicht ermittelt werden")

    try:
        source_file = _locate_downloaded_file(audio_dir, video_id)
    except Exception as e:
        raise HTTPException(500, str(e)) from e

    duration = float(info.get("duration") or 0.0)
    chapters = _normalize_chapters(info.get("chapters"), duration)

    log.info(
        "YouTube geladen: video_id=%s, file=%s, project=%s",
        video_id,
        source_file.name,
        project_id,
    )

    return {
        "project_id": project_id,
        "filename": source_file.name,
        "path": str(source_file.relative_to(CUSTOM_TAF_PATH)),
        "title": info.get("title", ""),
        "duration": duration,
        "uploader": info.get("uploader", ""),
        "provider": info.get("extractor_key", ""),
        "thumbnail": _pick_thumbnail_url(info),
        "chapters": chapters,
    }


@router.post("/thumbnail")
async def youtube_thumbnail(request: YoutubeThumbnailRequest):
    _validate_url(request.url)
    try:
        info = await asyncio.get_event_loop().run_in_executor(
            None,
            _extract_info_sync,
            request.url.strip(),
        )
    except DownloadError as e:
        _raise_yt_download_error(e)
    except Exception as e:
        _raise_internal_error("YT_THUMBNAIL_INFO_INTERNAL", "Fehler beim Abrufen der YouTube-Infos.", e)

    thumb_url = _pick_thumbnail_url(info)
    if not thumb_url:
        raise HTTPException(
            404,
            _error_detail(
                "YT_THUMBNAIL_MISSING",
                "Kein Thumbnail fuer dieses Video gefunden.",
            ),
        )

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            response = await client.get(thumb_url)
    except Exception as e:
        _raise_internal_error("YT_THUMBNAIL_FETCH_INTERNAL", "Thumbnail konnte nicht geladen werden.", e)

    if response.status_code >= 400:
        raise HTTPException(
            502,
            _error_detail(
                "YT_THUMBNAIL_FETCH_FAILED",
                f"Thumbnail-Download fehlgeschlagen (HTTP {response.status_code}).",
            ),
        )

    media_type = response.headers.get("content-type", "image/jpeg")
    if not media_type.startswith("image/"):
        raise HTTPException(
            500,
            _error_detail(
                "YT_THUMBNAIL_INVALID_TYPE",
                "Thumbnail ist kein Bild.",
            ),
        )

    ext = ".jpg"
    if "png" in media_type:
        ext = ".png"
    elif "webp" in media_type:
        ext = ".webp"

    title = str(info.get("title") or "youtube-thumbnail").strip()
    safe_title = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in title).strip("_")
    filename = f"{safe_title or 'youtube-thumbnail'}{ext}"

    return Response(
        content=response.content,
        media_type=media_type,
        headers={
            "Content-Disposition": content_disposition_attachment(filename),
        },
    )


@router.get("/audio/{project_id:path}/{filename:path}")
async def youtube_audio(project_id: str, filename: str):
    source_dir = resolve_project_dir(project_id) / "source_audio"
    source = source_dir / sanitize_uploaded_filename(filename, fallback="audio")
    if not source.exists() or not source.is_file():
        raise HTTPException(404, "Audio-Datei nicht gefunden")

    media_type, _ = mimetypes.guess_type(source.name)
    return FileResponse(
        source,
        media_type=media_type or "application/octet-stream",
        filename=source.name,
    )
