import type { MailboxInventory, MailboxChange } from "@shared/storyMailbox";
type Translate = (
  source: string,
  values?: readonly (string | number | null | undefined)[]
) => string;
const labels: Record<keyof MailboxInventory, string> = {
  chapters: "章节",
  images: "图片",
  videos: "视频素材",
  audio: "声音素材",
  timelineItems: "剪辑片段",
  bookVersions: "书稿版本",
  chapterVersions: "章节版本",
  videoVersions: "影片版本",
  exports: "成片",
};
export function inventoryText(inventory: MailboxInventory, t: Translate) {
  return (
    (Object.keys(labels) as Array<keyof MailboxInventory>)
      .filter(k => inventory[k] > 0)
      .map(k => t("{0} 份{1}", [inventory[k], t(labels[k])]))
      .join(" · ") || t("空故事")
  );
}
export function changeText(change: MailboxChange, t: Translate) {
  const kind = t(
    change.kind === "text"
      ? "正文"
      : change.kind === "editing"
        ? "故事内容"
        : labels[change.kind]
  );
  const label = change.added
    ? t("新增 {0} 份{1}", [change.added, kind])
    : change.removed
      ? t("移除 {0} 份{1}", [change.removed, kind])
      : t("修改了{0}", [kind]);
  return change.names?.length ? `${label} · ${change.names.join("、")}` : label;
}
