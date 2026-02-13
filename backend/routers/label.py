import io
import math
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.config import CUSTOM_TAF_PATH
from backend.http_headers import content_disposition_attachment

router = APIRouter(prefix="/api/label", tags=["label"])


class LabelRequest(BaseModel):
    project_id: str
    title: str = "Custom Tonie"
    series: str = ""
    text_line1: str = ""
    text_line2: str = ""
    shape: str = "round"
    diameter_mm: float = 40.0
    print_mode: str = "imageAndText"
    tracks: list[str] = []
    show_tracklist: bool = False
    show_series_on_image: bool = False
    bg_color: str = "#ffffff"
    font_size: float = 10.0


@router.post("/generate")
async def generate_label(request: LabelRequest):
    project_dir = CUSTOM_TAF_PATH / request.project_id
    if not project_dir.exists():
        raise HTTPException(404, "Project not found")

    cover_path = _find_cover(project_dir)
    pdf_bytes = _create_label_pdf(request, cover_path)

    pdf_file = project_dir / "label.pdf"
    pdf_file.write_bytes(pdf_bytes)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": content_disposition_attachment(
                f"label_{request.project_id}.pdf"
            )
        },
    )


@router.get("/preview/{project_id:path}")
async def preview_label(project_id: str):
    pdf_file = CUSTOM_TAF_PATH / project_id / "label.pdf"
    if not pdf_file.exists():
        raise HTTPException(404, "Label not found, generate first")

    return StreamingResponse(
        io.BytesIO(pdf_file.read_bytes()),
        media_type="application/pdf",
    )


def _find_cover(project_dir: Path) -> Path | None:
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        cover = project_dir / f"cover{ext}"
        if cover.exists():
            return cover
    return None


