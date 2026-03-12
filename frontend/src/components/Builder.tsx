import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Collapse,
  Divider,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import {
  ClearOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  ToolOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type { BuildFormData, ChapterData, InputMode } from "../types";
import { api, type YoutubeInfoResult } from "../api";
import {
  getDefaultMetadataLanguage,
  getMetadataLanguageOptions,
  type MetadataLanguage,
} from "../appPreferences";
import { useUiI18n, type UiLanguage } from "../uiI18n";
import ChapterList, { createEmptyChapter } from "./ChapterList";
import LabelSettings, { defaultLabelConfig, type LabelConfig } from "./LabelSettings";
import CoverCropModal from "./CoverCropModal";

const { Title, Text } = Typography;

const CATEGORY_BITRATE: Record<string, number> = {
  "audio-play": 96,
  "audio-book": 96,
  music: 128,
  "audio-play-songs": 128,
  "audio-book-songs": 128,
  "audio-play-educational": 96,
};

const YOUTUBE_CONSENT_KEY = "tafforge.youtube.consent.v1";
const YOUTUBE_AUTO_COVER_KEY = "tafforge.youtube.auto_cover.v1";

const getBitrateForCategory = (category: string): number =>
  CATEGORY_BITRATE[category] ?? 96;

const sanitizeTitle = (value: string): string =>
  value.replace(/[^a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\s\-]/g, "");

const isYoutubeMode = (mode: InputMode): boolean =>
  mode === "yt-single" || mode === "yt-splitter" || mode === "yt-auto" || mode === "yt-multi";

const secondsToTimestamp = (value: number): string => {
  const total = Math.max(0, Math.floor(value));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
};

interface BuilderProps {
  uiLanguage: UiLanguage;
}

const createInitialFormData = (defaultMetadataLanguage: MetadataLanguage): BuildFormData => ({
  title: "",
  series: "",
  episodes: "",
  language: defaultMetadataLanguage,
  category: "audio-play",
  inputMode: "files",
  chapters: [createEmptyChapter()],
  bitrate: 96,
  createCustomEntry: true,
  generateLabel: false,
});

const responsiveGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
} as const;
const statusGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
} as const;

