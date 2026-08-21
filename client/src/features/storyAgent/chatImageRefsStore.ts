import { create } from "zustand";
import {
  addChatImageRef,
  hasChatImageRef,
  promoteChatImageRefToBase,
  removeChatImageRef,
  type ChatImageRef,
} from "./chatImageRefs";

/**
 * 引用篮子的进程内状态。
 *
 * 独立成 store 而不是塞进 StoryAgentContext：加图的入口散在素材仓库、故事版、
 * 时间轴和对话框四个地方，逐层传 props 会把三棵组件树都改一遍。
 *
 * 篮子跟着故事走 —— 引用的是那个故事的图片行，切故事必须清空，否则会把
 * 别的故事的图当参考发出去。
 */
type ChatImageRefsState = {
  storyId: number | null;
  refs: ChatImageRef[];
  /** 加入或移出一张图；返回没能加进去的原因（调用方拿去 toast）。 */
  toggle: (storyId: number | null, ref: ChatImageRef) => string | null;
  remove: (imageId: number) => void;
  /** 把某张图提成底图（图1）。 */
  promote: (imageId: number) => void;
  clear: () => void;
  /** 故事切换时调用；同一个故事重复调用不动篮子。 */
  scopeToStory: (storyId: number | null) => void;
};

export const chatImageRefsStore = create<ChatImageRefsState>((set, get) => ({
  storyId: null,
  refs: [],
  toggle: (storyId, ref) => {
    const current = get();
    // 换故事时篮子先清空再加，避免混进上一个故事的图。
    const refs = current.storyId === storyId ? current.refs : [];
    if (hasChatImageRef(refs, ref.imageId)) {
      set({ storyId, refs: removeChatImageRef(refs, ref.imageId) });
      return null;
    }
    const next = addChatImageRef(refs, ref);
    set({ storyId, refs: next.refs });
    return next.rejected ?? null;
  },
  remove: imageId =>
    set(current => ({ refs: removeChatImageRef(current.refs, imageId) })),
  promote: imageId =>
    set(current => ({
      refs: promoteChatImageRefToBase(current.refs, imageId),
    })),
  clear: () => set({ refs: [] }),
  scopeToStory: storyId =>
    set(current =>
      current.storyId === storyId ? current : { storyId, refs: [] }
    ),
}));

export function useChatImageRefs(): ChatImageRef[] {
  return chatImageRefsStore(state => state.refs);
}

export function useIsChatImageRef(imageId: number | null | undefined): boolean {
  return chatImageRefsStore(state =>
    imageId == null ? false : hasChatImageRef(state.refs, imageId)
  );
}
