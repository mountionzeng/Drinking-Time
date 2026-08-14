import { create } from "zustand";
import type { GeneratedImageItem } from "@/features/storyAgent/storyTypes";
import type {
  ChatMessage,
  GeneratedScript,
  SelectionState,
  StoryCard,
  StoryShot,
  VisualCanvasItem,
} from "../types";
import type { ImageProviderSelection } from "../storyAgentImageProvider";
import type { StoryIntent } from "../intentTypes";
import {
  emptyStoryArtDirection,
  type StoryArtDirection,
} from "@shared/artDirection";
import type { StoryPanel } from "@/features/analysis/storyPanels";
import { ensureShotIdentities } from "@shared/shotIdentity";
import {
  emptyPublishingDraftState,
  type PublishingDraftState,
} from "@shared/publishingDraft";
import type { ScopeKey } from "@shared/scopedResource";
import type { PublishingDraftBufferMap } from "../storyAgentPersistence";

export type StorySaveStatus = "idle" | "saving" | "saved" | "error";

export type StoryListItem = {
  id: number;
  title: string;
  logline?: string | null;
  summary?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  cardCount?: number;
  shotCount?: number;
  activityDates?: string[];
};

type SetterInput<T> = T | ((current: T) => T);
export type StorySpineSetter<T> = (next: SetterInput<T>) => void;

type StorySpineData = {
  messages: ChatMessage[];
  cards: StoryCard[];
  scripts: GeneratedScript[];
  storyShots: StoryShot[];
  characters: Array<{ name: string; role: string; oneLiner: string }>;
  remoteStoryId?: number;
  storyTitle?: string;
  storyLogline?: string;
  storyTheme?: string;
  storyArc?: string;
  visualCanvasItems: VisualCanvasItem[];
  visualPreference: string;
  storyImages: GeneratedImageItem[];
  imageProvider: ImageProviderSelection;
  artDirection: StoryArtDirection;
  publishing: PublishingDraftState;
  publishingBuffers: PublishingDraftBufferMap;
  isArtWorking: boolean;
  isReplying: boolean;
  isGeneratingScript: boolean;
  confirmedIntent: StoryIntent | null;
  pendingIntentDraft: StoryIntent | null;
  activeStoryId: number | null;
  visibleStoryPanels: StoryPanel[];
  saveStatus: StorySaveStatus;
  lastSavedAt?: number;
  serverRevision: number;
  isLoadingStories: boolean;
  storyList: StoryListItem[];
  returningGreeting: string | null;
  activeSelection: SelectionState | null;
  hydratedFor: number | null;
  sessionId: string;
  lastSnapshotHash: string;
  lastArchiveSaveHash: string;
  lastStateChangeTime: number;
  lastSnapshotId: number | null;
  /** Increments whenever the active story payload is replaced. */
  storyScopeEpoch: number;
  /** Monotonic token used to discard story loads that finish out of order. */
  storyLoadEpoch: number;
};

type StoryScopeReplacement = Pick<
  StorySpineData,
  | "messages"
  | "cards"
  | "scripts"
  | "storyShots"
  | "characters"
  | "remoteStoryId"
  | "storyTitle"
  | "storyLogline"
  | "storyTheme"
  | "storyArc"
  | "visualCanvasItems"
  | "visualPreference"
  | "storyImages"
  | "imageProvider"
  | "artDirection"
  | "publishing"
  | "publishingBuffers"
  | "confirmedIntent"
  | "pendingIntentDraft"
  | "activeStoryId"
  | "saveStatus"
  | "lastSavedAt"
  | "serverRevision"
  | "returningGreeting"
>;

