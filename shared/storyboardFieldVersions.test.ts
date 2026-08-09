import { describe, expect, it } from "vitest";
import {
  initializeStoryboardFieldVersions,
  recordStoryboardFieldVersions,
  restoreStoryboardFieldVersion,
} from "./storyboardFieldVersions";

const shots = [
  {
    stableShotId: "shot-1",
    scriptText: "剧本一",
    promptDraft: "图片一",
    videoPrompt: "视频一",
    dialogue: "旁白一",
    sound: "雨声一",
  },
  {
    stableShotId: "shot-2",
    scriptText: "剧本二",
    promptDraft: "图片二",
    videoPrompt: "视频二",
    dialogue: "旁白二",
    sound: "雨声二",
  },
];

describe("storyboard field versions", () => {
  it("starts script, image, and video columns at independent V1 snapshots", () => {
    const state = initializeStoryboardFieldVersions(undefined, shots, 100);

    expect(state.tracks.scriptText.currentRevision).toBe(1);
    expect(state.tracks.promptDraft.currentRevision).toBe(1);
    expect(state.tracks.videoPrompt.currentRevision).toBe(1);
    expect(state.tracks.dialogue.currentRevision).toBe(1);
    expect(state.tracks.promptDraft.history[0]?.values).toEqual({
      "shot-1": "图片一",
      "shot-2": "图片二",
    });
  });

  it("increments only the edited column and keeps its prior snapshot", () => {
    const initialized = initializeStoryboardFieldVersions(
      undefined,
      shots,
      100
    );
    const nextShots = shots.map((shot, index) =>
      index === 0 ? { ...shot, promptDraft: "图片一（修改）" } : shot
    );
    const state = recordStoryboardFieldVersions({
      state: initialized,
      beforeShots: shots,
      afterShots: nextShots,
      fields: ["promptDraft"],
      now: 200,
      source: "edited",
    });

    expect(state.tracks.scriptText.currentRevision).toBe(1);
    expect(state.tracks.promptDraft.currentRevision).toBe(2);
    expect(state.tracks.videoPrompt.currentRevision).toBe(1);
    expect(state.tracks.promptDraft.history.map(item => item.revision)).toEqual(
      [1, 2]
    );
  });

  it("restores an old snapshot as a new revision without deleting history", () => {
    const initialized = initializeStoryboardFieldVersions(
      undefined,
      shots,
      100
    );
    const changedShots = shots.map((shot, index) =>
      index === 0 ? { ...shot, scriptText: "剧本一（修改）" } : shot
    );
    const changed = recordStoryboardFieldVersions({
      state: initialized,
      beforeShots: shots,
      afterShots: changedShots,
      fields: ["scriptText"],
      now: 200,
      source: "edited",
    });
    const restored = restoreStoryboardFieldVersion({
      state: changed,
      shots: changedShots,
      field: "scriptText",
      revision: 1,
      now: 300,
    });

    expect(restored.shots[0]?.scriptText).toBe("剧本一");
    expect(restored.state.tracks.scriptText.currentRevision).toBe(3);
    expect(restored.state.tracks.scriptText.history.at(-1)).toMatchObject({
      revision: 3,
      source: "restored",
      restoredFromRevision: 1,
    });
  });

  it("snapshots and restores dialogue and sound as one voice version", () => {
    const initialized = initializeStoryboardFieldVersions(
      undefined,
      shots,
      100
    );
    const changedShots = shots.map((shot, index) =>
      index === 0
        ? { ...shot, dialogue: "旁白一（修改）", sound: "风声一（修改）" }
        : shot
    );
    const changed = recordStoryboardFieldVersions({
      state: initialized,
      beforeShots: shots,
      afterShots: changedShots,
      fields: ["dialogue"],
      now: 200,
      source: "edited",
    });
    const restored = restoreStoryboardFieldVersion({
      state: changed,
      shots: changedShots,
      field: "dialogue",
      revision: 1,
      now: 300,
    });

    expect(restored.shots[0]).toMatchObject({
      dialogue: "旁白一",
      sound: "雨声一",
    });
    expect(restored.state.tracks.dialogue.currentRevision).toBe(3);
  });

  it("restores a regenerated column by shot order when stable ids changed", () => {
    const initialized = initializeStoryboardFieldVersions(
      undefined,
      shots,
      100
    );
    const regenerated = shots.map((shot, index) => ({
      ...shot,
      stableShotId: `regenerated-${index + 1}`,
      scriptText: `新剧本${index + 1}`,
    }));
    const changed = recordStoryboardFieldVersions({
      state: initialized,
      beforeShots: shots,
      afterShots: regenerated,
      fields: ["scriptText"],
      now: 200,
      source: "generated",
    });
    const restored = restoreStoryboardFieldVersion({
      state: changed,
      shots: regenerated,
      field: "scriptText",
      revision: 1,
      now: 300,
    });

    expect(restored.shots.map(shot => shot.scriptText)).toEqual([
      "剧本一",
      "剧本二",
    ]);
  });

  it.each([
    ["before", ["new-shot", "shot-1", "shot-2"]],
    ["between", ["shot-1", "new-shot", "shot-2"]],
    ["after", ["shot-1", "shot-2", "new-shot"]],
  ])(
    "does not steal an existing shot value for a partially matching shot inserted %s",
    (_position, order) => {
      const initialized = initializeStoryboardFieldVersions(
        undefined,
        shots,
        100
      );
      const byIdentity = new Map(
        [
          ...shots.map(shot => ({ ...shot, scriptText: `${shot.scriptText}（当前）` })),
          {
            stableShotId: "new-shot",
            scriptText: "新增镜头当前内容",
          },
        ].map(shot => [shot.stableShotId, shot])
      );
      const currentShots = order.map(identity => byIdentity.get(identity)!);

      const restored = restoreStoryboardFieldVersion({
        state: initialized,
        shots: currentShots,
        field: "scriptText",
        revision: 1,
        now: 200,
      });

      expect(
        Object.fromEntries(
          restored.shots.map(shot => [shot.stableShotId, shot.scriptText])
        )
      ).toEqual({
        "shot-1": "剧本一",
        "shot-2": "剧本二",
        "new-shot": "新增镜头当前内容",
      });
    }
  );

  it("keeps the original baseline while bounding long edit histories", () => {
    let state = initializeStoryboardFieldVersions(undefined, shots, 100);
    let currentShots = shots;
    for (let revision = 2; revision <= 60; revision += 1) {
      const nextShots = currentShots.map((shot, index) =>
        index === 0 ? { ...shot, scriptText: `剧本一 V${revision}` } : shot
      );
      state = recordStoryboardFieldVersions({
        state,
        beforeShots: currentShots,
        afterShots: nextShots,
        fields: ["scriptText"],
        now: 100 + revision,
        source: "edited",
      });
      currentShots = nextShots;
    }

    expect(state.tracks.scriptText.history).toHaveLength(50);
    expect(state.tracks.scriptText.history[0]?.revision).toBe(1);
    expect(state.tracks.scriptText.history.at(-1)?.revision).toBe(60);
  });
});
