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

const Builder = () => {
  const [formData, setFormData] = useState<BuildFormData>({
    title: "",
    series: "",
    episodes: "",
    language: "de-de",
    category: "audio-play",
    inputMode: "files",
    chapters: [createEmptyChapter()],
    bitrate: 96,
    createCustomEntry: true,
    generateLabel: false,
  });
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

  const appendLog = (line: string) => {
    const ts = new Date().toLocaleTimeString("de-DE", { hour12: false });
    setStatusLog((prev) => [...prev.slice(-199), `[${ts}] ${line}`]);
  };

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

  const handleInputModeChange = (mode: InputMode) => {
    if (isYoutubeMode(mode) && !youtubeEnabled) {
      message.warning("URL-Modus ist deaktiviert");
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
      setError("Bitte Quell-URL eingeben");
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
      setError(err instanceof Error ? err.message : "Quell-Infos konnten nicht geladen werden");
    } finally {
      if (reqSeq === youtubeRequestSeqRef.current) {
        setYoutubeLoading(false);
      }
    }
  };

  const downloadYoutubeSource = async () => {
    if (!youtubeUrl.trim()) {
      setError("Bitte Quell-URL eingeben");
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
          title: ch.title || `Kapitel ${idx + 1}`,
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
              title: prev.chapters[0]?.title || result.title || "Kapitel 1",
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
      appendLog(`Quelle vorbereitet: ${result.filename}`);
    } catch (err) {
      if (reqSeq !== youtubeRequestSeqRef.current) return;
      setError(err instanceof Error ? err.message : "URL-Download fehlgeschlagen");
    } finally {
      if (reqSeq === youtubeRequestSeqRef.current) {
        setYoutubeLoading(false);
      }
    }
  };

  const applyYoutubeThumbnail = async (url: string, silent = false) => {
    if (!url.trim()) {
      setError("Bitte Quell-URL eingeben");
      return;
    }
    setYoutubeThumbLoading(true);
    try {
      const { blob, filename } = await api.youtubeThumbnail(url.trim());
      const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
      setCropFile(file);
      setCropOpen(true);
      if (!silent) {
        message.success("Thumbnail als Cover-Vorschlag geladen");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Previewbild konnte nicht geladen werden";
      if (!silent) {
        setError(msg);
      }
    } finally {
      setYoutubeThumbLoading(false);
    }
  };

  const downloadMultiChapter = async (chapter: ChapterData) => {
    if (!chapter.youtubeUrl?.trim()) {
      setError("Bitte URL fuer das Kapitel eingeben");
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
      setError(err instanceof Error ? err.message : "URL-Download fehlgeschlagen");
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
    setStatusMessage("Starte Build...");
    setStatusLog([]);
    lastPolledMessageRef.current = "";
    appendLog("Forge gestartet");

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
          throw new Error("Bitte Audio-Datei fuer Splitter-Modus waehlen");
        }
        const result = await api.uploadAudio(splitterFile, projectId || undefined);
        projectId = result.project_id;
        setLastDraftProjectId(projectId);
      } else if (formData.inputMode === "yt-multi") {
        if (!youtubeProjectId) {
          throw new Error("Bitte zuerst YouTube-Kapitel laden");
        }
        const missing = formData.chapters.find((ch) => !ch.sourceFileName);
        if (missing) {
          throw new Error("Alle YouTube-Kapitel muessen geladen werden");
        }
        projectId = youtubeProjectId;
      } else {
        if (!youtubeProjectId || !youtubeSourceFile) {
          throw new Error("Bitte YouTube-Audio zuerst laden");
        }
        projectId = youtubeProjectId;
      }

      if (!projectId) {
        throw new Error("Keine Audio-Quelle vorhanden");
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
          title: ch.title || `Kapitel ${i + 1}`,
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
      appendLog(`Build-Job: ${projectId}`);

      const poll = setInterval(async () => {
        try {
          const status = await api.buildStatus(projectId);
          setProgress(status.progress);
          setStatusMessage(status.message);
          if (status.message && status.message !== lastPolledMessageRef.current) {
            lastPolledMessageRef.current = status.message;
            appendLog(`${status.progress}% ${status.message}`);
          }

          if (status.status === "done" || status.status === "error") {
            clearInterval(poll);
            setBuilding(false);
            if (status.status === "error") {
              setError(status.message);
              appendLog(`ERROR: ${status.message}`);
            } else {
              const finalId = status.project_id || projectId;
              setFinishedProjectId(finalId);
              appendLog(`OK: ${finalId}`);
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
                appendLog("Label-Generierung angefordert");
              }
            }
          }
        } catch {
          clearInterval(poll);
          setBuilding(false);
          setError("Verbindung zum Server verloren");
          appendLog("ERROR: Verbindung zum Server verloren");
        }
      }, 1000);
    } catch (err) {
      setBuilding(false);
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      setError(msg);
      appendLog(`ERROR: ${msg}`);
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
    if (lastDraftProjectId) {
      try {
        await api.cleanupProjectTemp(lastDraftProjectId);
      } catch {
        // ignore optional cleanup failure
      }
    }
    setFormData({
      title: "",
      series: "",
      episodes: "",
      language: "de-de",
      category: "audio-play",
      inputMode: "files",
      chapters: [createEmptyChapter()],
      bitrate: 96,
      createCustomEntry: true,
      generateLabel: false,
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
    appendLog("Neu gestartet");
  };

  const tracksForLabel = formData.chapters.map((ch) => ch.title).filter(Boolean);
  const canUseYoutubeSingleSource =
    formData.inputMode === "yt-single" || formData.inputMode === "yt-splitter" || formData.inputMode === "yt-auto";

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={4}>Forge TAF</Title>

      <Card title="Metadaten">
        <Form layout="vertical">
          <Form.Item label="Titel" required>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: sanitizeTitle(e.target.value) })}
              placeholder="z.B. Bibi Blocksberg - Hexen gibt es doch"
            />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="Serie">
              <Input
                value={formData.series}
                onChange={(e) => setFormData({ ...formData, series: e.target.value })}
                placeholder="z.B. Bibi Blocksberg"
              />
            </Form.Item>
            <Form.Item label="Episode">
              <Input
                value={formData.episodes}
                onChange={(e) => setFormData({ ...formData, episodes: e.target.value })}
                placeholder="z.B. Hexen gibt es doch"
              />
            </Form.Item>
            <Form.Item label="Sprache">
              <Select
                value={formData.language}
                onChange={(val) => setFormData({ ...formData, language: val })}
                options={[
                  { value: "de-de", label: "Deutsch" },
                  { value: "en-gb", label: "English (UK)" },
                  { value: "en-us", label: "English (US)" },
                  { value: "fr-fr", label: "Francais" },
                  { value: "nl-nl", label: "Nederlands" },
                  { value: "da-dk", label: "Dansk" },
                  { value: "sv-se", label: "Svenska" },
                  { value: "pl-pl", label: "Polski" },
                  { value: "it-it", label: "Italiano" },
                  { value: "es-es", label: "Espanol" },
                  { value: "pt-pt", label: "Portugues" },
                  { value: "fi-fi", label: "Suomi" },
                ]}
              />
            </Form.Item>
            <Form.Item label="Kategorie">
              <Select
                value={formData.category}
                onChange={(val) => setFormData({ ...formData, category: val })}
                options={[
                  { value: "audio-play", label: "Hoerspiel (96 kbps)" },
                  { value: "audio-book", label: "Hoerbuch (96 kbps)" },
                  { value: "music", label: "Musik (128 kbps)" },
                  { value: "audio-play-songs", label: "Hoerspiel + Lieder (128 kbps)" },
                  { value: "audio-book-songs", label: "Hoerbuch + Lieder (128 kbps)" },
                  { value: "audio-play-educational", label: "Lern-Hoerspiel (96 kbps)" },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item
            label="Cover-Bild"
            help="Bild wird im Kreis-Editor zugeschnitten (PNG/JPG/SVG)"
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
                {formData.coverImage ? formData.coverImage.name : "Cover auswaehlen"}
              </Button>
            </Upload>
          </Form.Item>
        </Form>
      </Card>

      <Card title="Audio-Quelle">
        <Form layout="vertical">
          <Form.Item label="URL-Download erlauben (yt-dlp)">
            <Space>
              <Switch
                checked={youtubeEnabled}
                onChange={handleYoutubeToggle}
                checkedChildren="An"
                unCheckedChildren="Aus"
              />
              <Text type="secondary">Aktiviert Download via yt-dlp (YouTube und weitere unterstuetzte Seiten)</Text>
            </Space>
          </Form.Item>

          <Collapse
            size="small"
            ghost
            items={[
              {
                key: "source-info",
                label: "Wichtige Infos zu URL-Quellen",
                children: (
                  <Space direction="vertical" size={4}>
                    <Text>Getestete Quelle: YouTube (inkl. Kapitel-Import wenn vom Video bereitgestellt).</Text>
                    <Text>Weitere Seiten koennen funktionieren, wenn sie von yt-dlp unterstuetzt und serverseitig erlaubt sind.</Text>
                    <Text>Kapitel-Autofill ist derzeit fuer YouTube verfuegbar; andere Quellen oft ohne Kapitelmetadaten.</Text>
                    <Text type="secondary">Bei Problemen helfen Debug-Modus, erneutes Laden oder spaeterer Retry (Rate-Limit/Geo/Policy).</Text>
                  </Space>
                ),
              },
            ]}
          />

          <Form.Item label="Eingabemodus">
            <Select
              value={formData.inputMode}
              onChange={handleInputModeChange}
              options={[
                { value: "files", label: "Einzelne Dateien pro Kapitel" },
                { value: "splitter", label: "Eine Datei + Timestamps (Splitter)" },
                { value: "yt-single", label: "URL: Ein Link = ein Kapitel (Trim)", disabled: !youtubeEnabled },
                { value: "yt-splitter", label: "URL: Ein Link + manuelle Kapitel", disabled: !youtubeEnabled },
                { value: "yt-auto", label: "URL: Ein Link + Auto-Kapitel (YouTube falls vorhanden)", disabled: !youtubeEnabled },
                { value: "yt-multi", label: "URL: Mehrere Links", disabled: !youtubeEnabled },
              ]}
            />
          </Form.Item>

          {formData.inputMode === "splitter" && (
            <Form.Item label="Audio-Datei">
              <Upload
                beforeUpload={(file) => {
                  setSplitterFile(file);
                  return false;
                }}
                maxCount={1}
                accept="audio/*"
              >
                <Button icon={<UploadOutlined />}>
                  {splitterFile ? splitterFile.name : "Audio-Datei waehlen"}
                </Button>
              </Upload>
            </Form.Item>
          )}

          {canUseYoutubeSingleSource && (
            <>
              <Form.Item label="Quell-URL">
                <Input
                  value={youtubeUrl}
                  onChange={(e) => {
                    const value = e.target.value;
                    setYoutubeUrl(value);
                    if (value.trim() !== lastDownloadedSourceUrlRef.current) {
                      setYoutubeSourceFile("");
                    }
                  }}
                  placeholder="https://... (YouTube oder andere yt-dlp-Quelle)"
                />
              </Form.Item>
              <Space wrap>
                <Button onClick={loadYoutubeInfo} loading={youtubeLoading}>
                  Infos laden
                </Button>
                <Button type="primary" onClick={downloadYoutubeSource} loading={youtubeLoading}>
                  URL herunterladen + Quelle vorbereiten
                </Button>
                <Button
                  onClick={() => applyYoutubeThumbnail(youtubeUrl)}
                  loading={youtubeThumbLoading}
                  disabled={!youtubeUrl.trim()}
                >
                  Thumbnail/Previewbild als Cover
                </Button>
              </Space>
              <Form.Item label="Cover aus Quell-Previewbild">
                <Space>
                  <Switch
                    checked={youtubeAutoCover}
                    onChange={setYoutubeAutoCover}
                    checkedChildren="Auto"
                    unCheckedChildren="Manuell"
                  />
                  <Text type="secondary">
                    Bei URL-Download automatisch Previewbild als Cover-Vorschlag laden
                  </Text>
                </Space>
              </Form.Item>
              {youtubeInfo && (
                <Text type="secondary">
                  Anbieter: {youtubeInfo.provider || "unbekannt"} | Titel: {youtubeInfo.title} | Dauer: {secondsToTimestamp(youtubeInfo.duration)} | Kapitel: {youtubeInfo.chapters.length}
                </Text>
              )}
            </>
          )}

          {formData.inputMode === "yt-multi" && (
            <Space>
              <Button onClick={downloadAllMulti}>Alle URL-Links laden</Button>
              {youtubeProjectId && <Text type="secondary">Projekt: {youtubeProjectId}</Text>}
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
                Kapitel-URL laden: {chapter.title || "Unbenannt"}
              </Button>
            ))}
          </Space>
        )}

        {canUseYoutubeSingleSource && youtubeProjectId && youtubeSourceFile && (
          <Card size="small" title="Quell-Vorschau" style={{ marginTop: 16 }}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <audio
                ref={previewRef}
                controls
                src={api.youtubeAudioUrl(youtubeProjectId, youtubeSourceFile)}
                style={{ width: "100%" }}
              />
              {formData.inputMode === "yt-single" && (
                <Button onClick={startTrimPreview}>
                  Vorschau mit Start/Ende abspielen
                </Button>
              )}
            </Space>
          </Card>
        )}
      </Card>

      <Card title="Einstellungen">
        <Form layout="vertical">
          <Form.Item>
            <Space>
              <InfoCircleOutlined />
              <Text type="secondary">
                Bitrate: {getBitrateForCategory(formData.category)} kbps (automatisch)
              </Text>
            </Space>
          </Form.Item>
          <Checkbox
            checked={formData.createCustomEntry}
            onChange={(e) =>
              setFormData({ ...formData, createCustomEntry: e.target.checked })
            }
          >
            Custom Tonie in TeddyCloud registrieren
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
        Forge TAF
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
        title="Rechtlicher Hinweis zu URL-Downloads"
        open={youtubeConsentOpen}
        onCancel={() => {
          setYoutubeConsentOpen(false);
          setYoutubeConsentChecked(false);
        }}
        onOk={() => {
          if (!youtubeConsentChecked) {
            message.error("Bitte Hinweis bestaetigen");
            return;
          }
          window.localStorage.setItem(YOUTUBE_CONSENT_KEY, "true");
          setYoutubeEnabled(true);
          setYoutubeConsentOpen(false);
          setYoutubeConsentChecked(false);
        }}
        okText="Ich akzeptiere"
        cancelText="Abbrechen"
      >
        <Space direction="vertical">
          <Text>
            Du darfst nur Inhalte laden, fuer die du Nutzungsrechte hast. Urheberrechtlich geschuetzte Inhalte ohne Erlaubnis zu speichern oder weiterzugeben ist unzulaessig.
          </Text>
          <Text>
            Du bestaetigst, dass du den Download nur rechtmaessig und in eigener Verantwortung nutzt.
          </Text>
          <Checkbox
            checked={youtubeConsentChecked}
            onChange={(e) => setYoutubeConsentChecked(e.target.checked)}
          >
            Ich habe den Hinweis gelesen und akzeptiere ihn.
          </Checkbox>
        </Space>
      </Modal>

      {finishedProjectId && (
        <Card title="Fertig!">
          <Space>
            <Button
              icon={<DownloadOutlined />}
              type="link"
              href={`/api/export/zip/${finishedProjectId}`}
            >
              ZIP herunterladen
            </Button>
            {labelConfig.enabled && (
              <Button
                type="link"
                href={`/api/label/preview/${finishedProjectId}`}
                target="_blank"
              >
                Label PDF ansehen
              </Button>
            )}
            <Button icon={<ClearOutlined />} onClick={() => void resetForge()}>
              Neu
            </Button>
          </Space>
        </Card>
      )}

      <Card title="Forge Status (CLI)">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Progress percent={progress} status={error ? "exception" : building ? "active" : "normal"} />
          <Text type={error ? "danger" : "secondary"}>
            {error ? `Fehler: ${error}` : statusMessage || "Bereit"}
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
            {statusLog.length ? statusLog.join("\n") : ">> ready"}
          </div>
          <Space>
            {(finishedProjectId || error) && (
              <Button icon={<ClearOutlined />} onClick={() => void resetForge()}>
                Neu
              </Button>
            )}
            {error && statusLog.length > 0 && (
              <Button icon={<DownloadOutlined />} onClick={downloadErrorLog}>
                Error-Log herunterladen
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