type StorySpineActions = {
  setMessages: StorySpineSetter<ChatMessage[]>;
  setCards: StorySpineSetter<StoryCard[]>;
  setScripts: StorySpineSetter<GeneratedScript[]>;
  setStoryShots: StorySpineSetter<StoryShot[]>;
  setCharacters: StorySpineSetter<
    Array<{ name: string; role: string; oneLiner: string }>
  >;
  setRemoteStoryId: StorySpineSetter<number | undefined>;
  setStoryTitle: StorySpineSetter<string | undefined>;
  setStoryLogline: StorySpineSetter<string | undefined>;
  setStoryTheme: StorySpineSetter<string | undefined>;
  setStoryArc: StorySpineSetter<string | undefined>;
  setVisualCanvasItems: StorySpineSetter<VisualCanvasItem[]>;
  setVisualPreference: StorySpineSetter<string>;
  setStoryImages: StorySpineSetter<GeneratedImageItem[]>;
  setImageProvider: StorySpineSetter<ImageProviderSelection>;
  setArtDirection: StorySpineSetter<StoryArtDirection>;
  setPublishing: StorySpineSetter<PublishingDraftState>;
  setPublishingBuffers: StorySpineSetter<PublishingDraftBufferMap>;
  setIsArtWorking: StorySpineSetter<boolean>;
  setIsReplying: StorySpineSetter<boolean>;
  setIsGeneratingScript: StorySpineSetter<boolean>;
  setConfirmedIntent: StorySpineSetter<StoryIntent | null>;
  setPendingIntentDraft: StorySpineSetter<StoryIntent | null>;
  setActiveStoryId: StorySpineSetter<number | null>;
  setVisibleStoryPanels: StorySpineSetter<StoryPanel[]>;
  toggleVisibleStoryPanel: (panelId: StoryPanel) => void;
  setSaveStatus: StorySpineSetter<StorySaveStatus>;
  setLastSavedAt: StorySpineSetter<number | undefined>;
  setServerRevision: StorySpineSetter<number>;
  setIsLoadingStories: StorySpineSetter<boolean>;
  setStoryList: StorySpineSetter<StoryListItem[]>;
  setReturningGreeting: StorySpineSetter<string | null>;
  setActiveSelection: StorySpineSetter<SelectionState | null>;
  setHydratedFor: StorySpineSetter<number | null>;
  setLastSnapshotHash: StorySpineSetter<string>;
  setLastArchiveSaveHash: StorySpineSetter<string>;
  setLastStateChangeTime: StorySpineSetter<number>;
  setLastSnapshotId: StorySpineSetter<number | null>;
  beginStoryLoad: () => number;
  replaceStoryScopeIfCurrent: (
    loadEpoch: number,
    replacement: StoryScopeReplacement
  ) => boolean;
  resetStorySpine: () => void;
};

export type StorySpineState = StorySpineData & StorySpineActions;

function sessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function initialData(): StorySpineData {
  return {
    messages: [],
    cards: [],
    scripts: [],
    storyShots: [],
    characters: [],
    remoteStoryId: undefined,
    storyTitle: undefined,
    storyLogline: undefined,
    storyTheme: undefined,
    storyArc: undefined,
    visualCanvasItems: [],
    visualPreference: "",
    storyImages: [],
    imageProvider: "default",
    artDirection: emptyStoryArtDirection(),
    publishing: emptyPublishingDraftState(),
    publishingBuffers: {},
    isArtWorking: false,
    isReplying: false,
    isGeneratingScript: false,
    confirmedIntent: null,
    pendingIntentDraft: null,
    activeStoryId: null,
    visibleStoryPanels: [
      "materialWarehouse",
      "storyboard",
      "animatic",
      "promptTable",
    ],
    saveStatus: "idle",
    lastSavedAt: undefined,
    serverRevision: 0,
    isLoadingStories: false,
    storyList: [],
    returningGreeting: null,
    activeSelection: null,
    hydratedFor: null,
    sessionId: sessionId(),
    lastSnapshotHash: "",
    lastArchiveSaveHash: "",
    lastStateChangeTime: Date.now(),
    lastSnapshotId: null,
    storyScopeEpoch: 0,
    storyLoadEpoch: 0,
  };
}

function resolve<T>(current: T, next: SetterInput<T>): T {
  return typeof next === "function"
    ? (next as (current: T) => T)(current)
    : next;
}

