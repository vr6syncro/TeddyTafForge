const BASE = "/api";

interface ApiErrorDetail {
  code?: string;
  message?: string;
  hint?: string;
  debug?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body: { detail?: string | ApiErrorDetail } = await res
      .json()
      .catch(() => ({ detail: res.statusText }));
    const detail = body.detail;

    if (typeof detail === "string") {
      throw new Error(detail || `HTTP ${res.status}`);
    }

    if (detail && typeof detail === "object") {
      const parts: string[] = [];
      if (detail.code) parts.push(`[${detail.code}]`);
      parts.push(detail.message ?? `HTTP ${res.status}`);
      if (detail.hint) parts.push(`Hinweis: ${detail.hint}`);
      if (detail.debug) parts.push(`Debug: ${detail.debug}`);
      throw new Error(parts.join(" "));
    }

    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function postBlob(path: string, body: unknown): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(text || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const utfMatch = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const asciiMatch = cd.match(/filename=\"([^\"]+)\"/i);
  const rawName = utfMatch?.[1] ? decodeURIComponent(utfMatch[1]) : asciiMatch?.[1] || "backup.zip";
  return { blob, filename: rawName };
}

export interface FileEntry {
  name: string;
  type: "dir" | "file";
  path: string;
  size?: number;
  ext?: string;
}

export interface BrowseResult {
  root: string;
  path: string;
  entries: FileEntry[];
}

export interface SearchResult {
  root: string;
  query: string;
  results: FileEntry[];
}

export interface UploadResult {
  project_id: string;
  filename: string;
  path: string;
  size?: number;
  image_type?: string;
}

export interface BuildStatus {
  project_id: string;
  status: string;
  progress: number;
  message: string;
  taf_path: string;
}

export interface CustomTonieEntry {
  no: string;
  model: string;
  audio_id: string[];
  hash: string[];
  title: string;
  series: string;
  episodes: string;
  tracks: string[];
  release: string;
  language: string;
  category: string;
  pic: string;
}

export interface ProjectInfo {
  name: string;
  title: string;
  series: string;
  episodes: string;
  language: string;
  category: string;
  audio_id: string;
  taf_file: string;
  chapters: { title: string }[];
  size_bytes: number;
  created: string;
  has_cover: boolean;
  has_label: boolean;
}

export interface ProjectImportResult {
  status: string;
  project_id: string;
  title: string;
  custom?: { status: string; audio_id?: string };
}

export interface BackupImportResult {
  status: string;
  imported_count: number;
  skipped_count: number;
  projects: { project_id: string; title: string; audio_id: string }[];
  merged_custom_json: boolean;
}

export interface YoutubeChapter {
  title: string;
  start_time: number;
  end_time?: number;
}

export interface YoutubeInfoResult {
  title: string;
  duration: number;
  uploader: string;
  provider?: string;
  thumbnail: string;
  chapters: YoutubeChapter[];
}

export interface YoutubeDownloadResult {
  project_id: string;
  filename: string;
  path: string;
  title: string;
  duration: number;
  uploader: string;
  provider?: string;
  thumbnail: string;
  chapters: YoutubeChapter[];
}

export const api = {
  health: () => request<{ status: string; version: string; debug: boolean }>("/health"),

  browseFiles: (root = "library", path = "") =>
    request<BrowseResult>(`/files/browse?root=${root}&path=${encodeURIComponent(path)}`),

  searchFiles: (root: string, query: string, audioOnly = false) =>
    request<SearchResult>(
      `/files/search?root=${root}&query=${encodeURIComponent(query)}&audio_only=${audioOnly}`
    ),

  uploadAudio: (file: File, projectId?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (projectId) form.append("project_id", projectId);
    return request<UploadResult>("/upload/audio", { method: "POST", body: form });
  },

  uploadImage: (file: File, projectId: string, imageType: "cover" | "track", trackIndex = 0) => {
    const form = new FormData();
    form.append("file", file);
    form.append("project_id", projectId);
    form.append("image_type", imageType);
    form.append("track_index", String(trackIndex));
    return request<UploadResult>("/upload/image", { method: "POST", body: form });
  },

  youtubeInfo: (url: string, projectId?: string) =>
    request<YoutubeInfoResult>("/youtube/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, project_id: projectId ?? "" }),
    }),

  youtubeDownload: (url: string, projectId?: string) =>
    request<YoutubeDownloadResult>("/youtube/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, project_id: projectId ?? "" }),
    }),

