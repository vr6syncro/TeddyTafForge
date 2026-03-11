import io
import zipfile
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.http_headers import content_disposition_attachment
from backend.path_utils import resolve_project_dir

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/zip/{project_id:path}")
async def export_zip(project_id: str):
    project_id = unquote(project_id)
    project_dir = resolve_project_dir(project_id)
    if not project_dir.exists():
        raise HTTPException(404, "Project not found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(project_dir.rglob("*")):
            if not file_path.is_file():
                continue
            if file_path.parent.name == "source_audio":
                continue
            arcname = str(file_path.relative_to(project_dir))
            zf.write(file_path, arcname)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": content_disposition_attachment(f"{project_id}.zip")
        },
    )
