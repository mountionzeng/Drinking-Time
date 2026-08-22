import { useCallback, useState } from "react";
import { toast } from "sonner";
import { shotIdentityFromShot } from "@shared/shotIdentity";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import {
  hasStoryImageDragPayload,
  readStoryImageDragPayload,
  type StoryImageDragPayload,
} from "@/features/storyAgent/storyImageDrag";
import { useOptionalCreationEditor } from "./CreationEditorContext";

/**
 * 把一张图片放进剪辑层或镜头设计表。
 *
 * 落点决定语义：落在某一镜上就换成那一镜的画面；落在空白处就在末尾新开一镜
 * 再挂上去。时间轴和镜头设计表读的是同一份镜头数据，所以只要图挂到了
 * stableShotId 上，两边同时更新，不需要再搭一座桥。
 */
export type StoryImageDropTarget =
  | { kind: "shot"; stableShotId: string }
  | { kind: "new-shot" };

export type StoryImageDropController = {
  /** 正在落位的图片 id；用来在界面上禁用重复操作。 */
  pendingImageId: number | null;
  /** 拖动中是否带着图片载荷，用来给落点画高亮。 */
  accepts: (dataTransfer: {
    types: readonly string[] | DOMStringList;
  }) => boolean;
  drop: (
    dataTransfer: Pick<DataTransfer, "getData">,
    target: StoryImageDropTarget
  ) => Promise<boolean>;
};

export function useStoryImageDrop(): StoryImageDropController {
  // 时间轴行也会在没有 Provider 的单元测试里单独渲染，所以走可选版本：
  // 拿不到编辑器上下文时落位直接失败，而不是把整棵树炸掉。
  const editor = useOptionalCreationEditor();
  const [pendingImageId, setPendingImageId] = useState<number | null>(null);

  const accepts = useCallback(hasStoryImageDragPayload, []);

  /**
   * 新镜头的稳定身份要从落库后的故事里读，不能用组件闭包里的 shots ——
   * 那份是插入之前的快照，拿它算出来的身份会指向旧的最后一镜，图就挂错地方。
   * insertPersistedShotAfter 返回前已经把新的镜头列表写进了故事主干，
   * 所以直接读 store 当前值，既拿得到新镜头，也不用再发一次请求。
   */
  const resolveInsertedStableShotId = useCallback(
    (insertedShotNo: number): string | null => {
      const nextShots = storySpineStore.getState().storyShots;
      const index = insertedShotNo - 1;
      if (index < 0 || index >= nextShots.length) return null;
      return shotIdentityFromShot(nextShots[index], index);
    },
    []
  );

  const drop = useCallback(
    async (
      dataTransfer: Pick<DataTransfer, "getData">,
      target: StoryImageDropTarget
    ) => {
      const payload: StoryImageDragPayload | null =
        readStoryImageDragPayload(dataTransfer);
      if (!payload) return false;
      const activeStoryId = editor?.activeStoryId ?? null;
      if (!editor || activeStoryId == null) {
        toast.error("故事还没加载好，稍后再拖");
        return false;
      }
      if (pendingImageId != null) return false;
      setPendingImageId(payload.imageId);
      try {
        let targetStableShotId: string | null =
          target.kind === "shot" ? target.stableShotId : null;
        if (target.kind === "new-shot") {
          const anchor = editor.shots.at(-1);
          const anchorStableShotId = anchor
            ? (anchor.stableShotId ?? anchor.shotIdentity ?? null)
            : null;
          if (!anchorStableShotId) {
            toast.error("这个故事还没有镜头，先建一镜再往里放图");
            return false;
          }
          const insertedShotNo =
            await editor.insertPersistedShotAfter(anchorStableShotId);
          targetStableShotId =
            insertedShotNo == null
              ? null
              : resolveInsertedStableShotId(insertedShotNo);
          if (!targetStableShotId) {
            toast.error("新镜头已建好，但没能确认它的身份，请手动把图绑上去");
            return false;
          }
        }
        if (!targetStableShotId) return false;
        await editor.assignStoryImageToShot({
          imageId: payload.imageId,
          targetStableShotId,
        });
        toast.success(
          target.kind === "new-shot"
            ? `已新建一镜并放上 ${payload.label}`
            : `已把 ${payload.label} 换到这一镜`
        );
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "图片落位失败");
        return false;
      } finally {
        setPendingImageId(null);
      }
    },
    [editor, pendingImageId, resolveInsertedStableShotId]
  );

  return { pendingImageId, accepts, drop };
}