def _hex_to_rgb(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = h[0] * 2 + h[1] * 2 + h[2] * 2
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return r / 255.0, g / 255.0, b / 255.0


def _draw_circle_text(c, text: str, center_x: float, center_y: float,
                      radius: float, font_size: float):
    if not text:
        return
    c.saveState()
    char_angle = font_size * 0.6 / radius
    total_angle = len(text) * char_angle
    start = math.pi / 2 + total_angle / 2

    c.setFont("Helvetica-Bold", font_size)
    for i, ch in enumerate(text):
        angle = start - (i + 0.5) * char_angle
        x = center_x + math.cos(angle) * radius
        y = center_y + math.sin(angle) * radius

        c.saveState()
        c.translate(x, y)
        c.rotate(math.degrees(angle - math.pi / 2))
        c.drawCentredString(0, 0, ch)
        c.restoreState()

    c.restoreState()


def _create_label_pdf(request: LabelRequest, cover_path: Path | None) -> bytes:
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas as pdf_canvas
        from reportlab.lib.utils import ImageReader
    except ImportError:
        raise HTTPException(
            500,
            "reportlab not installed. Add 'reportlab' to requirements.txt",
        )

    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4

    diameter = request.diameter_mm * mm
    radius = diameter / 2

    center_x = page_w / 2
    center_y = page_h / 2

    show_image = request.print_mode != "onlyText"
    show_text = request.print_mode != "onlyImage"

    text_height = 10 * mm if show_text else 0
    img_area_radius = radius - 2 * mm

    bg_r, bg_g, bg_b = _hex_to_rgb(request.bg_color)

    if request.shape == "round":
        # Hintergrund-Kreis
        c.setFillColorRGB(bg_r, bg_g, bg_b)
        c.setStrokeColorRGB(0, 0, 0)
        c.circle(center_x, center_y, radius, stroke=1, fill=1)

        if show_image and cover_path and cover_path.exists():
            clip_path = c.beginPath()
            clip_path.circle(center_x, center_y, img_area_radius)
            c.saveState()
            c.clipPath(clip_path, stroke=0, fill=0)

            img = ImageReader(str(cover_path))
            img_size = diameter * 0.85
            c.drawImage(
                img,
                center_x - img_size / 2,
                center_y - img_size / 2 + text_height / 2,
                width=img_size,
                height=img_size,
                preserveAspectRatio=True,
                mask="auto",
            )
            c.restoreState()

        # Serie gebogen auf Bild
        if show_image and request.show_series_on_image:
            arc_text = request.text_line2 or request.series
            if arc_text:
                arc_font = min(request.font_size * 0.9, 8)
                _draw_circle_text(c, arc_text, center_x, center_y,
                                  radius * 0.72, arc_font)

        if show_text:
            c.setFillColorRGB(0.2, 0.2, 0.2)

            if request.show_tracklist and request.tracks:
                _draw_tracklist(c, request.tracks, center_x, center_y,
                                radius, request.font_size, mm)
            else:
                line1 = request.text_line1 or request.title
                font1 = min(request.font_size, radius / (3 * mm))
                c.setFont("Helvetica-Bold", font1)
                c.drawCentredString(center_x, center_y - radius + 10 * mm, line1)

                if (request.text_line2 or request.series) and not request.show_series_on_image:
                    font2 = min(request.font_size * 0.7, radius / (4 * mm))
                    c.setFont("Helvetica", font2)
                    line2 = request.text_line2 or request.series
                    c.drawCentredString(center_x, center_y - radius + 6 * mm, line2)

    else:
        side = diameter
        half = side / 2

        # Hintergrund-Rechteck
        c.setFillColorRGB(bg_r, bg_g, bg_b)
        c.setStrokeColorRGB(0, 0, 0)
        c.rect(center_x - half, center_y - half, side, side, stroke=1, fill=1)

        if show_image and cover_path and cover_path.exists():
            margin = 2 * mm
            clip_path = c.beginPath()
            clip_path.rect(
                center_x - half + margin,
                center_y - half + margin,
                side - 2 * margin,
                side - 2 * margin,
            )
            c.saveState()
            c.clipPath(clip_path, stroke=0, fill=0)

            img = ImageReader(str(cover_path))
            img_size = side * 0.85
            c.drawImage(
                img,
                center_x - img_size / 2,
                center_y - img_size / 2 + text_height / 2,
                width=img_size,
                height=img_size,
                preserveAspectRatio=True,
                mask="auto",
            )
            c.restoreState()

        if show_text:
            c.setFillColorRGB(0.2, 0.2, 0.2)

            if request.show_tracklist and request.tracks:
                _draw_tracklist(c, request.tracks, center_x, center_y,
                                half, request.font_size, mm)
            else:
                font1 = min(request.font_size, half / (3 * mm))
                c.setFont("Helvetica-Bold", font1)
                line1 = request.text_line1 or request.title
                c.drawCentredString(center_x, center_y - half + 8 * mm, line1)

                if (request.text_line2 or request.series) and not request.show_series_on_image:
                    font2 = min(request.font_size * 0.7, half / (4 * mm))
                    c.setFont("Helvetica", font2)
                    line2 = request.text_line2 or request.series
                    c.drawCentredString(center_x, center_y - half + 4 * mm, line2)

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.read()


def _draw_tracklist(c, tracks: list[str], center_x: float, center_y: float,
                    radius: float, font_size: float, mm_unit: float):
    max_lines = min(len(tracks), 12)
    line_height = min(font_size * 0.8, (radius * 0.6) / max_lines)
    track_font = min(line_height * 0.9, font_size * 0.7)
    c.setFont("Helvetica", track_font)

    start_y = center_y - radius + (max_lines + 1) * line_height + 2 * mm_unit
    for i in range(max_lines):
        label = f"{i + 1}. {tracks[i]}"
        c.drawCentredString(center_x, start_y - i * line_height, label)

    if len(tracks) > 12:
        c.setFont("Helvetica-Oblique", track_font * 0.85)
        c.drawCentredString(center_x, start_y - max_lines * line_height,
                            f"... +{len(tracks) - 12} weitere")
