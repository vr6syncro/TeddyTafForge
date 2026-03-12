import { useEffect, useRef } from "react";
import { Card, ColorPicker, Form, Input, Select, Segmented, Slider, Switch, Typography } from "antd";
import type { Color } from "antd/es/color-picker";
import { useUiI18n } from "../uiI18n";

export interface LabelConfig {
  enabled: boolean;
  shape: "round" | "square";
  diameterMm: number;
  textLine1: string;
  textLine2: string;
  printMode: "imageAndText" | "onlyImage" | "onlyText";
  showTracklist: boolean;
  showSeriesOnImage: boolean;
  bgColor: string;
  fontSize: number;
}

interface Props {
  config: LabelConfig;
  onChange: (config: LabelConfig) => void;
  title?: string;
  series?: string;
  coverFile?: File;
  tracks?: string[];
}

export const defaultLabelConfig: LabelConfig = {
  enabled: false,
  shape: "round",
  diameterMm: 40,
  textLine1: "",
  textLine2: "",
  printMode: "imageAndText",
  showTracklist: false,
  showSeriesOnImage: false,
  bgColor: "#ffffff",
  fontSize: 10,
};

const PREVIEW_SIZE = 220;
const { Text } = Typography;
const responsiveGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
} as const;

const drawCircleText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  fontSize: number,
) => {
  ctx.save();
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const totalAngle = Math.min((text.length * fontSize * 0.6) / radius, Math.PI * 0.8);
  const startAngle = -Math.PI / 2 - totalAngle / 2;

  for (let i = 0; i < text.length; i++) {
    const charAngle = startAngle + (i + 0.5) * (totalAngle / text.length);
    const x = cx + Math.cos(charAngle) * radius;
    const y = cy + Math.sin(charAngle) * radius;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(charAngle + Math.PI / 2);
    ctx.strokeText(text[i]!, 0, 0);
    ctx.fillText(text[i]!, 0, 0);
    ctx.restore();
  }
  ctx.restore();
};

const LabelPreview = ({
  config,
  title,
  series,
  coverFile,
  tracks,
}: {
  config: LabelConfig;
  title: string;
  series: string;
  coverFile?: File;
  tracks: string[];
}) => {
  const { text } = useUiI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = PREVIEW_SIZE;
    canvas.width = size;
    canvas.height = size;

    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 4;

    ctx.fillStyle = "#1f1f1f";
    ctx.fillRect(0, 0, size, size);

    const showImage = config.printMode !== "onlyText";
    const showText = config.printMode !== "onlyImage";

    const drawContent = (coverImg?: HTMLImageElement) => {
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "#1f1f1f";
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = "#555";
      ctx.lineWidth = 2;

      if (config.shape === "round") {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();

        ctx.fillStyle = config.bgColor;
        ctx.fillRect(0, 0, size, size);

        if (showImage && coverImg) {
          const textSpace = showText ? 28 : 0;
          const imgSize = radius * 1.7;
          ctx.drawImage(
            coverImg,
            cx - imgSize / 2,
            cy - imgSize / 2 - textSpace / 2,
            imgSize,
            imgSize,
          );
        }

        ctx.restore();

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const margin = 4;
        const side = size - margin * 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(margin, margin, side, side);
        ctx.clip();

        ctx.fillStyle = config.bgColor;
        ctx.fillRect(margin, margin, side, side);

        if (showImage && coverImg) {
          const textSpace = showText ? 28 : 0;
          const imgSize = side * 0.75;
          ctx.drawImage(
            coverImg,
            cx - imgSize / 2,
            cy - imgSize / 2 - textSpace / 2,
            imgSize,
            imgSize,
          );
        }

        ctx.restore();

        ctx.strokeRect(margin, margin, side, side);
      }

      // Serie gebogen auf Bild
      if (showImage && config.showSeriesOnImage && (series || config.textLine2)) {
        const arcText = config.textLine2 || series;
        const arcRadius = config.shape === "round" ? radius * 0.72 : (size - 8) * 0.38;
        const arcFontSize = Math.max(8, config.fontSize * 0.9);
        drawCircleText(ctx, arcText, cx, cy, arcRadius, arcFontSize);
      }

      // Text / Trackliste
      if (showText) {
        const scaledFont = config.fontSize * (PREVIEW_SIZE / 200);
        ctx.fillStyle = "#333";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        const bottomY = config.shape === "round" ? cy + radius - 8 : size - 14;

        if (config.showTracklist && tracks.length > 0) {
          const maxLines = Math.min(tracks.length, 8);
          const trackFontSize = Math.min(scaledFont * 0.85, (bottomY - cy) / maxLines);
          ctx.font = `${trackFontSize}px sans-serif`;

          const startY = bottomY - (maxLines - 1) * (trackFontSize + 1);
          for (let i = 0; i < maxLines; i++) {
            const label = `${i + 1}. ${tracks[i]}`;
            ctx.fillText(label, cx, startY + i * (trackFontSize + 1), size - 20);
          }
          if (tracks.length > 8) {
            ctx.fillText(`... +${tracks.length - 8}`, cx, bottomY + trackFontSize, size - 20);
          }
        } else {
          const line1 = config.textLine1 || title || text.labelSettings.fallbackTitle;
          const line2 = config.textLine2 || series || "";

          const fontSize1 = Math.min(scaledFont * 1.2, radius / 4);
          const fontSize2 = Math.min(scaledFont, radius / 5);

          if (line2 && !config.showSeriesOnImage) {
            ctx.font = `bold ${fontSize1}px sans-serif`;
            ctx.fillText(line1, cx, bottomY - fontSize2 - 2, size - 20);
            ctx.font = `${fontSize2}px sans-serif`;
            ctx.fillText(line2, cx, bottomY, size - 20);
          } else {
            ctx.font = `bold ${fontSize1}px sans-serif`;
            ctx.fillText(line1, cx, bottomY, size - 20);
          }
        }
      }
    };

    if (coverFile) {
      const img = new Image();
      const url = URL.createObjectURL(coverFile);
      img.onload = () => {
        drawContent(img);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } else {
      drawContent();
    }
  }, [config, title, series, coverFile, tracks, text]);

  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
      <canvas
        ref={canvasRef}
        width={PREVIEW_SIZE}
        height={PREVIEW_SIZE}
        style={{ borderRadius: 8, border: "1px solid #303030" }}
      />
    </div>
  );
};

