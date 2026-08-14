import { beforeEach, describe, expect, it } from "vitest";

import { storySpineStore } from "./storySpine";

describe("storySpine", () => {
  beforeEach(() => {
    storySpineStore.getState().resetStorySpine();
  });

  it("keeps React-style value and updater setters compatible", () => {
    const store = storySpineStore.getState();

    store.setCards([
      {
        id: "card-1",
        title: "First",
        content: "one",
        emotion: "quiet",
        sensoryDetails: [],
        createdAt: 1,
      },
    ]);
    storySpineStore.getState().setCards(cards => [
      ...cards,
      {
        id: "card-2",
        title: "Second",
        content: "two",
        emotion: "warm",
        sensoryDetails: [],
        createdAt: 2,
      },
    ]);

    expect(storySpineStore.getState().cards.map(card => card.id)).toEqual([
      "card-1",
      "card-2",
    ]);
  });

  it("exposes current save and hydration state through getState", () => {
    const store = storySpineStore.getState();

    store.setHydratedFor(42);
    store.setServerRevision(7);
    store.setLastSnapshotHash("snapshot-a");
    store.setLastArchiveSaveHash("archive-a");
    store.setLastStateChangeTime(1234);
    store.setConfirmedIntent({
      purpose: "personal_memory",
      confidence: 0.9,
    });
    store.setStoryImages([
      {
        id: 11,
        imageUrl: "/api/images/11.png",
        prompt: "frame",
        shotNo: 1,
        storyId: 42,
        status: "ready",
      },
    ]);

    const current = storySpineStore.getState();
    expect(current.hydratedFor).toBe(42);
    expect(current.serverRevision).toBe(7);
    expect(current.lastSnapshotHash).toBe("snapshot-a");
    expect(current.lastArchiveSaveHash).toBe("archive-a");
    expect(current.lastStateChangeTime).toBe(1234);
    expect(current.confirmedIntent?.purpose).toBe("personal_memory");
    expect(current.storyImages[0]?.imageUrl).toBe("/api/images/11.png");
  });

  it("stores publishing state and local buffers, then resets both safely", () => {
    const store = storySpineStore.getState();
    store.setPublishing(current => ({
      ...current,
      activePlatform: "x",
      selectedPlatforms: ["x"],
    }));
    store.setPublishingBuffers({
      "42:x": {
        storyId: 42,
        platform: "x",
        content: { title: "", body: "dirty", tags: [] },
        updatedAt: 1,
      },
    });

    expect(storySpineStore.getState().publishing.activePlatform).toBe("x");
    expect(
      storySpineStore.getState().publishingBuffers["42:x"]?.content.body
    ).toBe("dirty");

    storySpineStore.getState().resetStorySpine();
    expect(storySpineStore.getState().publishing.activePlatform).toBe(
      "xiaohongshu"
    );
    expect(storySpineStore.getState().publishingBuffers).toEqual({});
  });

  it("replaces a loaded story atomically without exposing mixed story state", () => {
    const store = storySpineStore.getState();
    store.setActiveStoryId(20);
    store.setRemoteStoryId(20);
    store.setStoryTitle("故事 A");
    store.setStoryShots([
      {
        shotNo: 1,
        subject: "故事 A 主体",
        action: "",
        cameraMove: "",
        dialogue: "",
        transitionOut: "cut",
        durationMs: 1_000,
      },
    ]);

    const observedScopes: string[] = [];
    const unsubscribe = storySpineStore.subscribe(state => {
      observedScopes.push(
        `${state.activeStoryId}:${state.storyTitle}:${state.storyShots[0]?.subject ?? ""}`
      );
    });
    const loadEpoch = storySpineStore.getState().beginStoryLoad();
    const current = storySpineStore.getState();
    const replaced = current.replaceStoryScopeIfCurrent(loadEpoch, {
      messages: [],
      cards: [],
      scripts: [],
      storyShots: [
        {
          shotNo: 1,
          subject: "故事 B 主体",
          action: "",
          cameraMove: "",
          dialogue: "",
          transitionOut: "cut",
          durationMs: 1_000,
        },
      ],
      characters: [],
      remoteStoryId: 1176,
      storyTitle: "故事 B",
      storyLogline: undefined,
      storyTheme: undefined,
      storyArc: undefined,
      visualCanvasItems: [],
      visualPreference: "",
      storyImages: [],
      imageProvider: "default",
      artDirection: current.artDirection,
      publishing: current.publishing,
      publishingBuffers: {},
      confirmedIntent: null,
      pendingIntentDraft: null,
      activeStoryId: 1176,
      saveStatus: "saved",
      lastSavedAt: 2,
      serverRevision: 3,
      returningGreeting: null,
    });
    unsubscribe();

    expect(replaced).toBe(true);
    expect(storySpineStore.getState().storyScopeEpoch).toBe(1);
    expect(observedScopes).not.toContain("1176:故事 A:故事 A 主体");
    expect(observedScopes).not.toContain("1176:故事 B:故事 A 主体");
    expect(observedScopes.at(-1)).toBe("1176:故事 B:故事 B 主体");
  });

  it("discards a story load that finishes after a newer load", () => {
    const firstLoad = storySpineStore.getState().beginStoryLoad();
    const secondLoad = storySpineStore.getState().beginStoryLoad();
    const current = storySpineStore.getState();
    const replacement = {
      messages: [],
      cards: [],
      scripts: [],
      storyShots: [],
      characters: [],
      remoteStoryId: 20,
      storyTitle: "迟到的故事",
      storyLogline: undefined,
      storyTheme: undefined,
      storyArc: undefined,
      visualCanvasItems: [],
      visualPreference: "",
      storyImages: [],
      imageProvider: "default" as const,
      artDirection: current.artDirection,
      publishing: current.publishing,
      publishingBuffers: {},
      confirmedIntent: null,
      pendingIntentDraft: null,
      activeStoryId: 20,
      saveStatus: "saved" as const,
      lastSavedAt: 1,
      serverRevision: 1,
      returningGreeting: null,
    };

    expect(
      storySpineStore
        .getState()
        .replaceStoryScopeIfCurrent(firstLoad, replacement)
    ).toBe(false);
    expect(storySpineStore.getState().activeStoryId).toBeNull();
    expect(
      storySpineStore
        .getState()
        .replaceStoryScopeIfCurrent(secondLoad, replacement)
    ).toBe(true);
    expect(storySpineStore.getState().activeStoryId).toBe(20);
  });
});