  youtubeThumbnail: async (url: string): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${BASE}/youtube/thumbnail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const body: { detail?: string | ApiErrorDetail } = await res
        .json()
        .catch(() => ({ detail: res.statusText }));
      const detail = body.detail;
      if (typeof detail === "string") {
        throw new Error(detail || `HTTP ${res.status}`);
      }
      if (detail && typeof detail === "object") {
        const parts: string[] = [];
        if (detail.code) parts.push(`[${detail.code}]`);
        parts.push(detail.message ?? `HTTP ${res.status}`);
        if (detail.hint) parts.push(`Hinweis: ${detail.hint}`);
        if (detail.debug) parts.push(`Debug: ${detail.debug}`);
        throw new Error(parts.join(" "));
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const utfMatch = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const asciiMatch = cd.match(/filename="([^"]+)"/i);
    const rawName = utfMatch?.[1] ? decodeURIComponent(utfMatch[1]) : asciiMatch?.[1] || "youtube-thumbnail.jpg";
    return { blob, filename: rawName };
  },

  startBuild: (payload: {
    project_id?: string;
    title: string;
    series?: string;
    episodes?: string;
    language?: string;
    category?: string;
    chapters: { title: string; source: string; start_time?: number; end_time?: number }[];
    bitrate?: number;
    create_custom_entry?: boolean;
  }) =>
    request<{ project_id: string; status: string }>("/build/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  buildStatus: (projectId: string) =>
    request<BuildStatus>(`/build/status/${projectId}`),

  getCustomEntries: () =>
    request<{ entries: CustomTonieEntry[] }>("/metadata/custom"),

  updateCustomEntry: (audioId: string, entry: CustomTonieEntry) =>
    request<{ status: string }>(`/metadata/custom/${audioId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }),

  deleteCustomEntry: (audioId: string) =>
    request<{ status: string }>(`/metadata/custom/${audioId}`, { method: "DELETE" }),

  addCustomEntry: (entry: CustomTonieEntry) =>
    request<{ status: string }>("/metadata/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }),

  getProjects: () =>
    request<{ projects: ProjectInfo[] }>("/projects"),

  updateProjectMetadata: (
    name: string,
    data: { title?: string; series?: string; episodes?: string; language?: string; category?: string; chapters?: string[] }
  ) =>
    request<{ status: string; name: string; updates: Record<string, string> }>(
      `/projects/${encodeURIComponent(name)}/metadata`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }
    ),

  projectCoverUrl: (name: string) =>
    `${BASE}/projects/${encodeURIComponent(name)}/cover`,

  deleteProject: (
    name: string,
    opts?: { remove_custom?: boolean; remove_by_title?: boolean }
  ) => {
    const qp = new URLSearchParams();
    if (opts?.remove_custom !== undefined) qp.set("remove_custom", String(opts.remove_custom));
    if (opts?.remove_by_title !== undefined) qp.set("remove_by_title", String(opts.remove_by_title));
    const suffix = qp.toString() ? `?${qp.toString()}` : "";
    return request<{ status: string; removed_custom: number }>(
      `/projects/${encodeURIComponent(name)}${suffix}`,
      { method: "DELETE" }
    );
  },

  importZip: (file: File, createCustomEntry = true) => {
    const form = new FormData();
    form.append("file", file);
    form.append("create_custom_entry", String(createCustomEntry));
    return request<ProjectImportResult>("/projects/import/zip", { method: "POST", body: form });
  },

  exportBackup: (payload: {
    projectNames: string[];
    includeCustomJson?: boolean;
    password?: string;
  }) =>
    postBlob("/projects/backup/export", {
      project_names: payload.projectNames,
      include_custom_json: payload.includeCustomJson ?? true,
      password: payload.password ?? "",
    }),

  importBackup: (payload: {
    file: File;
    createCustomEntry?: boolean;
    importCustomJson?: boolean;
    password?: string;
  }) => {
    const form = new FormData();
    form.append("file", payload.file);
    form.append("create_custom_entry", String(payload.createCustomEntry ?? true));
    form.append("import_custom_json", String(payload.importCustomJson ?? true));
    form.append("password", payload.password ?? "");
    return request<BackupImportResult>("/projects/backup/import", { method: "POST", body: form });
  },

  importTaf: (payload: {
    file: File;
    title?: string;
    series?: string;
    episodes?: string;
    createCustomEntry?: boolean;
  }) => {
    const form = new FormData();
    form.append("file", payload.file);
    form.append("title", payload.title ?? "");
    form.append("series", payload.series ?? "");
    form.append("episodes", payload.episodes ?? "");
    form.append("create_custom_entry", String(payload.createCustomEntry ?? true));
    return request<ProjectImportResult>("/projects/import/taf", { method: "POST", body: form });
  },

  cleanupProjectTemp: (name: string) =>
    request<{ status: string; name: string; removed_temp?: boolean }>(
      `/projects/cleanup-temp/${encodeURIComponent(name)}`,
      { method: "POST" }
    ),

  generateLabel: (payload: {
    project_id: string;
    title: string;
    series?: string;
    text_line1?: string;
    text_line2?: string;
    shape?: string;
    diameter_mm?: number;
    print_mode?: string;
    tracks?: string[];
    show_tracklist?: boolean;
    show_series_on_image?: boolean;
    bg_color?: string;
    font_size?: number;
  }) =>
    fetch(`${BASE}/label/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  exportZipUrl: (projectId: string) => `${BASE}/export/zip/${projectId}`,
  labelPreviewUrl: (projectId: string) => `${BASE}/label/preview/${projectId}`,
  projectTafDiagnosticsUrl: (projectId: string, includePages = false) =>
    `${BASE}/diagnostics/project/${projectId}/taf${includePages ? "?include_pages=true" : ""}`,
  youtubeAudioUrl: (projectId: string, filename: string) =>
    `${BASE}/youtube/audio/${encodeURIComponent(projectId)}/${encodeURIComponent(filename)}`,

  validateDatabases: () =>
    request<{
      official_count: number;
      custom_count: number;
      official_audio_ids: number;
      custom_audio_ids: number;
      conflicts: { audio_id: string; official_title: string[]; custom_title: string[]; type: string }[];
      custom_duplicates: { audio_id: string; titles: string[]; type: string }[];
      hash_conflicts: { hash: string; official_title: string; custom_title: string; type: string }[];
      status: string;
    }>("/metadata/validate"),

  checkAudioId: (audioId: string) =>
    request<{ exists: boolean; source?: string; title?: string; series?: string }>(
      `/metadata/check-audio-id/${audioId}`
    ),
};
