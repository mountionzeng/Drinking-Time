import { create } from "zustand";
import type { GeneratedImageItem } from "@/features/mobileChat/types";
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

export type StorySaveStatus = "idle" | "saving" | "saved" | "error";

export type StoryListItem = {
  id: number;
  title: string;
  logline?: string | null;
  updatedAt?: string | Date | null;
  cardCount?: number;
  shotCount?: number;
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
};

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
    isArtWorking: false,
    isReplying: false,
    isGeneratingScript: false,
    confirmedIntent: null,
    pendingIntentDraft: null,
    activeStoryId: null,
    visibleStoryPanels: ['storyboard', 'animatic', 'promptTable'],
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
  };
}

function resolve<T>(current: T, next: SetterInput<T>): T {
  return typeof next === "function"
    ? (next as (current: T) => T)(current)
    : next;
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
    resetStorySpine: () => set(initialData()),
  };
});

export const storySpineStore = useStorySpine;
