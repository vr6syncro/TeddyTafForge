import { Button, Card, Input, Upload, Space, Typography } from "antd";
import { PlusOutlined, DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import type { ChapterData, InputMode } from "../types";
import { useUiI18n } from "../uiI18n";

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
  const { text } = useUiI18n();
  const timestampGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 8,
    width: "100%",
  } as const;

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
          title={text.chapterList.title(index + 1)}
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
              placeholder={text.chapterList.chapterNamePlaceholder}
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
                  {chapter.sourceFile ? chapter.sourceFile.name : text.chapterList.chooseAudio}
                </Button>
              </Upload>
            ) : null}

            {inputMode === "yt-multi" && (
              <Input
                placeholder={text.chapterList.youtubeLinkPlaceholder}
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
              <div style={timestampGridStyle}>
                <div>
                  <Text>{text.chapterList.start}</Text>
                  <Input
                    placeholder={text.chapterList.startPlaceholder}
                    value={chapter.startTime ?? ""}
                    onChange={(e) => updateChapter(chapter.id, { startTime: e.target.value })}
                  />
                </div>
                <div>
                  <Text>{text.chapterList.end}</Text>
                  <Input
                    placeholder={text.chapterList.endPlaceholder}
                    value={chapter.endTime ?? ""}
                    onChange={(e) => updateChapter(chapter.id, { endTime: e.target.value })}
                  />
                </div>
              </div>
            )}

            {inputMode === "yt-multi" && chapter.sourceFileName && (
              <Text type="secondary">{text.chapterList.loaded(chapter.sourceFileName)}</Text>
            )}

          </Space>
        </Card>
      ))}

      {!disableAddRemove && (
        <Button type="dashed" onClick={addChapter} block icon={<PlusOutlined />}>
          {text.chapterList.addChapter}
        </Button>
      )}
    </div>
  );
};

export default ChapterList;
