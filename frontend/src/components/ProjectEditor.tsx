import { useEffect, useState, useCallback } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Typography,
  Upload,
  message,
} from "antd";
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  PictureOutlined,
  SaveOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { api } from "../api";
import type { ProjectInfo } from "../api";
import { getMetadataLanguageOptions, sanitizeMetadataText } from "../appPreferences";
import { useUiI18n } from "../uiI18n";
import CoverCropModal from "./CoverCropModal";
import LabelSettings, { defaultLabelConfig } from "./LabelSettings";
import type { LabelConfig } from "./LabelSettings";

const { Title, Text } = Typography;

interface ProjectEditorProps {
  project: ProjectInfo;
  onBack: () => void;
}

const ProjectEditor = ({ project, onBack }: ProjectEditorProps) => {
  const { text } = useUiI18n();
  const metadataLanguageOptions = getMetadataLanguageOptions(text.metadata.languages);
  const categoryOptions = [
    { value: "audio-play", label: text.metadata.categories["audio-play"] },
    { value: "audio-book", label: text.metadata.categories["audio-book"] },
    { value: "music", label: text.metadata.categories.music },
    { value: "audio-play-songs", label: text.metadata.categories["audio-play-songs"] },
    { value: "audio-book-songs", label: text.metadata.categories["audio-book-songs"] },
    { value: "audio-play-educational", label: text.metadata.categories["audio-play-educational"] },
  ];
  const [metaForm] = Form.useForm();
  const [metaBusy, setMetaBusy] = useState(false);
  const [chapterTitles, setChapterTitles] = useState<string[]>([]);
  const [chapterBusy, setChapterBusy] = useState(false);
  const [coverUrl, setCoverUrl] = useState("");
  const [coverKey, setCoverKey] = useState(Date.now());
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [labelConfig, setLabelConfig] = useState<LabelConfig>({ ...defaultLabelConfig, enabled: true });
  const [labelBusy, setLabelBusy] = useState(false);
  const [error, setError] = useState("");

  const initFromProject = useCallback((p: ProjectInfo) => {
    const safeTitle = sanitizeMetadataText(p.title) || p.name;
    const safeSeries = sanitizeMetadataText(p.series);
    const safeEpisodes = sanitizeMetadataText(p.episodes);
    metaForm.setFieldsValue({
      title: safeTitle,
      series: safeSeries,
      episodes: safeEpisodes,
      language: p.language === "en-gb" ? "en-gb" : "de-de",
      category: p.category || "audio-play",
    });
    setChapterTitles(
      p.chapters?.map((ch) => ch.title) ?? []
    );
    if (p.has_cover) {
      const url = api.projectCoverUrl(p.name);
      setCoverUrl(url);
      fetch(url)
        .then((res) => res.blob())
        .then((blob) => setCoverFile(new File([blob], "cover.png", { type: blob.type })))
        .catch(() => setCoverFile(null));
    } else {
      setCoverUrl("");
      setCoverFile(null);
    }
  }, [metaForm]);

  useEffect(() => {
    initFromProject(project);
  }, [project, initFromProject]);

  const handleMetaSave = async () => {
    setMetaBusy(true);
    setError("");
    try {
      const values = await metaForm.validateFields();
      await api.updateProjectMetadata(project.name, values);
      message.success(text.projectEditor.savedMeta);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setMetaBusy(false);
    }
  };

  const handleChapterSave = async () => {
    setChapterBusy(true);
    setError("");
    try {
      await api.updateProjectMetadata(project.name, { chapters: chapterTitles });
      message.success(text.projectEditor.savedChapters);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setChapterBusy(false);
    }
  };

  const handleCoverCropConfirm = async (croppedFile: File) => {
    setCropOpen(false);
    setCoverBusy(true);
    setError("");
    try {
      await api.uploadImage(croppedFile, project.name, "cover");
      setCoverKey(Date.now());
      setCoverUrl(api.projectCoverUrl(project.name));
      setCoverFile(croppedFile);
      message.success(text.projectEditor.updatedCover);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setCoverBusy(false);
      setCropFile(null);
    }
  };

  const handleLabelGenerate = async () => {
    setLabelBusy(true);
    setError("");
    try {
      const title = metaForm.getFieldValue("title") || project.title;
      const series = metaForm.getFieldValue("series") || project.series;
      const res = await api.generateLabel({
        project_id: project.name,
        title,
        series,
        text_line1: labelConfig.textLine1,
        text_line2: labelConfig.textLine2,
        shape: labelConfig.shape,
        diameter_mm: labelConfig.diameterMm,
        print_mode: labelConfig.printMode,
        tracks: chapterTitles,
        show_tracklist: labelConfig.showTracklist,
        show_series_on_image: labelConfig.showSeriesOnImage,
        bg_color: labelConfig.bgColor,
        font_size: labelConfig.fontSize,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`);
      }
      message.success(text.projectEditor.labelGenerated);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setLabelBusy(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>{text.common.back}</Button>
        <Title level={4} style={{ margin: 0 }}>{project.title}</Title>
      </div>

      {error && <Alert type="error" message={error} closable onClose={() => setError("")} />}

      {/* Metadaten */}
      <Card title={text.projectEditor.cards.metadata}>
        <Form form={metaForm} layout="vertical">
          <Form.Item name="title" label={text.common.title} rules={[{ required: true, message: text.projectEditor.fields.titleRequired }]}>
            <Input />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="series" label={text.common.series}>
              <Input />
            </Form.Item>
            <Form.Item name="episodes" label={text.common.episode}>
              <Input />
            </Form.Item>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="language" label={text.common.language}>
              <Select options={metadataLanguageOptions} />
            </Form.Item>
            <Form.Item name="category" label={text.common.category}>
              <Select options={categoryOptions} />
            </Form.Item>
          </div>
          <Button type="primary" icon={<SaveOutlined />} loading={metaBusy} onClick={handleMetaSave}>
            {text.projectEditor.fields.saveMetadata}
          </Button>
        </Form>
      </Card>

      {/* Kapitel */}
      <Card title={text.projectEditor.cards.chapters}>
        {chapterTitles.length === 0 ? (
          <Text type="secondary">{text.projectEditor.fields.noChapters}</Text>
        ) : (
          <Space direction="vertical" style={{ width: "100%" }}>
            {chapterTitles.map((title, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Text type="secondary" style={{ minWidth: 28, textAlign: "right" }}>{idx + 1}.</Text>
                <Input
                  value={title}
                  onChange={(e) => {
                    const next = [...chapterTitles];
                    next[idx] = e.target.value;
                    setChapterTitles(next);
                  }}
                />
              </div>
            ))}
          </Space>
        )}
        <div style={{ marginTop: 12 }}>
          <Alert
            type="info"
            message={text.projectEditor.fields.chapterInfo}
            showIcon
            style={{ marginBottom: 12 }}
          />
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={chapterBusy}
            onClick={handleChapterSave}
            disabled={chapterTitles.length === 0}
          >
            {text.projectEditor.fields.saveChapters}
          </Button>
        </div>
      </Card>

      {/* Cover */}
      <Card title={text.projectEditor.cards.cover}>
        <Space direction="vertical" style={{ width: "100%" }}>
          {coverUrl ? (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <img
                key={coverKey}
                src={`${coverUrl}?t=${coverKey}`}
                alt={text.projectEditor.fields.coverAlt}
                style={{ maxWidth: 256, maxHeight: 256, borderRadius: 8, border: "1px solid #303030" }}
              />
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
              <Text type="secondary"><PictureOutlined style={{ fontSize: 48 }} /><br />{text.projectEditor.fields.noCover}</Text>
            </div>
          )}
          <Upload
            beforeUpload={(file) => {
              setCropFile(file);
              setCropOpen(true);
              return false;
            }}
            showUploadList={false}
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
          >
            <Button icon={<UploadOutlined />} loading={coverBusy}>
              {coverUrl ? text.projectEditor.fields.changeCover : text.projectEditor.fields.uploadCover}
            </Button>
          </Upload>
        </Space>
        <CoverCropModal
          file={cropFile}
          open={cropOpen}
          onConfirm={handleCoverCropConfirm}
          onCancel={() => {
            setCropOpen(false);
            setCropFile(null);
          }}
        />
      </Card>

      {/* Label */}
      <Card
        title={text.projectEditor.cards.label}
        extra={
          project.has_label ? (
            <Button
              size="small"
              icon={<FileTextOutlined />}
              type="link"
              href={api.labelPreviewUrl(encodeURIComponent(project.name))}
              target="_blank"
            >
              {text.projectEditor.fields.showPdf}
            </Button>
          ) : null
        }
      >
        <LabelSettings
          config={labelConfig}
          onChange={setLabelConfig}
          title={metaForm.getFieldValue("title") || project.title}
          series={metaForm.getFieldValue("series") || project.series}
          coverFile={coverFile ?? undefined}
          tracks={chapterTitles}
        />
        {labelConfig.enabled && (
          <div style={{ marginTop: 12 }}>
            <Button
              type="primary"
              icon={<FileTextOutlined />}
              loading={labelBusy}
              onClick={handleLabelGenerate}
            >
              {text.projectEditor.fields.generateLabel}
            </Button>
          </div>
        )}
      </Card>
    </Space>
  );
};

export default ProjectEditor;
