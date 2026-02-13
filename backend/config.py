import logging
import json
import os
from pathlib import Path

TEDDYCLOUD_URL = os.getenv("TEDDYCLOUD_URL", "http://teddycloud:80")

LIBRARY_PATH = Path(os.getenv("LIBRARY_PATH", "/teddycloud/library"))
CONTENT_PATH = Path(os.getenv("CONTENT_PATH", "/teddycloud/data/content"))
CONFIG_PATH = Path(os.getenv("CONFIG_PATH", "/teddycloud/config"))

CUSTOM_TAF_PATH = LIBRARY_PATH / "custom_taf"

ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma", ".opus"}
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

MAX_CHAPTERS = 100
OPUS_SAMPLE_RATE = 48000
OPUS_CHANNELS = 2
OPUS_FRAME_DURATION_MS = 60
DEFAULT_BITRATE = 96
MIN_BITRATE = 64
MAX_BITRATE = 256
TAF_HEADER_SIZE = 4096
TAF_BLOCK_SIZE = 4096

ALLOW_NON_YOUTUBE_SOURCES = os.getenv("ALLOW_NON_YOUTUBE_SOURCES", "true").lower() in (
    "true",
    "1",
    "yes",
)
YTDLP_ALLOWED_DOMAINS = {
    d.strip().lower()
    for d in os.getenv("YTDLP_ALLOWED_DOMAINS", "").split(",")
    if d.strip()
}
YTDLP_ENABLE_YOUTUBE_CLIENT_FALLBACK = os.getenv(
    "YTDLP_ENABLE_YOUTUBE_CLIENT_FALLBACK",
    "true",
).lower() in ("true", "1", "yes")
YTDLP_OPTIONS_RAW = os.getenv("YTDLP_OPTIONS", "")
try:
    YTDLP_OPTIONS = json.loads(YTDLP_OPTIONS_RAW) if YTDLP_OPTIONS_RAW else {}
    if not isinstance(YTDLP_OPTIONS, dict):
        YTDLP_OPTIONS = {}
except json.JSONDecodeError:
    YTDLP_OPTIONS = {}

# Logging
DEBUG_MODE = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")
_log_level = logging.DEBUG if DEBUG_MODE else logging.INFO


def setup_logging():
    logging.basicConfig(
        level=_log_level,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def set_debug(enabled: bool):
    global DEBUG_MODE
    DEBUG_MODE = enabled
    level = logging.DEBUG if enabled else logging.INFO
    logging.getLogger().setLevel(level)
    for handler in logging.getLogger().handlers:
        handler.setLevel(level)


def is_debug_enabled() -> bool:
    return DEBUG_MODE
