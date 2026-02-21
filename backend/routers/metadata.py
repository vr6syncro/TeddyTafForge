import json
import logging
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import CONFIG_PATH, TEDDYCLOUD_URL

log = logging.getLogger("tafforge.metadata")

router = APIRouter(prefix="/api/metadata", tags=["metadata"])

CUSTOM_JSON_PATH = CONFIG_PATH / "tonies.custom.json"
OFFICIAL_JSON_PATH = CONFIG_PATH / "tonies.json"


def _read_custom_json() -> list[dict]:
    if not CUSTOM_JSON_PATH.exists():
        log.debug("tonies.custom.json existiert nicht: %s", CUSTOM_JSON_PATH)
        return []
    text = CUSTOM_JSON_PATH.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        log.error("tonies.custom.json JSON-Fehler: %s - erstelle Backup", e)
        backup = CUSTOM_JSON_PATH.with_suffix(".json.bak")
        CUSTOM_JSON_PATH.rename(backup)
        return []
    if isinstance(data, list):
        log.debug("tonies.custom.json geladen: %d Eintraege", len(data))
        return data
    log.warning("tonies.custom.json ist kein Array, ignoriere")
    return []


def _extract_audio_ids(entry: dict) -> set[str]:
    """Extrahiere alle audio_ids aus einem Eintrag (String oder Array)."""
    aid = entry.get("audio_id", "")
    if isinstance(aid, list):
        return {str(a) for a in aid}
    if aid:
        return {str(aid)}
    return set()


def _extract_hashes(entry: dict) -> set[str]:
    """Extrahiere alle Hashes aus einem Eintrag (String oder Array)."""
    h = entry.get("hash", "")
    if isinstance(h, list):
        return {str(x) for x in h if x}
    if h:
        return {str(h)}
    return set()


def _read_official_json() -> list[dict]:
    """Lese die offizielle tonies.json (nur lesen, nie schreiben)."""
    if not OFFICIAL_JSON_PATH.exists():
        log.debug("tonies.json nicht gefunden: %s", OFFICIAL_JSON_PATH)
        return []
    try:
        text = OFFICIAL_JSON_PATH.read_text(encoding="utf-8")
        data = json.loads(text)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("tonies.json konnte nicht gelesen werden: %s", e)
        return []
    if isinstance(data, list):
        log.debug("tonies.json geladen: %d Eintraege", len(data))
        return data
    return []


def _collect_all_audio_ids() -> set[str]:
    """Sammle ALLE audio_ids aus tonies.json UND tonies.custom.json."""
    all_ids: set[str] = set()

    for entry in _read_official_json():
        all_ids |= _extract_audio_ids(entry)

    for entry in _read_custom_json():
        all_ids |= _extract_audio_ids(entry)

    log.debug("Bekannte Audio-IDs gesamt: %d (offiziell + custom)", len(all_ids))
    return all_ids


def _collect_all_hashes() -> set[str]:
    """Sammle ALLE Hashes aus tonies.json UND tonies.custom.json."""
    all_hashes: set[str] = set()

    for entry in _read_official_json():
        all_hashes |= _extract_hashes(entry)

    for entry in _read_custom_json():
        all_hashes |= _extract_hashes(entry)

    return all_hashes


def audio_id_exists(audio_id: int | str) -> dict | None:
    """Pruefe ob eine Audio-ID bereits in offizieller oder custom DB existiert.

    Returns: Dict mit Treffer-Details oder None wenn frei.
    """
    aid_str = str(audio_id)

    for entry in _read_official_json():
        if aid_str in _extract_audio_ids(entry):
            return {
                "source": "tonies.json",
                "title": entry.get("title", "?"),
                "series": entry.get("series", ""),
            }

    for entry in _read_custom_json():
        if aid_str in _extract_audio_ids(entry):
            return {
                "source": "tonies.custom.json",
                "title": entry.get("title", "?"),
                "series": entry.get("series", ""),
            }

    return None


def _write_custom_json(entries: list[dict]) -> None:
    CUSTOM_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Duplikate nach audio_id entfernen (letzter gewinnt)
    seen: dict[str, int] = {}
    for i, e in enumerate(entries):
        for aid in _extract_audio_ids(e):
            if aid:
                seen[aid] = i

    if len(seen) < sum(len(_extract_audio_ids(e)) for e in entries):
        unique_indices = set(seen.values())
        entries = [
            e for i, e in enumerate(entries)
            if not _extract_audio_ids(e) or i in unique_indices
        ]
        log.info("Duplikate entfernt, %d Eintraege verbleibend", len(entries))

    content = json.dumps(entries, indent=2, ensure_ascii=False)
    json.loads(content)
    CUSTOM_JSON_PATH.write_text(content, encoding="utf-8")
    log.info("tonies.custom.json geschrieben: %d Eintraege, %d Bytes",
             len(entries), len(content))


class CustomTonieEntry(BaseModel):
    no: str = "0"
    model: str = ""
    audio_id: list[str] = []
    hash: list[str] = []
    title: str = ""
    series: str = ""
    episodes: str = ""
    tracks: list[str] = []
    release: str = "0"
    language: str = "de-de"
    category: str = "audio-play"
    pic: str = ""


