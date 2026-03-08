import { useEffect, useState } from "react";
import {
  Card,
  Button,
  Input,
  Space,
  Typography,
  Popconfirm,
  Alert,
  Tag,
  Collapse,
  Form,
  Select,
  Divider,
  Empty,
} from "antd";
import {
  DeleteOutlined,
  SaveOutlined,
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  CloseOutlined,
  SafetyCertificateOutlined,
  MinusCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { api } from "../api";
import type { CustomTonieEntry } from "../api";
import { getMetadataLanguageOptions, sanitizeMetadataText } from "../appPreferences";
import { useUiI18n } from "../uiI18n";

const { Title, Text } = Typography;

const emptyEntry = (): CustomTonieEntry => ({
  no: "999999",
  model: "999999",
  audio_id: [],
  hash: [],
  title: "",
  series: "",
  episodes: "",
  tracks: [],
  release: "0",
  language: "de-de",
  category: "audio-play",
  pic: "",
});

const getEntryKey = (entry: CustomTonieEntry): string => {
  const aid = entry.audio_id;
  if (Array.isArray(aid) && aid.length > 0) {
    return String(aid[0]);
  }
  if (aid && !Array.isArray(aid)) {
    return String(aid);
  }
  return entry.title || String(Math.random());
};

const CustomToniesEditor = () => {
  const { text, locale } = useUiI18n();
  const metadataLanguageOptions = getMetadataLanguageOptions(text.metadata.languages);
  const categoryOptions = [
    { value: "audio-play", label: text.metadata.categories["audio-play"] },
    { value: "audio-book", label: text.metadata.categories["audio-book"] },
    { value: "music", label: text.metadata.categories.music },
    { value: "audio-play-songs", label: text.metadata.categories["audio-play-songs"] },
    { value: "audio-book-songs", label: text.metadata.categories["audio-book-songs"] },
    { value: "audio-play-educational", label: text.metadata.categories["audio-play-educational"] },
    { value: "creative-tonie", label: text.metadata.categories["creative-tonie"] },
  ];
  const [entries, setEntries] = useState<CustomTonieEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingKey, setEditingKey] = useState("");
  const [editData, setEditData] = useState<CustomTonieEntry>(emptyEntry());
  const [isNew, setIsNew] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [validationResult, setValidationResult] = useState<{
    status: string;
    official_count: number;
    custom_count: number;
    conflicts: { audio_id: string; official_title: string[]; custom_title: string[]; type: string }[];
    custom_duplicates: { audio_id: string; titles: string[]; type: string }[];
    hash_conflicts: { hash: string; official_title: string; custom_title: string; type: string }[];
  } | null>(null);

  const loadEntries = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.getCustomEntries();
      setEntries(result.entries as CustomTonieEntry[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : text.common.loadingError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries();
  }, []);

  const runValidation = async () => {
    try {
      const result = await api.validateDatabases();
      setValidationResult(result);
      if (result.status === "ok") {
        setError("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : text.customTonies.validation.warnings);
    }
  };

  const startEdit = (entry: CustomTonieEntry) => {
    const key = getEntryKey(entry);
    setEditingKey(key);
    setEditData({
      ...entry,
      title: sanitizeMetadataText(entry.title),
      series: sanitizeMetadataText(entry.series),
      episodes: sanitizeMetadataText(entry.episodes),
      language: entry.language === "en-gb" ? "en-gb" : "de-de",
    });
    setIsNew(false);
  };

  const startNew = () => {
    setEditingKey("__new__");
    setEditData(emptyEntry());
    setIsNew(true);
  };

  const cancelEdit = () => {
    setEditingKey("");
    setEditData(emptyEntry());
    setIsNew(false);
  };

  const saveEdit = async () => {
    if (!editData.title) {
      setError(text.customTonies.messages.requiredTitle);
      return;
    }
    try {
      if (isNew) {
        await api.addCustomEntry(editData);
      } else {
        await api.updateCustomEntry(editingKey, editData);
      }
      cancelEdit();
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : text.common.saveError);
    }
  };

  const deleteEntry = async (audioId: string) => {
    try {
      await api.deleteCustomEntry(audioId);
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : text.common.deleteError);
    }
  };

  const updateEditField = (field: keyof CustomTonieEntry, value: unknown) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  };

  const updateTrack = (index: number, value: string) => {
    const tracks = [...editData.tracks];
    tracks[index] = value;
    updateEditField("tracks", tracks);
  };

  const addTrack = () => {
    updateEditField("tracks", [
      ...editData.tracks,
      text.customTonies.fields.trackName(editData.tracks.length + 1),
    ]);
  };

  const removeTrack = (index: number) => {
    updateEditField("tracks", editData.tracks.filter((_, i) => i !== index));
  };

  const updateArrayField = (field: "audio_id" | "hash", index: number, value: string) => {
    const arr = [...editData[field]];
    arr[index] = value;
    updateEditField(field, arr);
  };

  const addArrayItem = (field: "audio_id" | "hash") => {
    updateEditField(field, [...editData[field], ""]);
  };

  const removeArrayItem = (field: "audio_id" | "hash", index: number) => {
    updateEditField(field, editData[field].filter((_, i) => i !== index));
  };

  const renderEntryCard = (entry: CustomTonieEntry) => {
    const key = getEntryKey(entry);
    const isEditing = editingKey === key;
    const data = isEditing ? editData : entry;
    const safeTitle = sanitizeMetadataText(entry.title) || text.customTonies.cards.noTitle;
    const safeSeries = sanitizeMetadataText(entry.series);
    const safeEpisodes = sanitizeMetadataText(entry.episodes);

    const audioIdDisplay = Array.isArray(entry.audio_id)
      ? entry.audio_id.join(", ")
      : String(entry.audio_id || "-");

    return (
      <Card
        key={key}
        size="small"
        title={
          <Space>
            <Text strong>{safeTitle}</Text>
            {safeSeries && <Tag color="blue">{safeSeries}</Tag>}
            <Tag>{audioIdDisplay}</Tag>
          </Space>
        }
        extra={
          isEditing ? (
            <Space>
              <Button size="small" icon={<SaveOutlined />} type="primary" onClick={saveEdit}>
                {text.customTonies.buttons.save}
              </Button>
              <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>
                {text.customTonies.buttons.cancel}
              </Button>
            </Space>
          ) : (
            <Space>
              <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(entry)}>
                {text.common.edit}
              </Button>
              <Popconfirm
                title={text.customTonies.popconfirm.delete}
                onConfirm={() => deleteEntry(key)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )
        }
      >
        {isEditing ? (
          <Form layout="vertical" size="small">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Form.Item label={text.common.title} required>
                <Input
                  value={data.title}
                  onChange={(e) => updateEditField("title", e.target.value)}
                />
              </Form.Item>
              <Form.Item label={text.common.series}>
                <Input
                  value={data.series}
                  onChange={(e) => updateEditField("series", e.target.value)}
                />
              </Form.Item>
              <Form.Item label={text.customTonies.fields.episodePlural}>
                <Input
                  value={data.episodes}
                  onChange={(e) => updateEditField("episodes", e.target.value)}
                />
              </Form.Item>
              <Form.Item label={text.customTonies.fields.model}>
                <Input
                  value={data.model}
                  onChange={(e) => updateEditField("model", e.target.value)}
                />
              </Form.Item>
              <Form.Item label={text.common.language}>
                <Select
                  value={data.language}
                  onChange={(val) => updateEditField("language", val)}
                  options={metadataLanguageOptions}
                />
              </Form.Item>
              <Form.Item label={text.common.category}>
                <Select
                  value={data.category}
                  onChange={(val) => updateEditField("category", val)}
                  options={categoryOptions}
                />
              </Form.Item>
              <Form.Item label={text.customTonies.fields.no}>
                <Input
                  value={data.no}
                  onChange={(e) => updateEditField("no", e.target.value)}
                />
              </Form.Item>
              <Form.Item label={text.customTonies.fields.release}>
                <Input
                  value={data.release}
                  onChange={(e) => updateEditField("release", e.target.value)}
                />
              </Form.Item>
            </div>

            <Form.Item label={text.customTonies.fields.picture}>
              <Input
                value={data.pic}
                onChange={(e) => updateEditField("pic", e.target.value)}
                placeholder={text.customTonies.placeholders.picture}
              />
            </Form.Item>

            <Divider titlePlacement="left" plain>{text.customTonies.fields.audioIds}</Divider>
            {data.audio_id.map((aid, i) => (
              <Space key={i} style={{ marginBottom: 4, width: "100%" }}>
                <Input
                  value={aid}
                  onChange={(e) => updateArrayField("audio_id", i, e.target.value)}
                  style={{ width: 220 }}
                />
                <Button
                  size="small"
                  danger
                  icon={<MinusCircleOutlined />}
                  onClick={() => removeArrayItem("audio_id", i)}
                />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />} onClick={() => addArrayItem("audio_id")}>
              {text.customTonies.buttons.addAudioId}
            </Button>

            <Divider titlePlacement="left" plain>{text.customTonies.fields.hashes}</Divider>
            {data.hash.map((h, i) => (
              <Space key={i} style={{ marginBottom: 4, width: "100%" }}>
                <Input
                  value={h}
                  onChange={(e) => updateArrayField("hash", i, e.target.value)}
                  style={{ width: 400 }}
                />
                <Button
                  size="small"
                  danger
                  icon={<MinusCircleOutlined />}
                  onClick={() => removeArrayItem("hash", i)}
                />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />} onClick={() => addArrayItem("hash")}>
              {text.customTonies.buttons.addHash}
            </Button>

            <Divider titlePlacement="left" plain>{text.customTonies.fields.tracks}</Divider>
            {data.tracks.map((track, i) => (
              <Space key={i} style={{ marginBottom: 4, width: "100%" }}>
                <Tag>{i + 1}</Tag>
                <Input
                  value={track}
                  onChange={(e) => updateTrack(i, e.target.value)}
                  style={{ flex: 1, width: 300 }}
                />
                <Button
                  size="small"
                  danger
                  icon={<MinusCircleOutlined />}
                  onClick={() => removeTrack(i)}
                />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />} onClick={addTrack}>
              {text.customTonies.buttons.addTrack}
            </Button>
          </Form>
        ) : (
          <Collapse
            ghost
            size="small"
            items={[
              {
                key: "details",
                label: (
                  <Space>
                    <Text type="secondary">
                      {entry.tracks?.length ?? 0} {text.common.tracks}
                    </Text>
                    {entry.language && <Tag>{entry.language}</Tag>}
                    {entry.category && <Tag>{entry.category}</Tag>}
                  </Space>
                ),
                children: (
                  <Space direction="vertical" size="small" style={{ width: "100%" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <Text type="secondary">
                        {text.customTonies.fields.episodePlural}: {safeEpisodes || "-"}
                      </Text>
                      <Text type="secondary">
                        {text.customTonies.fields.model}: {entry.model || "-"}
                      </Text>
                      <Text type="secondary">
                        {text.customTonies.fields.no}: {entry.no ?? "-"}
                      </Text>
                      <Text type="secondary">
                        {text.customTonies.fields.releaseLabel}: {entry.release
                          ? new Date(Number(entry.release) * 1000).toLocaleDateString(locale)
                          : "-"}
                      </Text>
                    </div>
                    {Array.isArray(entry.hash) && entry.hash.length > 0 && (
                      <Text type="secondary" style={{ fontSize: 11, wordBreak: "break-all" }}>
                        SHA1: {entry.hash.join(", ")}
                      </Text>
                    )}
                    {entry.pic && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {text.customTonies.fields.image}: {entry.pic}
                      </Text>
                    )}
                    {entry.tracks && entry.tracks.length > 0 && (
                      <>
                        <Divider plain style={{ margin: "8px 0" }}>{text.common.tracks}</Divider>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {entry.tracks.map((t, i) => (
                            <Tag key={i}>{i + 1}. {t}</Tag>
                          ))}
                        </div>
                      </>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
    );
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Title level={4} style={{ margin: 0 }}>{text.customTonies.title}</Title>
        <Space>
          <Button icon={<SafetyCertificateOutlined />} onClick={runValidation}>
            {text.customTonies.buttons.validate}
          </Button>
          <Button icon={<PlusOutlined />} onClick={startNew}>
            {text.customTonies.buttons.newEntry}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadEntries} loading={loading}>
            {text.customTonies.buttons.reload}
          </Button>
        </Space>
      </div>

      <Input
        prefix={<SearchOutlined />}
        placeholder={text.customTonies.placeholders.search}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        allowClear
      />

      {error && <Alert type="error" message={error} closable onClose={() => setError("")} />}

      {validationResult && (
        <Card size="small" title={text.customTonies.validation.title}>
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            <div style={{ display: "flex", gap: 16 }}>
              <Tag>{text.customTonies.validation.official(validationResult.official_count)}</Tag>
              <Tag>{text.customTonies.validation.custom(validationResult.custom_count)}</Tag>
              <Tag color={validationResult.status === "ok" ? "green" : "orange"}>
                {validationResult.status === "ok" ? text.customTonies.validation.ok : text.customTonies.validation.warnings}
              </Tag>
            </div>

            {validationResult.conflicts.length > 0 && (
              <Alert
                type="warning"
                message={text.customTonies.validation.audioIdCollisions(validationResult.conflicts.length)}
                description={
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {validationResult.conflicts.map((c, i) => (
                      <li key={i}>
                        {text.customTonies.validation.audioIdCollisionItem(
                          c.audio_id,
                          c.custom_title.join(", "),
                          c.official_title.join(", ")
                        )}
                      </li>
                    ))}
                  </ul>
                }
              />
            )}

            {validationResult.custom_duplicates.length > 0 && (
              <Alert
                type="warning"
                message={text.customTonies.validation.duplicates(validationResult.custom_duplicates.length)}
                description={
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {validationResult.custom_duplicates.map((d, i) => (
                      <li key={i}>
                        {text.customTonies.validation.duplicateItem(d.audio_id, d.titles.join(", "))}
                      </li>
                    ))}
                  </ul>
                }
              />
            )}

            {validationResult.hash_conflicts.length > 0 && (
              <Alert
                type="warning"
                message={text.customTonies.validation.hashCollisions(validationResult.hash_conflicts.length)}
                description={
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {validationResult.hash_conflicts.map((h, i) => (
                      <li key={i}>
                        {text.customTonies.validation.hashCollisionItem(
                          h.hash,
                          h.custom_title,
                          h.official_title
                        )}
                      </li>
                    ))}
                  </ul>
                }
              />
            )}
          </Space>
        </Card>
      )}

      {isNew && editingKey === "__new__" && (
        <Card
          size="small"
          title={text.customTonies.cards.newEntry}
          extra={
            <Space>
              <Button size="small" icon={<SaveOutlined />} type="primary" onClick={saveEdit}>
                {text.customTonies.buttons.save}
              </Button>
              <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>
                {text.customTonies.buttons.cancel}
              </Button>
            </Space>
          }
        >
          <Form layout="vertical" size="small">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Form.Item label={text.common.title} required>
                <Input
                  value={editData.title}
                  onChange={(e) => updateEditField("title", e.target.value)}
                />
              </Form.Item>
              <Form.Item label={text.common.series}>
                <Input
                  value={editData.series}
                  onChange={(e) => updateEditField("series", e.target.value)}
                />
              </Form.Item>
            </div>

            <Divider titlePlacement="left" plain>{text.customTonies.fields.audioIds}</Divider>
            {editData.audio_id.map((aid, i) => (
              <Space key={i} style={{ marginBottom: 4 }}>
                <Input
                  value={aid}
                  onChange={(e) => updateArrayField("audio_id", i, e.target.value)}
                  style={{ width: 220 }}
                />
                <Button
                  size="small"
                  danger
                  icon={<MinusCircleOutlined />}
                  onClick={() => removeArrayItem("audio_id", i)}
                />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />} onClick={() => addArrayItem("audio_id")}>
              {text.customTonies.buttons.addAudioId}
            </Button>

            <Divider titlePlacement="left" plain>{text.customTonies.fields.tracks}</Divider>
            {editData.tracks.map((track, i) => (
              <Space key={i} style={{ marginBottom: 4 }}>
                <Tag>{i + 1}</Tag>
                <Input
                  value={track}
                  onChange={(e) => updateTrack(i, e.target.value)}
                  style={{ width: 300 }}
                />
                <Button
                  size="small"
                  danger
                  icon={<MinusCircleOutlined />}
                  onClick={() => removeTrack(i)}
                />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />} onClick={addTrack}>
              {text.customTonies.buttons.addTrack}
            </Button>
          </Form>
        </Card>
      )}

      {entries.length === 0 && !loading && !isNew && (
        <Empty description={text.customTonies.empty} />
      )}

      {entries
        .filter((entry) => {
          if (!searchQuery) return true;
          const q = searchQuery.toLowerCase();
          const audioIds = Array.isArray(entry.audio_id) ? entry.audio_id.join(" ") : String(entry.audio_id || "");
          const title = sanitizeMetadataText(entry.title);
          const series = sanitizeMetadataText(entry.series);
          const episodes = sanitizeMetadataText(
            typeof entry.episodes === "string" ? entry.episodes : JSON.stringify(entry.episodes || "")
          );
          return (
            title.toLowerCase().includes(q) ||
            series.toLowerCase().includes(q) ||
            episodes.toLowerCase().includes(q) ||
            audioIds.toLowerCase().includes(q)
          );
        })
        .map(renderEntryCard)}
    </Space>
  );
};

export default CustomToniesEditor;
