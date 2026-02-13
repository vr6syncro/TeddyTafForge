import { useEffect, useMemo, useState } from "react";
import {
  Card,
  Button,
  Space,
  Typography,
  Modal,
  Alert,
  Tag,
  Empty,
  Upload,
  Checkbox,
  Input,
  Tabs,
  message,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOutlined,
  InboxOutlined,
  UploadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { api } from "../api";
import type { ProjectInfo } from "../api";
import ProjectEditor from "./ProjectEditor";

const { Title, Text } = Typography;

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const formatDate = (ts: string | number): string => {
  if (!ts) return "-";
  const d = new Date(typeof ts === "number" ? ts * 1000 : ts);
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const ProjectHistory = () => {
  const [activeTab, setActiveTab] = useState("library");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectInfo | null>(null);
  const [deleteWithCustom, setDeleteWithCustom] = useState(true);
  const [deleteByTitle, setDeleteByTitle] = useState(true);

  const [editingProject, setEditingProject] = useState<ProjectInfo | null>(null);

  const [importZipBusy, setImportZipBusy] = useState(false);
  const [importTafBusy, setImportTafBusy] = useState(false);
  const [importBackupBusy, setImportBackupBusy] = useState(false);
  const [importCreateCustom, setImportCreateCustom] = useState(true);
  const [importBackupCustomJson, setImportBackupCustomJson] = useState(true);
  const [tafTitle, setTafTitle] = useState("");
  const [tafSeries, setTafSeries] = useState("");
  const [tafEpisodes, setTafEpisodes] = useState("");

  const [selected, setSelected] = useState<string[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupIncludeCustom, setBackupIncludeCustom] = useState(true);
  const [backupPassword, setBackupPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");

  const selectedCount = selected.length;
  const selectedProjects = useMemo(() => {
    const set = new Set(selected);
    return projects.filter((p) => set.has(p.name));
  }, [projects, selected]);

  const loadProjects = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.getProjects();
      setProjects(result.projects);
      setSelected((prev) => prev.filter((id) => result.projects.some((p) => p.name === id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  const deleteProject = async (project: ProjectInfo) => {
    try {
      const result = await api.deleteProject(project.name, {
        remove_custom: deleteWithCustom,
        remove_by_title: deleteByTitle,
      });
      if (deleteWithCustom) {
        message.success(
          result.removed_custom > 0
            ? `Projekt geloescht, ${result.removed_custom} Custom-Eintrag(e) entfernt`
            : "Projekt geloescht, kein passender Custom-Eintrag gefunden"
        );
      } else {
        message.success("Projekt geloescht");
      }
      setDeleteModalOpen(false);
      setDeleteTarget(null);
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Loeschen");
    }
  };

  const openDeleteModal = (project: ProjectInfo) => {
    setDeleteTarget(project);
    setDeleteWithCustom(true);
    setDeleteByTitle(true);
    setDeleteModalOpen(true);
  };

  const handleZipImport = async (file: File) => {
    setImportZipBusy(true);
    setError("");
    try {
      const res = await api.importZip(file, importCreateCustom);
      message.success(`ZIP importiert: ${res.title}`);
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ZIP-Import fehlgeschlagen");
    } finally {
      setImportZipBusy(false);
    }
    return false;
  };

  const handleTafImport = async (file: File) => {
    setImportTafBusy(true);
    setError("");
    try {
      const res = await api.importTaf({
        file,
        title: tafTitle,
        series: tafSeries,
        episodes: tafEpisodes,
        createCustomEntry: importCreateCustom,
      });
      message.success(`TAF importiert: ${res.title}`);
      setTafTitle("");
      setTafSeries("");
      setTafEpisodes("");
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "TAF-Import fehlgeschlagen");
    } finally {
      setImportTafBusy(false);
    }
    return false;
  };

  const handleBackupImport = async (file: File) => {
    setImportBackupBusy(true);
    setError("");
    try {
      const res = await api.importBackup({
        file,
        createCustomEntry: importCreateCustom,
        importCustomJson: importBackupCustomJson,
        password: importPassword,
      });
      const customText = res.merged_custom_json ? " + custom.json gemerged" : "";
      const skippedText = res.skipped_count > 0 ? `, ${res.skipped_count} uebersprungen (bereits vorhanden)` : "";
      message.success(`Backup importiert: ${res.imported_count} Projekt(e)${skippedText}${customText}`);
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup-Import fehlgeschlagen");
    } finally {
      setImportBackupBusy(false);
    }
    return false;
  };

  const handleBackupExport = async () => {
    if (!selectedProjects.length) {
      message.warning("Bitte mindestens ein Projekt auswaehlen");
      return;
    }
    setBackupBusy(true);
    setError("");
    try {
      const res = await api.exportBackup({
        projectNames: selectedProjects.map((p) => p.name),
        includeCustomJson: backupIncludeCustom,
        password: backupPassword,
      });
      triggerDownload(res.blob, res.filename);
      message.success(`Backup erstellt: ${selectedProjects.length} Projekt(e)`);
      setActiveTab("imports");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup-Export fehlgeschlagen");
    } finally {
      setBackupBusy(false);
    }
  };

  const allSelected = projects.length > 0 && selected.length === projects.length;

  if (editingProject) {
    return (
      <ProjectEditor
        project={editingProject}
        onBack={() => {
          setEditingProject(null);
          void loadProjects();
        }}
      />
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Title level={4} style={{ margin: 0 }}>Bibliothek</Title>
        <Space>
          <Button onClick={loadProjects} loading={loading}>Aktualisieren</Button>
        </Space>
      </div>

      {error && <Alert type="error" message={error} closable onClose={() => setError("")} />}

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "library",
            label: "Bibliothek",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Card>
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Space style={{ width: "100%", justifyContent: "space-between" }}>
                      <Text>
                        Auswahl: <Tag>{selectedCount}</Tag> von <Tag>{projects.length}</Tag>
                      </Text>
                      <Space>
                        <Checkbox
                          checked={allSelected}
                          onChange={(e) =>
                            setSelected(e.target.checked ? projects.map((p) => p.name) : [])
                          }
                        >
                          Alle
                        </Checkbox>
                        <Button onClick={() => setSelected([])}>Auswahl leeren</Button>
                      </Space>
                    </Space>

                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Checkbox
                        checked={backupIncludeCustom}
                        onChange={(e) => setBackupIncludeCustom(e.target.checked)}
                      >
                        Beim Backup `tonies.custom.json` mit aufnehmen
                      </Checkbox>
                      <Input.Password
                        placeholder="Backup-Passwort (optional, fuer Import-Pruefung)"
                        value={backupPassword}
                        onChange={(e) => setBackupPassword(e.target.value)}
                      />
                      <Button
                        type="primary"
                        icon={<SaveOutlined />}
                        loading={backupBusy}
                        onClick={handleBackupExport}
                        disabled={selectedCount === 0}
                      >
                        Auswahl als Backup-ZIP exportieren
                      </Button>
                    </Space>
                  </Space>
                </Card>

                {projects.length === 0 && !loading && <Empty description="Noch keine Projekte" />}

                {projects.map((project) => {
                  const checked = selected.includes(project.name);
                  return (
                    <Card
                      key={project.name}
                      title={
                        <Space>
                          <Checkbox
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelected((prev) => Array.from(new Set([...prev, project.name])));
                              } else {
                                setSelected((prev) => prev.filter((id) => id !== project.name));
                              }
                            }}
                          />
                          <FolderOutlined />
                          <span>{project.title}</span>
                          {project.series && <Tag>{project.series}</Tag>}
                        </Space>
                      }
                      extra={
                        <Space>
                          <Button
                            size="small"
                            icon={<DownloadOutlined />}
                            type="link"
                            href={api.exportZipUrl(encodeURIComponent(project.name))}
                          >
                            ZIP
                          </Button>
                          {project.has_label && (
                            <Button
                              size="small"
                              icon={<FileTextOutlined />}
                              type="link"
                              href={api.labelPreviewUrl(encodeURIComponent(project.name))}
                              target="_blank"
                            >
                              Label
                            </Button>
                          )}
                          <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => setEditingProject(project)}
                          >
                            Bearbeiten
                          </Button>
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => openDeleteModal(project)}
                          />
                        </Space>
                      }
                    >
                      <Space direction="vertical" size="small" style={{ width: "100%" }}>
                        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                          <Text type="secondary">Audio-ID: <Tag>{project.audio_id || "-"}</Tag></Text>
                          <Text type="secondary">Groesse: {formatBytes(project.size_bytes)}</Text>
                          <Text type="secondary">Erstellt: {formatDate(project.created)}</Text>
                          <Text type="secondary">Kapitel: {project.chapters?.length ?? 0}</Text>
                        </div>
                        {project.chapters && project.chapters.length > 0 && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {project.chapters.map((ch, i) => (
                              <Tag key={i}>{ch.title}</Tag>
                            ))}
                          </div>
                        )}
                      </Space>
                    </Card>
                  );
                })}
              </Space>
            ),
          },
          {
            key: "imports",
            label: "Import/Backup",
            children: (
              <Card title="Import & Restore">
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Checkbox
                    checked={importCreateCustom}
                    onChange={(e) => setImportCreateCustom(e.target.checked)}
                  >
                    Import auch in `tonies.custom.json` einpflegen
                  </Checkbox>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Card size="small" title="Backup-Import (mehrere Projekte)">
                      <Space direction="vertical" style={{ width: "100%" }}>
                        <Checkbox
                          checked={importBackupCustomJson}
                          onChange={(e) => setImportBackupCustomJson(e.target.checked)}
                        >
                          `tonies.custom.json` aus Backup mergen
                        </Checkbox>
                        <Input.Password
                          placeholder="Backup-Passwort (falls gesetzt)"
                          value={importPassword}
                          onChange={(e) => setImportPassword(e.target.value)}
                        />
                        <Upload
                          beforeUpload={handleBackupImport}
                          showUploadList={false}
                          accept=".zip,application/zip"
                          disabled={importBackupBusy}
                        >
                          <Button icon={<InboxOutlined />} loading={importBackupBusy} block>
                            Backup-ZIP auswaehlen
                          </Button>
                        </Upload>
                      </Space>
                    </Card>

                    <Card size="small" title="ZIP-Import (ein Projekt)">
                      <Upload
                        beforeUpload={handleZipImport}
                        showUploadList={false}
                        accept=".zip,application/zip"
                        disabled={importZipBusy}
                      >
                        <Button icon={<InboxOutlined />} loading={importZipBusy} block>
                          ZIP auswaehlen
                        </Button>
                      </Upload>
                    </Card>
                  </div>

                  <Card size="small" title="TAF-Import (einzelne Datei)">
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Input
                        placeholder="Titel (optional)"
                        value={tafTitle}
                        onChange={(e) => setTafTitle(e.target.value)}
                      />
                      <Input
                        placeholder="Serie (optional)"
                        value={tafSeries}
                        onChange={(e) => setTafSeries(e.target.value)}
                      />
                      <Input
                        placeholder="Episode (optional)"
                        value={tafEpisodes}
                        onChange={(e) => setTafEpisodes(e.target.value)}
                      />
                      <Upload
                        beforeUpload={handleTafImport}
                        showUploadList={false}
                        accept=".taf"
                        disabled={importTafBusy}
                      >
                        <Button icon={<UploadOutlined />} loading={importTafBusy} block>
                          TAF auswaehlen
                        </Button>
                      </Upload>
                    </Space>
                  </Card>
                </Space>
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title="Projekt loeschen"
        open={deleteModalOpen}
        onCancel={() => {
          setDeleteModalOpen(false);
          setDeleteTarget(null);
        }}
        onOk={() => deleteTarget && void deleteProject(deleteTarget)}
        okText="Loeschen"
        okButtonProps={{ danger: true }}
      >
        <Space direction="vertical">
          <Text>
            Soll das Projekt `{deleteTarget?.title || deleteTarget?.name}` geloescht werden?
          </Text>
          <Checkbox
            checked={deleteWithCustom}
            onChange={(e) => setDeleteWithCustom(e.target.checked)}
          >
            Passende Eintraege in `tonies.custom.json` mit entfernen
          </Checkbox>
          <Checkbox
            checked={deleteByTitle}
            onChange={(e) => setDeleteByTitle(e.target.checked)}
            disabled={!deleteWithCustom}
          >
            Falls Audio-ID fehlt: auch ueber Titel+Serie abgleichen
          </Checkbox>
        </Space>
      </Modal>

    </Space>
  );
};

export default ProjectHistory;
