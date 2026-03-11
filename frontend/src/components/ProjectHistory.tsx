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
import { useUiI18n } from "../uiI18n";
import ProjectEditor from "./ProjectEditor";

const { Title, Text } = Typography;

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const formatDate = (ts: string | number, locale: string): string => {
  if (!ts) return "-";
  const d = new Date(typeof ts === "number" ? ts * 1000 : ts);
  return d.toLocaleDateString(locale, {
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
  const { text, locale } = useUiI18n();
  const toolbarStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap" as const,
  };
  const importGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 12,
  } as const;
  const projectMetaGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  } as const;
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
      setError(err instanceof Error ? err.message : text.projectHistory.errors.load);
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
            ? text.projectHistory.messages.deletedWithCustom(result.removed_custom)
            : text.projectHistory.messages.deletedWithoutCustomMatch
        );
      } else {
        message.success(text.projectHistory.messages.deleted);
      }
      setDeleteModalOpen(false);
      setDeleteTarget(null);
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : text.projectHistory.errors.delete);
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
      message.success(text.projectHistory.messages.zipImported(res.title));
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : text.projectHistory.errors.zipImport);
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
      message.success(text.projectHistory.messages.tafImported(res.title));
      setTafTitle("");
      setTafSeries("");
      setTafEpisodes("");
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : text.projectHistory.errors.tafImport);
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
      const customText = res.merged_custom_json ? text.projectHistory.messages.customMerged : "";
      const skippedText = res.skipped_count > 0 ? text.projectHistory.messages.skippedExisting(res.skipped_count) : "";
      message.success(text.projectHistory.messages.backupImported(res.imported_count, skippedText, customText));
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : text.projectHistory.errors.backupImport);
    } finally {
      setImportBackupBusy(false);
    }
    return false;
  };

  const handleBackupExport = async () => {
    if (!selectedProjects.length) {
      message.warning(text.projectHistory.messages.selectProjectWarning);
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
      message.success(text.projectHistory.messages.backupCreated(selectedProjects.length));
      setActiveTab("imports");
    } catch (err) {
      setError(err instanceof Error ? err.message : text.projectHistory.errors.backupExport);
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
      <div style={toolbarStyle}>
        <Title level={4} style={{ margin: 0 }}>{text.projectHistory.title}</Title>
        <Space wrap>
          <Button onClick={loadProjects} loading={loading}>{text.common.refresh}</Button>
        </Space>
      </div>

      {error && <Alert type="error" message={error} closable onClose={() => setError("")} />}

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "library",
            label: text.projectHistory.tabs.library,
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Card>
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
                      <Text>
                        {text.projectHistory.fields.selection(selectedCount, projects.length)}
                      </Text>
                      <Space wrap>
                        <Checkbox
                          checked={allSelected}
                          onChange={(e) =>
                            setSelected(e.target.checked ? projects.map((p) => p.name) : [])
                          }
                        >{text.projectHistory.fields.selectAll}</Checkbox>
                        <Button onClick={() => setSelected([])}>{text.projectHistory.buttons.clearSelection}</Button>
                      </Space>
                    </Space>

                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Checkbox
                        checked={backupIncludeCustom}
                        onChange={(e) => setBackupIncludeCustom(e.target.checked)}
                      >
                        {text.projectHistory.fields.includeCustomJson}
                      </Checkbox>
                      <Input.Password
                        placeholder={text.projectHistory.fields.backupPasswordPlaceholder}
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
                        {text.projectHistory.buttons.exportBackup}
                      </Button>
                    </Space>
                  </Space>
                </Card>

                {projects.length === 0 && !loading && <Empty description={text.projectHistory.empty.noProjects} />}

                {projects.map((project) => {
                  const checked = selected.includes(project.name);
                  return (
                    <Card
                      key={project.name}
                      title={
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
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
                          <span style={{ wordBreak: "break-word" }}>{project.title}</span>
                          {project.series && <Tag>{project.series}</Tag>}
                        </div>
                      }
                      extra={
                        <Space wrap>
                          <Button
                            size="small"
                            icon={<DownloadOutlined />}
                            type="link"
                            href={api.exportZipUrl(encodeURIComponent(project.name))}
                          >
                            {text.projectHistory.buttons.zip}
                          </Button>
                          {project.has_label && (
                            <Button
                              size="small"
                              icon={<FileTextOutlined />}
                              type="link"
                              href={api.labelPreviewUrl(encodeURIComponent(project.name))}
                              target="_blank"
                            >
                              {text.projectHistory.buttons.label}
                            </Button>
                          )}
                          <Button
                            size="small"
                            type="link"
                            href={api.projectTafDiagnosticsUrl(encodeURIComponent(project.name))}
                            target="_blank"
                          >
                            {text.projectHistory.buttons.diagnostics}
                          </Button>
                          <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => setEditingProject(project)}
                          >
                            {text.common.edit}
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
                        <div style={projectMetaGridStyle}>
                          <Text type="secondary">{text.projectHistory.project.audioId}: <Tag>{project.audio_id || "-"}</Tag></Text>
                          <Text type="secondary">{text.projectHistory.project.size}: {formatBytes(project.size_bytes)}</Text>
                          <Text type="secondary">{text.projectHistory.project.created}: {formatDate(project.created, locale)}</Text>
                          <Text type="secondary">{text.projectHistory.project.chapters}: {project.chapters?.length ?? 0}</Text>
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
            label: text.projectHistory.tabs.imports,
            children: (
              <Card title={text.projectHistory.cards.importRestore}>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Checkbox
                    checked={importCreateCustom}
                    onChange={(e) => setImportCreateCustom(e.target.checked)}
                  >
                    {text.projectHistory.fields.importCreateCustom}
                  </Checkbox>

                  <div style={importGridStyle}>
                    <Card size="small" title={text.projectHistory.cards.backupImport}>
                      <Space direction="vertical" style={{ width: "100%" }}>
                        <Checkbox
                          checked={importBackupCustomJson}
                          onChange={(e) => setImportBackupCustomJson(e.target.checked)}
                        >
                          {text.projectHistory.fields.importBackupCustomJson}
                        </Checkbox>
                        <Input.Password
                          placeholder={text.projectHistory.fields.importPasswordPlaceholder}
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
                            {text.projectHistory.buttons.selectBackupZip}
                          </Button>
                        </Upload>
                      </Space>
                    </Card>

                    <Card size="small" title={text.projectHistory.cards.zipImport}>
                      <Upload
                        beforeUpload={handleZipImport}
                        showUploadList={false}
                        accept=".zip,application/zip"
                        disabled={importZipBusy}
                      >
                        <Button icon={<InboxOutlined />} loading={importZipBusy} block>
                          {text.projectHistory.buttons.selectZip}
                        </Button>
                      </Upload>
                    </Card>
                  </div>

                  <Card size="small" title={text.projectHistory.cards.tafImport}>
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Input
                        placeholder={text.projectHistory.fields.tafTitlePlaceholder}
                        value={tafTitle}
                        onChange={(e) => setTafTitle(e.target.value)}
                      />
                      <Input
                        placeholder={text.projectHistory.fields.tafSeriesPlaceholder}
                        value={tafSeries}
                        onChange={(e) => setTafSeries(e.target.value)}
                      />
                      <Input
                        placeholder={text.projectHistory.fields.tafEpisodePlaceholder}
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
                          {text.projectHistory.buttons.selectTaf}
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
        title={text.projectHistory.deleteModal.title}
        open={deleteModalOpen}
        onCancel={() => {
          setDeleteModalOpen(false);
          setDeleteTarget(null);
        }}
        onOk={() => deleteTarget && void deleteProject(deleteTarget)}
        okText={text.projectHistory.deleteModal.confirm}
        okButtonProps={{ danger: true }}
      >
        <Space direction="vertical">
          <Text>
            {text.projectHistory.deleteModal.message(deleteTarget?.title || deleteTarget?.name || "")}
          </Text>
          <Checkbox
            checked={deleteWithCustom}
            onChange={(e) => setDeleteWithCustom(e.target.checked)}
          >
            {text.projectHistory.deleteModal.removeCustom}
          </Checkbox>
          <Checkbox
            checked={deleteByTitle}
            onChange={(e) => setDeleteByTitle(e.target.checked)}
            disabled={!deleteWithCustom}
          >
            {text.projectHistory.deleteModal.removeByTitle}
          </Checkbox>
        </Space>
      </Modal>

    </Space>
  );
};

export default ProjectHistory;
