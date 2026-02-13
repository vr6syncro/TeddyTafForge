export interface ChapterData {
  id: string;
  title: string;
  sourceType: "upload" | "filesystem" | "youtube";
  sourceFile?: File;
  sourcePath?: string;
  sourceFileName?: string;
  youtubeUrl?: string;
  startTime?: string;
  endTime?: string;
}

export type InputMode =
  | "files"
  | "splitter"
  | "yt-single"
  | "yt-splitter"
  | "yt-auto"
  | "yt-multi";

export interface BuildFormData {
  title: string;
  series: string;
  episodes: string;
  language: string;
  category: string;
  inputMode: InputMode;
  chapters: ChapterData[];
  coverImage?: File;
  bitrate: number;
  createCustomEntry: boolean;
  generateLabel: boolean;
}
