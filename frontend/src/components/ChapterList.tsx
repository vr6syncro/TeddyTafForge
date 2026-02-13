import { Button, Card, Input, Upload, Space, Typography } from "antd";
import { PlusOutlined, DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import type { ChapterData, InputMode } from "../types";

const { Text } = Typography;

interface Props {
  chapters: ChapterData[];
  inputMode: InputMode;
  disableAddRemove?: boolean;
  onChange: (chapters: ChapterData[]) => void;
}

let nextId = 1;
const generateId = () => `ch-${nextId++}`;

export const createEmptyChapter = (): ChapterData => ({
  id: generateId(),
  title: "",
  sourceType: "upload",
  youtubeUrl: "",
});

const isTimestampMode = (mode: InputMode): boolean =>
  mode === "splitter" || mode === "yt-single" || mode === "yt-splitter" || mode === "yt-auto" || mode === "yt-multi";

const ChapterList = ({ chapters, inputMode, disableAddRemove = false, onChange }: Props) => {
  const updateChapter = (id: string, patch: Partial<ChapterData>) => {
    onChange(chapters.map((ch) => (ch.id === id ? { ...ch, ...patch } : ch)));
  };

  const removeChapter = (id: string) => {
    if (disableAddRemove || chapters.length <= 1) return;
    onChange(chapters.filter((ch) => ch.id !== id));
  };

  const addChapter = () => {
    if (disableAddRemove) return;
    onChange([...chapters, createEmptyChapter()]);
  };

  return (
    <div>
      {chapters.map((chapter, index) => (
        <Card
          key={chapter.id}
          size="small"
          title={`Kapitel ${index + 1}`}
          style={{ marginBottom: 12 }}
          extra={
            !disableAddRemove && chapters.length > 1 ? (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeChapter(chapter.id)}
              />
            ) : null
          }
        >
          <Space direction="vertical" style={{ width: "100%" }}>
            <Input
              placeholder="Kapitelname (optional)"
              value={chapter.title}
              onChange={(e) => updateChapter(chapter.id, { title: e.target.value })}
            />

            {inputMode === "files" ? (
              <Upload
                beforeUpload={(file) => {
                  updateChapter(chapter.id, { sourceFile: file, sourceType: "upload" });
                  return false;
                }}
                maxCount={1}
                accept="audio/*"
              >
                <Button icon={<UploadOutlined />}>
                  {chapter.sourceFile ? chapter.sourceFile.name : "Audio-Datei waehlen"}
                </Button>
              </Upload>
            ) : null}

            {inputMode === "yt-multi" && (
              <Input
                placeholder="YouTube-Link"
                value={chapter.youtubeUrl ?? ""}
                onChange={(e) =>
                  updateChapter(chapter.id, {
                    youtubeUrl: e.target.value,
                    sourceType: "youtube",
                  })
                }
              />
            )}

            {isTimestampMode(inputMode) && (
              <Space>
                <Text>Start:</Text>
                <Input
                  placeholder="00:00:00"
                  value={chapter.startTime ?? ""}
                  onChange={(e) => updateChapter(chapter.id, { startTime: e.target.value })}
                  style={{ width: 120 }}
                />
                <Text>Ende:</Text>
                <Input
                  placeholder="01:23:45"
                  value={chapter.endTime ?? ""}
                  onChange={(e) => updateChapter(chapter.id, { endTime: e.target.value })}
                  style={{ width: 120 }}
                />
              </Space>
            )}

            {inputMode === "yt-multi" && chapter.sourceFileName && (
              <Text type="secondary">Geladen: {chapter.sourceFileName}</Text>
            )}

          </Space>
        </Card>
      ))}

      {!disableAddRemove && (
        <Button type="dashed" onClick={addChapter} block icon={<PlusOutlined />}>
          Kapitel hinzufuegen
        </Button>
      )}
    </div>
  );
};

export default ChapterList;
