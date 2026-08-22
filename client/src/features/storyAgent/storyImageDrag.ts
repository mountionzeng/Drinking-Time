/**
 * 把一张已入库的图片（generated_images 的一行）从任意面板拖到剪辑层或镜头设计表。
 *
 * 和 StoryboardEditRow 里的 IMAGE_CLIP_DRAG_MIME 分工不同：那个搬的是时间轴上
 * 已经存在的 clip（只带 clipId），这个带的是图片本身，用来把一张还没归位的图
 * 放进某一镜。对话框刚生成的新图和素材仓库里的缩略图共用这一个载荷 —— 它们
 * 本来就是同一行数据。
 */
export const STORY_IMAGE_DRAG_MIME = "application/x-dt-story-image";

export type StoryImageDragPayload = {
  imageId: number;
  imageUrl: string;
  /** 拖动时显示、落位提示里也会用到的来源说明。 */
  label: string;
};

export function writeStoryImageDragPayload(
  dataTransfer: DataTransfer,
  payload: StoryImageDragPayload
) {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(STORY_IMAGE_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", `图片 #${payload.imageId}`);
}

export function hasStoryImageDragPayload(dataTransfer: {
  types: readonly string[] | DOMStringList;
}): boolean {
  return Array.from(dataTransfer.types).includes(STORY_IMAGE_DRAG_MIME);
}

export function readStoryImageDragPayload(
  dataTransfer: Pick<DataTransfer, "getData">
): StoryImageDragPayload | null {
  try {
    const raw = dataTransfer.getData(STORY_IMAGE_DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoryImageDragPayload>;
    if (
      typeof parsed.imageId !== "number" ||
      !Number.isInteger(parsed.imageId) ||
      parsed.imageId <= 0 ||
      typeof parsed.imageUrl !== "string" ||
      !parsed.imageUrl.trim()
    ) {
      return null;
    }
    return {
      imageId: parsed.imageId,
      imageUrl: parsed.imageUrl,
      label:
        typeof parsed.label === "string"
          ? parsed.label
          : `图片 #${parsed.imageId}`,
    };
  } catch {
    return null;
  }
}