const Builder = ({ uiLanguage }: BuilderProps) => {
  const { text } = useUiI18n();
  const defaultMetadataLanguage = getDefaultMetadataLanguage(uiLanguage);
  const metadataLanguageOptions = getMetadataLanguageOptions(text.metadata.languages);
  const categoryOptions = [
    { value: "audio-play", label: `${text.metadata.categories["audio-play"]} (96 kbps)` },
    { value: "audio-book", label: `${text.metadata.categories["audio-book"]} (96 kbps)` },
    { value: "music", label: `${text.metadata.categories.music} (128 kbps)` },
    { value: "audio-play-songs", label: `${text.metadata.categories["audio-play-songs"]} (128 kbps)` },
    { value: "audio-book-songs", label: `${text.metadata.categories["audio-book-songs"]} (128 kbps)` },
    { value: "audio-play-educational", label: `${text.metadata.categories["audio-play-educational"]} (96 kbps)` },
  ];
  const [formData, setFormData] = useState<BuildFormData>(() => createInitialFormData(defaultMetadataLanguage));
  const previousDefaultLanguageRef = useRef<MetadataLanguage>(defaultMetadataLanguage);
  const [labelConfig, setLabelConfig] = useState<LabelConfig>(defaultLabelConfig);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [splitterFile, setSplitterFile] = useState<File | undefined>();
  const [building, setBuilding] = useState(false);
  const [finishedProjectId, setFinishedProjectId] = useState("");
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [lastDraftProjectId, setLastDraftProjectId] = useState("");

  const [youtubeEnabled, setYoutubeEnabled] = useState(false);
  const [youtubeConsentOpen, setYoutubeConsentOpen] = useState(false);
  const [youtubeConsentChecked, setYoutubeConsentChecked] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeProjectId, setYoutubeProjectId] = useState("");
  const [youtubeSourceFile, setYoutubeSourceFile] = useState("");
  const [youtubeInfo, setYoutubeInfo] = useState<YoutubeInfoResult | null>(null);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeThumbLoading, setYoutubeThumbLoading] = useState(false);
  const [youtubeAutoCover, setYoutubeAutoCover] = useState(false);
  const [multiDownloadLoadingId, setMultiDownloadLoadingId] = useState("");
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const youtubeRequestSeqRef = useRef(0);
  const autoFilledTitleRef = useRef("");
  const lastDownloadedSourceUrlRef = useRef("");
  const lastPolledMessageRef = useRef("");
  const buildPollTimeoutRef = useRef<number | null>(null);
  const buildPollRunRef = useRef(0);

  const appendLog = (line: string) => {
    const ts = new Date().toLocaleTimeString(text.locale, { hour12: false });
    setStatusLog((prev) => [...prev.slice(-199), `[${ts}] ${line}`]);
  };

  const clearBuildPoll = () => {
    if (buildPollTimeoutRef.current !== null) {
      window.clearTimeout(buildPollTimeoutRef.current);
      buildPollTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    setFormData((prev) =>
      prev.language === previousDefaultLanguageRef.current
        ? { ...prev, language: defaultMetadataLanguage }
        : prev
    );
    previousDefaultLanguageRef.current = defaultMetadataLanguage;
  }, [defaultMetadataLanguage]);

  useEffect(() => {
    const consent = window.localStorage.getItem(YOUTUBE_CONSENT_KEY) === "true";
    const autoCover = window.localStorage.getItem(YOUTUBE_AUTO_COVER_KEY) === "true";
    if (consent) {
      setYoutubeEnabled(true);
    }
    setYoutubeAutoCover(autoCover);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(YOUTUBE_AUTO_COVER_KEY, youtubeAutoCover ? "true" : "false");
  }, [youtubeAutoCover]);

  useEffect(() => {
    return () => {
      buildPollRunRef.current += 1;
      clearBuildPoll();
    };
  }, []);

  const handleInputModeChange = (mode: InputMode) => {
    if (isYoutubeMode(mode) && !youtubeEnabled) {
      message.warning(text.builder.errors.urlModeDisabled);
      return;
    }

    setFinishedProjectId("");
    setError("");
    setFormData((prev) => {
      let chapters = prev.chapters;
      if (mode === "yt-single") {
        chapters = [prev.chapters[0] ?? createEmptyChapter()];
      } else if (mode === "yt-auto") {
        chapters = [];
      } else if (chapters.length === 0) {
        chapters = [createEmptyChapter()];
      }
      return { ...prev, inputMode: mode, chapters };
    });
  };

  const handleYoutubeToggle = (checked: boolean) => {
    if (!checked) {
      setYoutubeEnabled(false);
      if (isYoutubeMode(formData.inputMode)) {
        setFormData((prev) => ({ ...prev, inputMode: "files", chapters: [createEmptyChapter()] }));
      }
      return;
    }

    if (window.localStorage.getItem(YOUTUBE_CONSENT_KEY) === "true") {
      setYoutubeEnabled(true);
      return;
    }
    setYoutubeConsentOpen(true);
  };

  const loadYoutubeInfo = async () => {
    if (!youtubeUrl.trim()) {
      setError(text.builder.errors.sourceUrlMissing);
      return;
    }
    const normalizedUrl = youtubeUrl.trim();
    const reqSeq = ++youtubeRequestSeqRef.current;
    setError("");
    if (lastDownloadedSourceUrlRef.current && lastDownloadedSourceUrlRef.current !== normalizedUrl) {
      setYoutubeSourceFile("");
    }
    setYoutubeLoading(true);
    try {
      const info = await api.youtubeInfo(normalizedUrl, youtubeProjectId || undefined);
      if (reqSeq !== youtubeRequestSeqRef.current) return;
      setYoutubeInfo(info);
      if (info.title) {
        const safe = sanitizeTitle(info.title);
        setFormData((prev) => {
          const current = (prev.title || "").trim();
          if (!current || current === autoFilledTitleRef.current) {
            autoFilledTitleRef.current = safe;
            return { ...prev, title: safe };
          }
          return prev;
        });
      }
    } catch (err) {
      if (reqSeq !== youtubeRequestSeqRef.current) return;
      setError(err instanceof Error ? err.message : text.builder.errors.sourceInfoFailed);
    } finally {
      if (reqSeq === youtubeRequestSeqRef.current) {
        setYoutubeLoading(false);
      }
    }
  };

  const downloadYoutubeSource = async () => {
    if (!youtubeUrl.trim()) {
      setError(text.builder.errors.sourceUrlMissing);
      return;
    }
    const normalizedUrl = youtubeUrl.trim();
    const reqSeq = ++youtubeRequestSeqRef.current;
    setError("");
    setYoutubeLoading(true);
    try {
      const result = await api.youtubeDownload(normalizedUrl, youtubeProjectId || undefined);
      if (reqSeq !== youtubeRequestSeqRef.current) return;
      setYoutubeProjectId(result.project_id);
      setLastDraftProjectId(result.project_id);
      setYoutubeSourceFile(result.filename);
      lastDownloadedSourceUrlRef.current = normalizedUrl;
      setYoutubeInfo({
        title: result.title,
        duration: result.duration,
        uploader: result.uploader,
        provider: result.provider,
        thumbnail: result.thumbnail,
        chapters: result.chapters,
      });

      if (result.title) {
        const safe = sanitizeTitle(result.title);
        setFormData((prev) => {
          const current = (prev.title || "").trim();
          if (!current || current === autoFilledTitleRef.current) {
            autoFilledTitleRef.current = safe;
            return { ...prev, title: safe };
          }
          return prev;
        });
      }

      if (formData.inputMode === "yt-auto") {
        const chapters: ChapterData[] = result.chapters.map((ch, idx) => ({
          ...createEmptyChapter(),
          sourceType: "youtube",
          title: ch.title || text.chapterList.title(idx + 1),
          sourceFileName: result.filename,
          startTime: secondsToTimestamp(ch.start_time),
          endTime: ch.end_time != null ? secondsToTimestamp(ch.end_time) : undefined,
        }));
        setFormData((prev) => ({
          ...prev,
          chapters: chapters.length > 0 ? chapters : [createEmptyChapter()],
        }));
      } else if (formData.inputMode === "yt-single") {
        setFormData((prev) => ({
          ...prev,
          chapters: [
            {
              ...(prev.chapters[0] ?? createEmptyChapter()),
              title: prev.chapters[0]?.title || result.title || text.chapterList.title(1),
              sourceType: "youtube",
              sourceFileName: result.filename,
            },
          ],
        }));
      } else {
        setFormData((prev) => ({
          ...prev,
          chapters: prev.chapters.map((ch) => ({
            ...ch,
            sourceType: "youtube",
            sourceFileName: result.filename,
          })),
        }));
      }

      if (youtubeAutoCover) {
        await applyYoutubeThumbnail(normalizedUrl, true);
      }
      appendLog(text.builder.status.sourcePrepared(result.filename));
    } catch (err) {
      if (reqSeq !== youtubeRequestSeqRef.current) return;
      setError(err instanceof Error ? err.message : text.builder.errors.downloadFailed);
    } finally {
      if (reqSeq === youtubeRequestSeqRef.current) {
        setYoutubeLoading(false);
      }
    }
  };

  const applyYoutubeThumbnail = async (url: string, silent = false) => {
    if (!url.trim()) {
      setError(text.builder.errors.sourceUrlMissing);
      return;
    }
    setYoutubeThumbLoading(true);
    try {
      const { blob, filename } = await api.youtubeThumbnail(url.trim());
      const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
      setCropFile(file);
      setCropOpen(true);
      if (!silent) {
        message.success(text.builder.buttons.useThumbnail);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : text.builder.errors.previewImageFailed;
      if (!silent) {
        setError(msg);
      }
    } finally {
      setYoutubeThumbLoading(false);
    }
  };

  const downloadMultiChapter = async (chapter: ChapterData) => {
    if (!chapter.youtubeUrl?.trim()) {
      setError(text.builder.errors.chapterUrlMissing);
      return;
    }
    setError("");
    setMultiDownloadLoadingId(chapter.id);
    try {
      const result = await api.youtubeDownload(chapter.youtubeUrl.trim(), youtubeProjectId || undefined);
      setYoutubeProjectId(result.project_id);
      setLastDraftProjectId(result.project_id);
      setFormData((prev) => ({
        ...prev,
        chapters: prev.chapters.map((ch) =>
          ch.id === chapter.id
            ? {
                ...ch,
                sourceType: "youtube",
                sourceFileName: result.filename,
                title: ch.title || result.title || ch.title,
              }
            : ch
        ),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : text.builder.errors.downloadFailed);
    } finally {
      setMultiDownloadLoadingId("");
    }
  };

  const downloadAllMulti = async () => {
    for (const chapter of formData.chapters) {
      if (chapter.youtubeUrl?.trim() && !chapter.sourceFileName) {
        // eslint-disable-next-line no-await-in-loop
        await downloadMultiChapter(chapter);
      }
    }
  };

  const startTrimPreview = () => {
    const audio = previewRef.current;
    const chapter = formData.chapters[0];
    if (!audio || !chapter) return;

    const start = chapter.startTime ? parseTimestamp(chapter.startTime) : 0;
    const end = chapter.endTime ? parseTimestamp(chapter.endTime) : undefined;
    audio.currentTime = start;
    audio.ontimeupdate = () => {
      if (end != null && end > 0 && audio.currentTime >= end) {
        audio.pause();
      }
    };
    void audio.play();
  };

  const handleBuild = async () => {
    setBuilding(true);
    setError("");
    setProgress(0);
    setStatusMessage(text.builder.status.startBuild);
    setStatusLog([]);
    lastPolledMessageRef.current = "";
    buildPollRunRef.current += 1;
    clearBuildPoll();
    appendLog(text.builder.status.started);

    try {
      let projectId = "";

      if (formData.inputMode === "files") {
        for (const chapter of formData.chapters) {
          if (!chapter.sourceFile) continue;
          const result = await api.uploadAudio(chapter.sourceFile, projectId || undefined);
          projectId = result.project_id;
          setLastDraftProjectId(projectId);
        }
      } else if (formData.inputMode === "splitter") {
        if (!splitterFile) {
          throw new Error(text.builder.errors.splitterFileMissing);
        }
        const result = await api.uploadAudio(splitterFile, projectId || undefined);
        projectId = result.project_id;
        setLastDraftProjectId(projectId);
      } else if (formData.inputMode === "yt-multi") {
        if (!youtubeProjectId) {
          throw new Error(text.builder.errors.youtubeChaptersMissing);
        }
        const missing = formData.chapters.find((ch) => !ch.sourceFileName);
        if (missing) {
          throw new Error(text.builder.errors.youtubeChaptersIncomplete);
        }
        projectId = youtubeProjectId;
      } else {
        if (!youtubeProjectId || !youtubeSourceFile) {
          throw new Error(text.builder.errors.youtubeAudioMissing);
        }
        projectId = youtubeProjectId;
      }

      if (!projectId) {
        throw new Error(text.builder.errors.audioSourceMissing);
      }

      if (formData.coverImage) {
        await api.uploadImage(formData.coverImage, projectId, "cover");
      }

      const chapters = formData.chapters.map((ch, i) => {
        let source = "";
        if (formData.inputMode === "files") {
          source = ch.sourceFile?.name ?? "";
        } else if (formData.inputMode === "splitter") {
          source = splitterFile?.name ?? "";
        } else if (formData.inputMode === "yt-multi") {
          source = ch.sourceFileName ?? "";
        } else {
          source = youtubeSourceFile;
        }
        return {
          title: ch.title || text.chapterList.title(i + 1),
          source,
          start_time: ch.startTime ? parseTimestamp(ch.startTime) : undefined,
          end_time: ch.endTime ? parseTimestamp(ch.endTime) : undefined,
        };
      });

      const buildResult = await api.startBuild({
        project_id: projectId,
        title: formData.title,
        series: formData.series,
        episodes: formData.episodes,
        language: formData.language,
        category: formData.category,
        chapters,
        bitrate: getBitrateForCategory(formData.category),
        create_custom_entry: formData.createCustomEntry,
      });

      projectId = buildResult.project_id;
      setLastDraftProjectId(projectId);
      appendLog(text.builder.status.buildJob(projectId));

      const pollRun = buildPollRunRef.current;
      const pollBuildStatus = async (): Promise<void> => {
        if (pollRun !== buildPollRunRef.current) {
          return;
        }
        try {
          const status = await api.buildStatus(projectId);
          if (pollRun !== buildPollRunRef.current) {
            return;
          }
          setProgress(status.progress);
          setStatusMessage(status.message);
          if (status.message && status.message !== lastPolledMessageRef.current) {
            lastPolledMessageRef.current = status.message;
            appendLog(`${status.progress}% ${status.message}`);
          }

          if (status.status === "done" || status.status === "error") {
            clearBuildPoll();
            setBuilding(false);
            if (status.status === "error") {
              setError(status.message);
              appendLog(text.builder.status.error(status.message));
            } else {
              const finalId = status.project_id || projectId;
              setFinishedProjectId(finalId);
              appendLog(text.builder.status.buildOk(finalId));
              if (labelConfig.enabled) {
                void api.generateLabel({
                  project_id: finalId,
                  title: formData.title,
                  series: formData.series,
                  text_line1: labelConfig.textLine1,
                  text_line2: labelConfig.textLine2,
                  shape: labelConfig.shape,
                  diameter_mm: labelConfig.diameterMm,
                  print_mode: labelConfig.printMode,
                  tracks: formData.chapters.map((ch) => ch.title).filter(Boolean),
                  show_tracklist: labelConfig.showTracklist,
                  show_series_on_image: labelConfig.showSeriesOnImage,
                  bg_color: labelConfig.bgColor,
                  font_size: labelConfig.fontSize,
                });
                appendLog(text.builder.status.labelRequested);
              }
            }
            return;
          }
        } catch {
          if (pollRun !== buildPollRunRef.current) {
            return;
          }
          clearBuildPoll();
          setBuilding(false);
          setError(text.builder.errors.connectionLost);
          appendLog(text.builder.status.error(text.builder.errors.connectionLost));
          return;
        }
        buildPollTimeoutRef.current = window.setTimeout(() => {
          void pollBuildStatus();
        }, 1000);
      };

      await pollBuildStatus();
    } catch (err) {
      clearBuildPoll();
      setBuilding(false);
      const msg = err instanceof Error ? err.message : text.builder.errors.unknown;
      setError(msg);
      appendLog(text.builder.status.error(msg));
    }
  };

  const downloadErrorLog = () => {
    if (!statusLog.length) return;
    const content = statusLog.join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `forge-error-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const resetForge = async () => {
    buildPollRunRef.current += 1;
    clearBuildPoll();
    if (lastDraftProjectId) {
      try {
        await api.cleanupProjectTemp(lastDraftProjectId);
      } catch {
        // ignore optional cleanup failure
      }
    }
    setFormData({
      ...createInitialFormData(defaultMetadataLanguage),
      coverImage: undefined,
    });
    setLabelConfig(defaultLabelConfig);
    setSplitterFile(undefined);
    setYoutubeUrl("");
    setYoutubeProjectId("");
    setYoutubeSourceFile("");
    setYoutubeInfo(null);
    setProgress(0);
    setStatusMessage("");
    setError("");
    setFinishedProjectId("");
    setStatusLog([]);
    setLastDraftProjectId("");
    lastPolledMessageRef.current = "";
    lastDownloadedSourceUrlRef.current = "";
    autoFilledTitleRef.current = "";
    appendLog(text.builder.status.reset);
  };

  const tracksForLabel = formData.chapters.map((ch) => ch.title).filter(Boolean);
  const canUseYoutubeSingleSource =
    formData.inputMode === "yt-single" || formData.inputMode === "yt-splitter" || formData.inputMode === "yt-auto";
  const youtubeUrlReady = Boolean(youtubeUrl.trim());
  const youtubeInfoReady = Boolean(youtubeInfo);
  const youtubeSourceReady = Boolean(youtubeProjectId && youtubeSourceFile);
  const youtubeStatusItems = [
    {
      label: text.builder.youtube.status.url,
      ready: youtubeUrlReady,
      busy: false,
      detail: youtubeUrlReady ? youtubeUrl.trim() : text.builder.youtube.status.pendingDetail,
    },
    {
      label: text.builder.youtube.status.info,
      ready: youtubeInfoReady,
      busy: youtubeLoading && !youtubeSourceReady,
      detail: youtubeInfo?.title || text.builder.youtube.status.infoPending,
    },
    {
      label: text.builder.youtube.status.source,
      ready: youtubeSourceReady,
      busy: youtubeLoading && youtubeUrlReady,
      detail: youtubeSourceFile || text.builder.youtube.status.sourcePending,
    },
    {
      label: text.builder.youtube.status.cover,
      ready: youtubeAutoCover,
      busy: youtubeThumbLoading,
      detail: youtubeAutoCover ? text.builder.youtube.status.coverAuto : text.builder.youtube.status.coverManual,
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={4}>{text.builder.pageTitle}</Title>

      <Card title={text.builder.cards.metadata}>
        <Form layout="vertical">
          <Form.Item label={text.common.title} required>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: sanitizeTitle(e.target.value) })}
              placeholder={text.builder.fields.titlePlaceholder}
            />
          </Form.Item>
          <div style={responsiveGridStyle}>
            <Form.Item label={text.common.series}>
              <Input
                value={formData.series}
                onChange={(e) => setFormData({ ...formData, series: e.target.value })}
                placeholder={text.builder.fields.seriesPlaceholder}
              />
            </Form.Item>
            <Form.Item label={text.common.episode}>
              <Input
                value={formData.episodes}
                onChange={(e) => setFormData({ ...formData, episodes: e.target.value })}
                placeholder={text.builder.fields.episodePlaceholder}
              />
            </Form.Item>
            <Form.Item label={text.common.language}>
              <Select
                value={formData.language}
                onChange={(val) => setFormData({ ...formData, language: val })}
                options={metadataLanguageOptions}
              />
            </Form.Item>
            <Form.Item label={text.common.category}>
              <Select
                value={formData.category}
                onChange={(val) => setFormData({ ...formData, category: val })}
                options={categoryOptions}
              />
            </Form.Item>
          </div>
          <Form.Item
            label={text.common.cover}
            help={text.builder.fields.coverHelp}
          >
            <Upload
              beforeUpload={(file) => {
                setCropFile(file);
                setCropOpen(true);
                return false;
              }}
              maxCount={1}
              accept="image/png,image/jpeg,image/svg+xml"
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />}>
                {formData.coverImage ? formData.coverImage.name : text.builder.buttons.chooseCover}
              </Button>
            </Upload>
          </Form.Item>
        </Form>
      </Card>

      <Card title={text.builder.cards.source}>
        <Form layout="vertical">
              <Form.Item label={text.builder.youtube.enable}>
            <Space>
              <Switch
                checked={youtubeEnabled}
                onChange={handleYoutubeToggle}
                checkedChildren={text.builder.youtube.enabled}
                unCheckedChildren={text.builder.youtube.disabled}
              />
              <Text type="secondary">{text.builder.youtube.description}</Text>
            </Space>
          </Form.Item>

          <Collapse
            size="small"
            ghost
            items={[
              {
                key: "source-info",
                label: text.builder.youtube.sourceInfoTitle,
                children: (
                  <Space direction="vertical" size={4}>
                    {text.builder.youtube.sourceInfo.map((line, index) => (
                      <Text key={index} type={index === text.builder.youtube.sourceInfo.length - 1 ? "secondary" : undefined}>
                        {line}
                      </Text>
                    ))}
                  </Space>
                ),
              },
            ]}
          />

          <Form.Item label={text.builder.fields.inputMode}>
            <Select
              value={formData.inputMode}
              onChange={handleInputModeChange}
              options={[
                { value: "files", label: text.builder.inputModes.files },
                { value: "splitter", label: text.builder.inputModes.splitter },
                { value: "yt-single", label: text.builder.inputModes.ytSingle, disabled: !youtubeEnabled },
                { value: "yt-splitter", label: text.builder.inputModes.ytSplitter, disabled: !youtubeEnabled },
                { value: "yt-auto", label: text.builder.inputModes.ytAuto, disabled: !youtubeEnabled },
                { value: "yt-multi", label: text.builder.inputModes.ytMulti, disabled: !youtubeEnabled },
              ]}
            />
          </Form.Item>

          {formData.inputMode === "splitter" && (
            <Form.Item label={text.common.upload}>
              <Upload
                beforeUpload={(file) => {
                  setSplitterFile(file);
                  return false;
                }}
                maxCount={1}
                accept="audio/*"
              >
                <Button icon={<UploadOutlined />}>
                  {splitterFile ? splitterFile.name : text.builder.buttons.chooseAudio}
                </Button>
              </Upload>
            </Form.Item>
          )}

          {canUseYoutubeSingleSource && (
            <>
              <Form.Item label={text.builder.fields.sourceUrl}>
                <Input
                  value={youtubeUrl}
                  onChange={(e) => {
                    const value = e.target.value;
                    setYoutubeUrl(value);
                    if (value.trim() !== lastDownloadedSourceUrlRef.current) {
                      setYoutubeSourceFile("");
                    }
                  }}
                  placeholder={text.builder.fields.sourceUrlPlaceholder}
                />
              </Form.Item>
              <Space wrap>
                <Button onClick={loadYoutubeInfo} loading={youtubeLoading}>
                  {text.builder.buttons.loadInfo}
                </Button>
                <Button type="primary" onClick={downloadYoutubeSource} loading={youtubeLoading}>
                  {text.builder.buttons.prepareSource}
                </Button>
                <Button
                  onClick={() => applyYoutubeThumbnail(youtubeUrl)}
                  loading={youtubeThumbLoading}
                  disabled={!youtubeUrl.trim()}
                >
                  {text.builder.buttons.useThumbnail}
                </Button>
              </Space>
              <Form.Item label={text.builder.fields.coverFromPreview}>
                <Space>
                  <Switch
                    checked={youtubeAutoCover}
                    onChange={setYoutubeAutoCover}
                    checkedChildren={text.builder.youtube.auto}
                    unCheckedChildren={text.builder.youtube.manual}
                  />
                  <Text type="secondary">
                    {text.builder.youtube.autoCoverDescription}
                  </Text>
                </Space>
              </Form.Item>
              <Card size="small" title={text.builder.cards.sourceStatus}>
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {youtubeStatusItems.map((item) => (
                      <Tag
                        key={item.label}
                        color={item.busy ? "processing" : item.ready ? "success" : "default"}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {item.label}: {item.busy ? text.builder.youtube.status.busy : item.ready ? text.builder.youtube.status.ready : text.builder.youtube.status.pending}
                      </Tag>
                    ))}
                  </div>
                  <div style={statusGridStyle}>
                    {youtubeStatusItems.map((item) => (
                      <div
                        key={`${item.label}-detail`}
                        style={{
                          border: "1px solid rgba(148, 163, 184, 0.25)",
                          borderRadius: 10,
                          padding: "10px 12px",
                          background: "rgba(148, 163, 184, 0.08)",
                        }}
                      >
                        <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
                          {item.label}
                        </Text>
                        <Text style={{ wordBreak: "break-word" }}>{item.detail}</Text>
                      </div>
                    ))}
                    <div
                      style={{
                        border: "1px solid rgba(148, 163, 184, 0.25)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        background: "rgba(148, 163, 184, 0.08)",
                      }}
                    >
                      <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
                        {text.builder.youtube.status.project}
                      </Text>
                      <Text style={{ wordBreak: "break-word" }}>
                        {youtubeProjectId || text.builder.youtube.status.pendingDetail}
                      </Text>
                    </div>
                    <div
                      style={{
                        border: "1px solid rgba(148, 163, 184, 0.25)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        background: "rgba(148, 163, 184, 0.08)",
                      }}
                    >
                      <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
                        {text.builder.youtube.status.provider}
                      </Text>
                      <Text>{youtubeInfo?.provider || text.builder.youtube.status.pendingDetail}</Text>
                    </div>
                    <div
                      style={{
                        border: "1px solid rgba(148, 163, 184, 0.25)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        background: "rgba(148, 163, 184, 0.08)",
                      }}
                    >
                      <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
                        {text.builder.youtube.status.duration}
                      </Text>
                      <Text>
                        {youtubeInfo ? secondsToTimestamp(youtubeInfo.duration) : text.builder.youtube.status.pendingDetail}
                      </Text>
                    </div>
                    <div
                      style={{
                        border: "1px solid rgba(148, 163, 184, 0.25)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        background: "rgba(148, 163, 184, 0.08)",
                      }}
                    >
                      <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
                        {text.builder.youtube.status.chapters}
                      </Text>
                      <Text>
                        {youtubeInfo ? String(youtubeInfo.chapters.length) : text.builder.youtube.status.pendingDetail}
                      </Text>
                    </div>
                  </div>
                </Space>
              </Card>
              {youtubeInfo && (
                <Text type="secondary">
                  {text.builder.youtube.providerInfo(
                    youtubeInfo.provider || "",
                    youtubeInfo.title,
                    secondsToTimestamp(youtubeInfo.duration),
                    youtubeInfo.chapters.length
                  )}
                </Text>
              )}
            </>
          )}

          {formData.inputMode === "yt-multi" && (
            <Space>
              <Button onClick={downloadAllMulti}>{text.builder.buttons.loadAllUrls}</Button>
              {youtubeProjectId && <Text type="secondary">{text.builder.youtube.projectLabel(youtubeProjectId)}</Text>}
            </Space>
          )}
        </Form>

        <Divider />

        <ChapterList
          chapters={formData.chapters}
          inputMode={formData.inputMode}
          disableAddRemove={formData.inputMode === "yt-single"}
          onChange={(chapters) => setFormData({ ...formData, chapters })}
        />

        {formData.inputMode === "yt-multi" && (
          <Space direction="vertical" style={{ width: "100%", marginTop: 12 }}>
            {formData.chapters.map((chapter) => (
              <Button
                key={`download-${chapter.id}`}
                onClick={() => downloadMultiChapter(chapter)}
                loading={multiDownloadLoadingId === chapter.id}
                disabled={!chapter.youtubeUrl}
              >
                {text.builder.chapterDownloadButton(chapter.title)}
              </Button>
            ))}
          </Space>
        )}

        {canUseYoutubeSingleSource && youtubeProjectId && youtubeSourceFile && (
          <Card size="small" title={text.builder.cards.preview} style={{ marginTop: 16 }}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <audio
                ref={previewRef}
                controls
                src={api.youtubeAudioUrl(youtubeProjectId, youtubeSourceFile)}
                style={{ width: "100%" }}
              />
              {formData.inputMode === "yt-single" && (
                <Button onClick={startTrimPreview}>
                  {text.builder.buttons.playTrimPreview}
                </Button>
              )}
            </Space>
          </Card>
        )}
      </Card>

      <Card title={text.builder.cards.settings}>
        <Form layout="vertical">
          <Form.Item>
            <Space>
              <InfoCircleOutlined />
              <Text type="secondary">
                {text.builder.bitrateInfo(getBitrateForCategory(formData.category))}
              </Text>
            </Space>
          </Form.Item>
          <Checkbox
            checked={formData.createCustomEntry}
            onChange={(e) =>
              setFormData({ ...formData, createCustomEntry: e.target.checked })
            }
          >
            {text.builder.buttons.registerCustom}
          </Checkbox>
        </Form>
      </Card>

      <LabelSettings
        config={labelConfig}
        onChange={setLabelConfig}
        title={formData.title}
        series={formData.series}
        coverFile={formData.coverImage}
        tracks={tracksForLabel}
      />

      <Button
        type="primary"
        size="large"
        icon={<ToolOutlined />}
        onClick={handleBuild}
        loading={building}
        disabled={!formData.title || formData.chapters.length === 0}
        block
      >
        {text.builder.buttons.forge}
      </Button>

      <CoverCropModal
        file={cropFile}
        open={cropOpen}
        onConfirm={(croppedFile) => {
          setFormData((prev) => ({ ...prev, coverImage: croppedFile }));
          setCropOpen(false);
          setCropFile(null);
        }}
        onCancel={() => {
          setCropOpen(false);
          setCropFile(null);
        }}
      />

      <Modal
        title={text.builder.legal.title}
        open={youtubeConsentOpen}
        onCancel={() => {
          setYoutubeConsentOpen(false);
          setYoutubeConsentChecked(false);
        }}
        onOk={() => {
          if (!youtubeConsentChecked) {
            message.error(text.builder.errors.confirmConsent);
            return;
          }
          window.localStorage.setItem(YOUTUBE_CONSENT_KEY, "true");
          setYoutubeEnabled(true);
          setYoutubeConsentOpen(false);
          setYoutubeConsentChecked(false);
        }}
        okText={text.builder.legal.accept}
        cancelText={text.common.cancel}
      >
        <Space direction="vertical">
          <Text>
            {text.builder.legal.text1}
          </Text>
          <Text>
            {text.builder.legal.text2}
          </Text>
          <Checkbox
            checked={youtubeConsentChecked}
            onChange={(e) => setYoutubeConsentChecked(e.target.checked)}
          >
            {text.builder.legal.checkbox}
          </Checkbox>
        </Space>
      </Modal>

      {finishedProjectId && (
        <Card title={text.builder.cards.done}>
          <Space>
            <Button
              icon={<DownloadOutlined />}
              type="link"
              href={`/api/export/zip/${finishedProjectId}`}
            >
              {text.builder.buttons.downloadZip}
            </Button>
            {labelConfig.enabled && (
              <Button
                type="link"
                href={`/api/label/preview/${finishedProjectId}`}
                target="_blank"
              >
                {text.builder.buttons.viewLabelPdf}
              </Button>
            )}
            <Button icon={<ClearOutlined />} onClick={() => void resetForge()}>
              {text.builder.buttons.reset}
            </Button>
          </Space>
        </Card>
      )}

      <Card title={text.builder.cards.status}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Progress percent={progress} status={error ? "exception" : building ? "active" : "normal"} />
          <Text type={error ? "danger" : "secondary"}>
            {error ? text.builder.status.error(error) : statusMessage || text.builder.status.readyLabel}
          </Text>
          <div
            style={{
              background: "#0b0f14",
              border: "1px solid #1f2937",
              borderRadius: 8,
              padding: 12,
              minHeight: 120,
              maxHeight: 260,
              overflow: "auto",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 12,
              color: "#c9d1d9",
              whiteSpace: "pre-wrap",
            }}
          >
            {statusLog.length ? statusLog.join("\n") : text.builder.status.ready}
          </div>
          <Space>
            {(finishedProjectId || error) && (
              <Button icon={<ClearOutlined />} onClick={() => void resetForge()}>
                {text.builder.buttons.reset}
              </Button>
            )}
            {error && statusLog.length > 0 && (
              <Button icon={<DownloadOutlined />} onClick={downloadErrorLog}>
                {text.builder.buttons.downloadErrorLog}
              </Button>
            )}
          </Space>
        </Space>
      </Card>
    </Space>
  );
};

const parseTimestamp = (ts: string): number => {
  const parts = ts.split(":").map(Number);
  if (parts.length === 3) {
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  if (parts.length === 2) {
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  return parts[0] ?? 0;
};

export default Builder;
