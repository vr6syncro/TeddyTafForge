import re
import unicodedata
from pathlib import PurePath
from urllib.parse import quote


def content_disposition_attachment(filename: str) -> str:
    """Build RFC5987-safe Content-Disposition header for unicode filenames."""
    name = PurePath(filename).name or "download"

    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "_", ascii_name).strip("._")
    if not ascii_name:
        ascii_name = "download"

    encoded_name = quote(name, safe="")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded_name}"
