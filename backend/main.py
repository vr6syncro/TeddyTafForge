from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.config import setup_logging, DEBUG_MODE, set_debug
from backend.routers import files, metadata, upload, build, label, export, projects, youtube

setup_logging()

app = FastAPI(
    title="TafForge",
    description="Custom Tonie TAF Builder",
    version="0.1.0",
)

app.include_router(files.router)
app.include_router(metadata.router)
app.include_router(upload.router)
app.include_router(build.router)
app.include_router(label.router)
app.include_router(export.router)
app.include_router(projects.router)
app.include_router(youtube.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": app.version, "debug": DEBUG_MODE}


@app.post("/api/debug")
async def toggle_debug(enabled: bool):
    set_debug(enabled)
    return {"debug": enabled}


@app.get("/api/debug")
async def get_debug():
    return {"debug": DEBUG_MODE}


static_dir = Path(__file__).resolve().parent.parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