/**
 * 用途：把 spine 当前的 activeStoryId 转换为跨层统一的 Story ScopeKey；
 *   替代此前各处直接比较 `activeStoryId` 数字的零散写法。没有活跃 Story
 *   时返回 null，调用方必须显式处理"当前无 scope"这个状态，不能假装它是
 *   某个默认 storyId。
 * 调用入口（尚未接入，U7 落地）：Story Agent Context 判断响应/订阅是否仍
 *   属于当前 Story；目前还没有生产调用方。
 * 下游调用：@shared/scopedResource.ts 的 scopeKeysEqual。
 */
export function currentStoryScopeKey(
  state: Pick<StorySpineData, "activeStoryId">
): ScopeKey | null {
  return state.activeStoryId == null
    ? null
    : { resourceKind: "story", storyId: state.activeStoryId };
}

export const useStorySpine = create<StorySpineState>()(set => {
  const setField =
    <K extends keyof StorySpineData>(
      key: K
    ): StorySpineSetter<StorySpineData[K]> =>
    next =>
      set(
        state =>
          ({ [key]: resolve(state[key], next) }) as Pick<StorySpineData, K>
      );

  return {
    ...initialData(),
    setMessages: setField("messages"),
    setCards: setField("cards"),
    setScripts: setField("scripts"),
    setStoryShots: next =>
      set(state => ({
        storyShots: ensureShotIdentities(
          resolve(state.storyShots, next) as StoryShot[]
        ),
      })),
    setCharacters: setField("characters"),
    setRemoteStoryId: setField("remoteStoryId"),
    setStoryTitle: setField("storyTitle"),
    setStoryLogline: setField("storyLogline"),
    setStoryTheme: setField("storyTheme"),
    setStoryArc: setField("storyArc"),
    setVisualCanvasItems: setField("visualCanvasItems"),
    setVisualPreference: setField("visualPreference"),
    setStoryImages: setField("storyImages"),
    setImageProvider: setField("imageProvider"),
    setArtDirection: setField("artDirection"),
    setPublishing: setField("publishing"),
    setPublishingBuffers: setField("publishingBuffers"),
    setIsArtWorking: setField("isArtWorking"),
    setIsReplying: setField("isReplying"),
    setIsGeneratingScript: setField("isGeneratingScript"),
    setConfirmedIntent: setField("confirmedIntent"),
    setPendingIntentDraft: setField("pendingIntentDraft"),
    setActiveStoryId: setField("activeStoryId"),
    setVisibleStoryPanels: setField("visibleStoryPanels"),
    toggleVisibleStoryPanel: panelId =>
      set(state => ({
        visibleStoryPanels: state.visibleStoryPanels.includes(panelId)
          ? state.visibleStoryPanels.filter(id => id !== panelId)
          : [...state.visibleStoryPanels, panelId],
      })),
    setSaveStatus: setField("saveStatus"),
    setLastSavedAt: setField("lastSavedAt"),
    setServerRevision: setField("serverRevision"),
    setIsLoadingStories: setField("isLoadingStories"),
    setStoryList: setField("storyList"),
    setReturningGreeting: setField("returningGreeting"),
    setActiveSelection: setField("activeSelection"),
    setHydratedFor: setField("hydratedFor"),
    setLastSnapshotHash: setField("lastSnapshotHash"),
    setLastArchiveSaveHash: setField("lastArchiveSaveHash"),
    setLastStateChangeTime: setField("lastStateChangeTime"),
    setLastSnapshotId: setField("lastSnapshotId"),
    beginStoryLoad: () => {
      let loadEpoch = 0;
      set(state => {
        loadEpoch = state.storyLoadEpoch + 1;
        return { storyLoadEpoch: loadEpoch };
      });
      return loadEpoch;
    },
    replaceStoryScopeIfCurrent: (loadEpoch, replacement) => {
      let replaced = false;
      set(state => {
        if (state.storyLoadEpoch !== loadEpoch) return state;
        replaced = true;
        return {
          ...replacement,
          storyShots: ensureShotIdentities(replacement.storyShots),
          storyScopeEpoch: state.storyScopeEpoch + 1,
          lastArchiveSaveHash: "",
        };
      });
      return replaced;
    },
    resetStorySpine: () => set(initialData()),
  };
});

export const storySpineStore = useStorySpine;