const LabelSettings = ({
  config,
  onChange,
  title = "",
  series = "",
  coverFile,
  tracks = [],
}: Props) => {
  const { text } = useUiI18n();
  const update = (patch: Partial<LabelConfig>) => onChange({ ...config, ...patch });

  const handleColorChange = (_value: Color, hex: string) => {
    update({ bgColor: hex });
  };

  return (
    <Card
      title={text.labelSettings.cardTitle}
      extra={
        <Switch
          checked={config.enabled}
          onChange={(checked) => update({ enabled: checked })}
          checkedChildren={text.labelSettings.on}
          unCheckedChildren={text.labelSettings.off}
        />
      }
    >
      {config.enabled && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 24,
            alignItems: "start",
          }}
        >
          <div
            style={{
              border: "1px solid rgba(127, 127, 127, 0.25)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(127, 127, 127, 0.06)",
            }}
          >
            <div style={{ marginBottom: 8 }}>
              <Text strong>{text.labelSettings.previewTitle}</Text>
              <br />
              <Text type="secondary">{text.labelSettings.previewHint}</Text>
            </div>
            <LabelPreview
              config={config}
              title={title}
              series={series}
              coverFile={coverFile}
              tracks={tracks}
            />
          </div>

          <Form layout="vertical">
              <Form.Item label={text.labelSettings.printMode}>
                <Segmented
                  value={config.printMode}
                  onChange={(value) => update({ printMode: value as LabelConfig["printMode"] })}
                  options={[
                    { value: "imageAndText", label: text.labelSettings.printModeOptions.imageAndText },
                    { value: "onlyImage", label: text.labelSettings.printModeOptions.onlyImage },
                    { value: "onlyText", label: text.labelSettings.printModeOptions.onlyText },
                  ]}
                  block
                />
              </Form.Item>

              <div style={responsiveGridStyle}>
                <Form.Item label={text.labelSettings.form}>
                  <Select
                    value={config.shape}
                    onChange={(value: "round" | "square") => update({ shape: value })}
                    options={[
                      { value: "round", label: text.labelSettings.shapeOptions.round },
                      { value: "square", label: text.labelSettings.shapeOptions.square },
                    ]}
                  />
                </Form.Item>

                <Form.Item label={text.labelSettings.size(config.diameterMm)}>
                  <Slider
                    min={20}
                    max={80}
                    value={config.diameterMm}
                    onChange={(value) => update({ diameterMm: value })}
                  />
                </Form.Item>
              </div>

              <div style={responsiveGridStyle}>
                <Form.Item label={text.labelSettings.showTracklist} style={{ marginBottom: 8 }}>
                  <Switch
                    checked={config.showTracklist}
                    onChange={(checked) => update({ showTracklist: checked })}
                    disabled={tracks.length === 0}
                  />
                </Form.Item>
                <Form.Item label={text.labelSettings.showSeriesOnImage} style={{ marginBottom: 8 }}>
                  <Switch
                    checked={config.showSeriesOnImage}
                    onChange={(checked) => update({ showSeriesOnImage: checked })}
                    disabled={config.printMode === "onlyText"}
                  />
                </Form.Item>
              </div>

              <div style={responsiveGridStyle}>
                <Form.Item label={text.labelSettings.backgroundColor}>
                  <ColorPicker
                    value={config.bgColor}
                    onChange={handleColorChange}
                    showText
                  />
                </Form.Item>
                <Form.Item label={text.labelSettings.fontSize(config.fontSize)}>
                  <Slider
                    min={6}
                    max={18}
                    value={config.fontSize}
                    onChange={(value) => update({ fontSize: value })}
                  />
                </Form.Item>
              </div>

              <Form.Item label={text.labelSettings.line1}>
                <Input
                  value={config.textLine1}
                  onChange={(e) => update({ textLine1: e.target.value })}
                  placeholder={text.labelSettings.line1Placeholder}
                  disabled={config.showTracklist}
                />
              </Form.Item>

              <Form.Item label={text.labelSettings.line2}>
                <Input
                  value={config.textLine2}
                  onChange={(e) => update({ textLine2: e.target.value })}
                  placeholder={text.labelSettings.line2Placeholder}
                />
              </Form.Item>
          </Form>
        </div>
      )}
    </Card>
  );
};

export default LabelSettings;
