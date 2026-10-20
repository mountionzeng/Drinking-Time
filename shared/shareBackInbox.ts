import { readSharedLayoutState } from "./sharedLayout";
import { readTextDraftHistory, type TextDraftVersion } from "./textDraftHistory";

/**
 * 「朋友分享回来了」提醒：作者自己故事里还没处理的协作版本。
 * 只给出能展示的最少信息——不含贡献者 userId、requestHash 或分享 token。
 */
export type ShareBackNotice = {
  /** 稳定 id，客户端用来记「已看过」。 */
  id: string;
  storyId: number;
  storyTitle: string;
  kind: "text" | "layout";
  authorName: string;
  createdAt: number;
};

export const SHARE_BACK_NOTICE_LIMIT = 50;

export function collectShareBacks(
  stories: readonly { id: number; title: string; body: unknown }[]
): ShareBackNotice[] {
  const notices: ShareBackNotice[] = [];
  for (const story of stories) {
    const body = (story.body ?? {}) as Record<string, unknown>;
    const storyTitle = story.title?.trim() || "未命名故事";
    let versions: TextDraftVersion[] = [];
    try {
      versions = readTextDraftHistory(body.textDraftHistory).versions;
    } catch {
      // 历史损坏时不让提醒拖垮整个列表；版本页自己会报错。
    }
    for (const version of versions)
      if (version.contribution && !version.adoption && version.status === "ready")
        notices.push({
          id: `text:${story.id}:${version.id}`,
          storyId: story.id,
          storyTitle,
          kind: "text",
          authorName: version.contribution.authorName,
          createdAt: version.createdAt,
        });
    for (const candidate of readSharedLayoutState(body.sharedLayout).candidates)
      if (candidate.status === "pending")
        notices.push({
          id: `layout:${story.id}:${candidate.id}`,
          storyId: story.id,
          storyTitle,
          kind: "layout",
          authorName: candidate.authorName,
          createdAt: candidate.createdAt,
        });
  }
  return notices
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, SHARE_BACK_NOTICE_LIMIT);
}
