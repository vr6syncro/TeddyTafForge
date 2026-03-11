from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from backend import config as app_config
from backend.config import setup_logging
from backend.routers import files, metadata, upload, build, label, export, projects, youtube, diagnostics

setup_logging()

app = FastAPI(
    title="TafForge",
    description="Custom Tonie TAF Builder",
    version="0.2.1",
)

app.include_router(files.router)
app.include_router(metadata.router)
app.include_router(upload.router)
app.include_router(build.router)
app.include_router(label.router)
app.include_router(export.router)
app.include_router(projects.router)
app.include_router(youtube.router)
app.include_router(diagnostics.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": app.version, "debug": app_config.is_debug_enabled()}


@app.post("/api/debug")
async def toggle_debug(enabled: bool):
    raise HTTPException(403, "Runtime-Debug-Umschaltung ist deaktiviert")


@app.get("/api/debug")
async def get_debug():
    return {"debug": app_config.is_debug_enabled()}


static_dir = Path(__file__).resolve().parent.parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
