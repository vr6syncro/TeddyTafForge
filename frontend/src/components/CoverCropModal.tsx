import { useRef, useState, useEffect, useCallback } from "react";
import { Modal, Segmented, Slider, Typography } from "antd";

const { Text } = Typography;

type CropShape = "round" | "square";

interface CoverCropModalProps {
  file: File | null;
  open: boolean;
  onConfirm: (croppedFile: File) => void;
  onCancel: () => void;
}

const CANVAS_SIZE = 400;
const EXPORT_SIZE = 1024;
const PADDING = 20;
const HALF = (CANVAS_SIZE - PADDING * 2) / 2;
const CORNER_RADIUS = 24;

const clipShape = (ctx: CanvasRenderingContext2D, cx: number, cy: number, shape: CropShape) => {
  ctx.beginPath();
  if (shape === "round") {
    ctx.arc(cx, cy, HALF, 0, Math.PI * 2);
  } else {
    const x = cx - HALF;
    const y = cy - HALF;
    const s = HALF * 2;
    ctx.roundRect(x, y, s, s, CORNER_RADIUS);
  }
};

const CoverCropModal = ({ file, open, onConfirm, onCancel }: CoverCropModalProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [shape, setShape] = useState<CropShape>("round");
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!file || !open) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const scale = Math.max(HALF * 2 / img.width, HALF * 2 / img.height);
      setZoom(scale);
      setOffset({ x: 0, y: 0 });
    };
    img.src = url;

    return () => URL.revokeObjectURL(url);
  }, [file, open]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const cx = CANVAS_SIZE / 2;
    const cy = CANVAS_SIZE / 2;
    const drawW = img.width * zoom;
    const drawH = img.height * zoom;
    const drawX = cx - drawW / 2 + offset.x;
    const drawY = cy - drawH / 2 + offset.y;

    ctx.save();
    clipShape(ctx, cx, cy, shape);
    ctx.clip();
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.globalCompositeOperation = "destination-out";
    clipShape(ctx, cx, cy, shape);
    ctx.fill();
    ctx.restore();

    ctx.save();
    clipShape(ctx, cx, cy, shape);
    ctx.clip();
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore();

    clipShape(ctx, cx, cy, shape);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [zoom, offset, shape]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offset };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({
      x: offsetStart.current.x + (e.clientX - dragStart.current.x),
      y: offsetStart.current.y + (e.clientY - dragStart.current.y),
    });
  };

  const handleMouseUp = () => setDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.02 : 0.02;
    setZoom((prev) => Math.max(0.1, Math.min(5, prev + delta)));
  };

  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img) return;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = EXPORT_SIZE;
    exportCanvas.height = EXPORT_SIZE;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    const scale = EXPORT_SIZE / (HALF * 2);
    const cx = EXPORT_SIZE / 2;
    const cy = EXPORT_SIZE / 2;
    const drawW = img.width * zoom * scale;
    const drawH = img.height * zoom * scale;
    const drawX = cx - drawW / 2 + offset.x * scale;
    const drawY = cy - drawH / 2 + offset.y * scale;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const croppedFile = new File([blob], "cover.png", { type: "image/png" });
      onConfirm(croppedFile);
    }, "image/png");
  };

  return (
    <Modal
      title="Cover zuschneiden"
      open={open}
      onOk={handleConfirm}
      onCancel={onCancel}
      okText="Uebernehmen"
      cancelText="Abbrechen"
      width={480}
      centered
      destroyOnClose
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <Segmented
          value={shape}
          onChange={(v) => setShape(v as CropShape)}
          options={[
            { label: "Rund (Coin)", value: "round" },
            { label: "Eckig (Label)", value: "square" },
          ]}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>Bild verschieben (Drag) und zoomen (Mausrad/Slider)</Text>
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          style={{
            cursor: dragging ? "grabbing" : "grab",
            borderRadius: 8,
            background: "#1a1a1a",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
        <div style={{ width: "100%", padding: "0 16px" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Zoom</Text>
          <Slider
            min={0.1}
            max={5}
            step={0.01}
            value={zoom}
            onChange={setZoom}
            tooltip={{ formatter: (v) => `${((v ?? 1) * 100).toFixed(0)}%` }}
          />
        </div>
      </div>
    </Modal>
  );
};

export default CoverCropModal;
