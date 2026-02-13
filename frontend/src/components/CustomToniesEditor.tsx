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
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
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
      setError(err instanceof Error ? err.message : "Validierung fehlgeschlagen");
    }
  };

  const startEdit = (entry: CustomTonieEntry) => {
    const key = getEntryKey(entry);
    setEditingKey(key);
    setEditData({ ...entry });
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
      setError("Titel ist erforderlich");
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
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    }
  };

  const deleteEntry = async (audioId: string) => {
    try {
      await api.deleteCustomEntry(audioId);
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Loeschen");
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
    updateEditField("tracks", [...editData.tracks, `Track ${editData.tracks.length + 1}`]);
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

    const audioIdDisplay = Array.isArray(entry.audio_id)
      ? entry.audio_id.join(", ")
      : String(entry.audio_id || "-");

    return (
      <Card
        key={key}
        size="small"
        title={
          <Space>
            <Text strong>{entry.title || "Ohne Titel"}</Text>
            {entry.series && <Tag color="blue">{entry.series}</Tag>}
            <Tag>{audioIdDisplay}</Tag>
          </Space>
        }
        extra={
          isEditing ? (
            <Space>
              <Button size="small" icon={<SaveOutlined />} type="primary" onClick={saveEdit}>
                Speichern
              </Button>
              <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>
                Abbrechen
              </Button>
            </Space>
          ) : (
            <Space>
              <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(entry)}>
                Bearbeiten
              </Button>
              <Popconfirm
                title="Eintrag unwiderruflich loeschen?"
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
              <Form.Item label="Titel" required>
                <Input
                  value={data.title}
                  onChange={(e) => updateEditField("title", e.target.value)}
                />
              </Form.Item>
              <Form.Item label="Serie">
                <Input
                  value={data.series}
                  onChange={(e) => updateEditField("series", e.target.value)}
                />
              </Form.Item>
              <Form.Item label="Episoden">
                <Input
                  value={data.episodes}
                  onChange={(e) => updateEditField("episodes", e.target.value)}
                />
              </Form.Item>
              <Form.Item label="Model">
                <Input
                  value={data.model}
                  onChange={(e) => updateEditField("model", e.target.value)}
                />
              </Form.Item>
              <Form.Item label="Sprache">
                <Select
                  value={data.language}
                  onChange={(val) => updateEditField("language", val)}
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
                  value={data.category}
                  onChange={(val) => updateEditField("category", val)}
                  options={[
                    { value: "audio-play", label: "Hoerspiel" },
                    { value: "audio-book", label: "Hoerbuch" },
                    { value: "music", label: "Musik" },
                    { value: "audio-play-songs", label: "Hoerspiel mit Liedern" },
                    { value: "audio-book-songs", label: "Hoerbuch mit Liedern" },
                    { value: "audio-play-educational", label: "Lern-Hoerspiel" },
                    { value: "creative-tonie", label: "Kreativ-Tonie" },
                  ]}
                />
              </Form.Item>
              <Form.Item label="No">
                <Input
                  value={data.no}
                  onChange={(e) => updateEditField("no", e.target.value)}
                />
              </Form.Item>
              <Form.Item label="Release (Unix-Timestamp)">
                <Input
                  value={data.release}
                  onChange={(e) => updateEditField("release", e.target.value)}
                />
              </Form.Item>
            </div>

            <Form.Item label="Bild-URL (pic)">
              <Input
                value={data.pic}
                onChange={(e) => updateEditField("pic", e.target.value)}
                placeholder="/plugins/teddytafforge/covers/bild.jpg"
              />
            </Form.Item>

            <Divider orientation="left" plain>Audio-IDs</Divider>
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
              Audio-ID hinzufuegen
            </Button>

            <Divider orientation="left" plain>SHA1-Hashes</Divider>
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
              Hash hinzufuegen
            </Button>

            <Divider orientation="left" plain>Tracks</Divider>
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
              Track hinzufuegen
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
                      {entry.tracks?.length ?? 0} Tracks
                    </Text>
                    {entry.language && <Tag>{entry.language}</Tag>}
                    {entry.category && <Tag>{entry.category}</Tag>}
                  </Space>
                ),
                children: (
                  <Space direction="vertical" size="small" style={{ width: "100%" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <Text type="secondary">
                        Episoden: {entry.episodes || "-"}
                      </Text>
                      <Text type="secondary">
                        Model: {entry.model || "-"}
                      </Text>
                      <Text type="secondary">
                        No: {entry.no ?? "-"}
                      </Text>
                      <Text type="secondary">
                        Release: {entry.release
                          ? new Date(Number(entry.release) * 1000).toLocaleDateString("de-DE")
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
                        Bild: {entry.pic}
                      </Text>
                    )}
                    {entry.tracks && entry.tracks.length > 0 && (
                      <>
                        <Divider plain style={{ margin: "8px 0" }}>Tracks</Divider>
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
        <Title level={4} style={{ margin: 0 }}>tonies.custom.json</Title>
        <Space>
          <Button icon={<SafetyCertificateOutlined />} onClick={runValidation}>
            Validieren
          </Button>
          <Button icon={<PlusOutlined />} onClick={startNew}>
            Neuer Eintrag
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadEntries} loading={loading}>
            Neu laden
          </Button>
        </Space>
      </div>

      <Input
        prefix={<SearchOutlined />}
        placeholder="Suche nach Titel, Serie oder Audio-ID..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        allowClear
      />

      {error && <Alert type="error" message={error} closable onClose={() => setError("")} />}

      {validationResult && (
        <Card size="small" title="Validierungsergebnis">
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            <div style={{ display: "flex", gap: 16 }}>
              <Tag>Offiziell: {validationResult.official_count} Eintraege</Tag>
              <Tag>Custom: {validationResult.custom_count} Eintraege</Tag>
              <Tag color={validationResult.status === "ok" ? "green" : "orange"}>
                {validationResult.status === "ok" ? "Keine Konflikte" : "Warnungen"}
              </Tag>
            </div>

            {validationResult.conflicts.length > 0 && (
              <Alert
                type="warning"
                message={`${validationResult.conflicts.length} Audio-ID Kollision(en) mit offizieller DB`}
                description={
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {validationResult.conflicts.map((c, i) => (
                      <li key={i}>
                        ID {c.audio_id}: Custom &quot;{c.custom_title.join(", ")}&quot;
                        vs. Offiziell &quot;{c.official_title.join(", ")}&quot;
                      </li>
                    ))}
                  </ul>
                }
              />
            )}

            {validationResult.custom_duplicates.length > 0 && (
              <Alert
                type="warning"
                message={`${validationResult.custom_duplicates.length} Duplikat(e) in tonies.custom.json`}
                description={
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {validationResult.custom_duplicates.map((d, i) => (
                      <li key={i}>
                        ID {d.audio_id}: {d.titles.join(", ")}
                      </li>
                    ))}
                  </ul>
                }
              />
            )}

            {validationResult.hash_conflicts.length > 0 && (
              <Alert
                type="warning"
                message={`${validationResult.hash_conflicts.length} Hash-Kollision(en)`}
                description={
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {validationResult.hash_conflicts.map((h, i) => (
                      <li key={i}>
                        {h.hash}: Custom &quot;{h.custom_title}&quot;
                        vs. Offiziell &quot;{h.official_title}&quot;
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
          title="Neuer Custom Tonie"
          extra={
            <Space>
              <Button size="small" icon={<SaveOutlined />} type="primary" onClick={saveEdit}>
                Speichern
              </Button>
              <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>
                Abbrechen
              </Button>
            </Space>
          }
        >
          <Form layout="vertical" size="small">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Form.Item label="Titel" required>
                <Input
                  value={editData.title}
                  onChange={(e) => updateEditField("title", e.target.value)}
                />
              </Form.Item>
              <Form.Item label="Serie">
                <Input
                  value={editData.series}
                  onChange={(e) => updateEditField("series", e.target.value)}
                />
              </Form.Item>
            </div>

            <Divider orientation="left" plain>Audio-IDs</Divider>
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
              Audio-ID hinzufuegen
            </Button>

            <Divider orientation="left" plain>Tracks</Divider>
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
              Track hinzufuegen
            </Button>
          </Form>
        </Card>
      )}

      {entries.length === 0 && !loading && !isNew && (
        <Empty description="Keine Custom Tonies vorhanden" />
      )}

      {entries
        .filter((entry) => {
          if (!searchQuery) return true;
          const q = searchQuery.toLowerCase();
          const audioIds = Array.isArray(entry.audio_id) ? entry.audio_id.join(" ") : String(entry.audio_id || "");
          const episodes = typeof entry.episodes === "string" ? entry.episodes : JSON.stringify(entry.episodes || "");
          return (
            (entry.title || "").toLowerCase().includes(q) ||
            (entry.series || "").toLowerCase().includes(q) ||
            episodes.toLowerCase().includes(q) ||
            audioIds.toLowerCase().includes(q)
          );
        })
        .map(renderEntryCard)}
    </Space>
  );
};

export default CustomToniesEditor;