@router.get("/custom")
async def get_custom_entries():
    return {"entries": _read_custom_json()}


@router.get("/custom/{audio_id}")
async def get_custom_entry(audio_id: str):
    entries = _read_custom_json()
    for entry in entries:
        if audio_id in _extract_audio_ids(entry):
            return entry
    raise HTTPException(404, f"Entry {audio_id} not found")


@router.post("/custom")
async def add_custom_entry(entry: CustomTonieEntry):
    entries = _read_custom_json()
    new_aids = set(entry.audio_id)

    for existing in entries:
        if new_aids & _extract_audio_ids(existing):
            raise HTTPException(409, f"Entry with audio_id {entry.audio_id} already exists")

    entries.append(entry.model_dump())
    _write_custom_json(entries)

    log.info("Custom-Eintrag hinzugefuegt: audio_id=%s, title='%s'",
             entry.audio_id, entry.title)
    await _reload_teddycloud_cache()
    return {"status": "created", "audio_id": entry.audio_id}


@router.put("/custom/{audio_id}")
async def update_custom_entry(audio_id: str, entry: CustomTonieEntry):
    entries = _read_custom_json()
    found = False
    for i, existing in enumerate(entries):
        if audio_id in _extract_audio_ids(existing):
            entries[i] = entry.model_dump()
            found = True
            break

    if not found:
        raise HTTPException(404, f"Entry {audio_id} not found")

    _write_custom_json(entries)
    log.info("Custom-Eintrag aktualisiert: audio_id=%s, title='%s'",
             audio_id, entry.title)
    await _reload_teddycloud_cache()
    return {"status": "updated", "audio_id": entry.audio_id}


@router.delete("/custom/{audio_id}")
async def delete_custom_entry(audio_id: str):
    entries = _read_custom_json()
    new_entries = [e for e in entries if audio_id not in _extract_audio_ids(e)]

    if len(new_entries) == len(entries):
        raise HTTPException(404, f"Entry {audio_id} not found")

    _write_custom_json(new_entries)
    log.info("Custom-Eintrag geloescht: audio_id=%s", audio_id)
    await _reload_teddycloud_cache()
    return {"status": "deleted", "audio_id": audio_id}


@router.get("/validate")
async def validate_databases():
    """Pruefe tonies.json und tonies.custom.json auf Duplikate und Konflikte."""
    official = _read_official_json()
    custom = _read_custom_json()

    # Alle Audio-IDs sammeln
    official_ids: dict[str, list[str]] = {}
    for entry in official:
        for aid in _extract_audio_ids(entry):
            official_ids.setdefault(aid, []).append(entry.get("title", "?"))

    custom_ids: dict[str, list[str]] = {}
    for entry in custom:
        for aid in _extract_audio_ids(entry):
            custom_ids.setdefault(aid, []).append(entry.get("title", "?"))

    # Konflikte: Audio-ID in beiden Dateien
    conflicts = []
    for aid, custom_titles in custom_ids.items():
        if aid in official_ids:
            conflicts.append({
                "audio_id": aid,
                "official_title": official_ids[aid],
                "custom_title": custom_titles,
                "type": "audio_id_collision",
            })

    # Duplikate innerhalb custom
    custom_dupes = []
    for aid, titles in custom_ids.items():
        if len(titles) > 1:
            custom_dupes.append({
                "audio_id": aid,
                "titles": titles,
                "type": "custom_duplicate",
            })

    # Hash-Konflikte
    official_hashes: dict[str, str] = {}
    for entry in official:
        for h in _extract_hashes(entry):
            official_hashes[h] = entry.get("title", "?")

    hash_conflicts = []
    for entry in custom:
        for h in _extract_hashes(entry):
            if h in official_hashes:
                hash_conflicts.append({
                    "hash": h[:16] + "...",
                    "official_title": official_hashes[h],
                    "custom_title": entry.get("title", "?"),
                    "type": "hash_collision",
                })

    result = {
        "official_count": len(official),
        "custom_count": len(custom),
        "official_audio_ids": len(official_ids),
        "custom_audio_ids": len(custom_ids),
        "conflicts": conflicts,
        "custom_duplicates": custom_dupes,
        "hash_conflicts": hash_conflicts,
        "status": "ok" if not conflicts and not custom_dupes and not hash_conflicts else "warnings",
    }

    if conflicts:
        log.warning("Audio-ID Konflikte gefunden: %d", len(conflicts))
    if custom_dupes:
        log.warning("Custom Duplikate gefunden: %d", len(custom_dupes))
    if hash_conflicts:
        log.warning("Hash-Konflikte gefunden: %d", len(hash_conflicts))

    return result


@router.get("/check-audio-id/{audio_id}")
async def check_audio_id(audio_id: str):
    """Pruefe ob eine Audio-ID bereits vergeben ist."""
    match = audio_id_exists(audio_id)
    if match:
        return {"exists": True, **match}
    return {"exists": False}


async def _reload_teddycloud_cache() -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{TEDDYCLOUD_URL}/api/toniesJsonReload")
            log.debug("TeddyCloud Cache Reload: Status %d", resp.status_code)
    except httpx.HTTPError as e:
        log.warning("TeddyCloud Cache Reload fehlgeschlagen: %s", e)
