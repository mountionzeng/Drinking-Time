import { describe, expect, it } from "vitest";
import {
  activeVideoPlanId,
  readVideoMediaVersions,
  recordVideoMediaVersions,
  listVideoMediaVersions,
  mediaContentKey,
} from "./videoMediaVersions";
import { normalizeAudioState } from "./timelineAudioModel";
import { normalizeSubtitleState } from "./timelineSubtitleModel";

const film = (n: number) => ({
  id: `film-${n}`,
  versionId: `source-${n}`,
  preview: { previewId: `preview-${n}` },
  status: "adopted",
  videoVersion: n,
  confirmedAt: n * 100,
});
const body = (n = 2) => ({
  bookVideoRecords: [film(2), film(3)],
  publishing: {
    activeVideoStoryboardGroupId: `publishing-group-source-${n}-preview-${n}`,
  },
});
const extensions = (text = "原字幕", gain = 1) => ({
  subtitleTracks: normalizeSubtitleState({
    tracks: [
      { cues: [{ id: "cue", text, startFrame: 0, durationFrames: 60 }] },
    ],
  }),
  audioTracks: normalizeAudioState({
    tracks: [
      {
        kind: "music",
        clips: [
          {
            id: "clip",
            assetId: 7,
            timelineStartFrame: 0,
            sourceInFrame: 0,
            sourceOutFrame: 300,
            gain,
          },
        ],
      },
    ],
  }),
});

describe("film media version history", () => {
  it("increments each kind independently and preserves the film number", () => {
    const first = extensions(),
      second = extensions("修改字幕");
    const state = recordVideoMediaVersions({
      previousBody: body(),
      nextBody: body(),
      previousExtensions: first,
      nextExtensions: second,
      savedAt: 1000,
      userId: 5,
    });
    const list = listVideoMediaVersions(state, body());
    expect(
      list.entries.filter(e => e.kind === "subtitles").map(e => e.label)
    ).toEqual(["V02.1", "V02.2"]);
    expect(
      list.entries.filter(e => e.kind === "music").map(e => e.label)
    ).toEqual(["V02.1"]);
    const next = recordVideoMediaVersions({
      previousBody: body(),
      nextBody: body(3),
      previousExtensions: { ...second, videoMediaVersions: state },
      nextExtensions: second,
      savedAt: 1100,
      userId: 5,
    });
    expect(
      listVideoMediaVersions(next, body(3))
        .entries.filter(e => e.planId === "film-3")
        .map(e => e.label)
    ).toEqual(["V03.1", "V03.1"]);
  });

  it("hydrates legacy snapshots without writing or inventing an unknown film parent", () => {
    const ext = {
      ...extensions(),
      videoEditHistory: {
        revisions: [
          {
            savedAt: 1,
            shots: [],
            timeline: { extensions: extensions("旧字幕") },
          },
        ],
      },
    };
    const original = structuredClone(ext);
    const state = readVideoMediaVersions(body(), ext, 1000);
    expect(state.entries[0].planId).toBeNull();
    expect(activeVideoPlanId(body(), [])).toBeNull();
    expect(state.entries.at(-1)?.planId).toBe("film-2");
    expect(ext).toEqual(original);
  });

  it("keeps an explicitly selected older film through unrelated edits, then branches in the current film", () => {
    const old = extensions(),
      current = extensions("新字幕", 0.5);
    const state = recordVideoMediaVersions({
      previousBody: body(),
      nextBody: body(3),
      previousExtensions: old,
      nextExtensions: current,
      savedAt: 1000,
      userId: 5,
    });
    const previousId = state.entries.find(
      e => e.kind === "music" && e.planId === "film-2"
    )!.id;
    const selected = recordVideoMediaVersions({
      previousBody: body(3),
      nextBody: body(3),
      previousExtensions: { ...current, videoMediaVersions: state },
      nextExtensions: extensions("新字幕"),
      savedAt: 1100,
      userId: 5,
      selection: { kind: "music", versionId: previousId },
    });
    const unrelated = recordVideoMediaVersions({
      previousBody: body(3),
      nextBody: body(3),
      previousExtensions: {
        ...extensions("新字幕"),
        videoMediaVersions: selected,
      },
      nextExtensions: extensions("再改字幕"),
      savedAt: 1200,
      userId: 5,
    });
    expect(unrelated.current.music).toBe(previousId);
    const edited = recordVideoMediaVersions({
      previousBody: body(3),
      nextBody: body(3),
      previousExtensions: {
        ...extensions("再改字幕"),
        videoMediaVersions: unrelated,
      },
      nextExtensions: extensions("再改字幕", 0.3),
      savedAt: 1300,
      userId: 5,
    });
    expect(
      edited.entries.find(e => e.id === edited.current.music)
    ).toMatchObject({ planId: "film-3", number: 2 });
  });

  it("ignores identity/binding bookkeeping and preserves overlapping cue content", () => {
    const old = extensions(),
      next = structuredClone(old);
    next.subtitleTracks.tracks[0].cues[0].id = "fresh";
    next.subtitleTracks.tracks[0].cues[0].speechBindingId = "new-binding";
    next.audioTracks.tracks.find(t => t.kind === "music")!.clips[0].id =
      "fresh-audio";
    const state = recordVideoMediaVersions({
      previousBody: body(),
      nextBody: body(),
      previousExtensions: old,
      nextExtensions: next,
      savedAt: 1000,
      userId: 5,
    });
    expect(state.entries).toHaveLength(2);
    const cues = old.subtitleTracks.tracks[0].cues;
    const a = {
      tracks: [
        {
          id: "subtitles",
          cues: [cues[0], { ...cues[0], id: "b", text: "重叠" }],
        },
      ],
    };
    const b = structuredClone(a);
    b.tracks[0].cues.reverse();
    expect(mediaContentKey("subtitles", a)).toBe(
      mediaContentKey("subtitles", b)
    );
  });

  it("refuses overflow without pruning stored history", () => {
    const ext = extensions(),
      state = readVideoMediaVersions(body(), ext, 1);
    state.entries = Array.from({ length: 2000 }, (_, i) => ({
      ...state.entries[0],
      id: `v-${i}`,
      number: i + 1,
    }));
    const before = structuredClone(state);
    expect(() =>
      recordVideoMediaVersions({
        previousBody: body(),
        nextBody: body(),
        previousExtensions: { ...ext, videoMediaVersions: state },
        nextExtensions: extensions("新"),
        savedAt: 1000,
        userId: 5,
      })
    ).toThrow("容量");
    expect(state).toEqual(before);
  });
});

it("versions subtitle placement changes independently of wording", () => {
  const first = extensions();
  const second = structuredClone(first);
  second.subtitleTracks.tracks[0].placement = {
    left: 0.05,
    top: 0.8,
    width: 0.9,
    fontSize: 0.03,
  };
  const history = recordVideoMediaVersions({
    previousBody: body(),
    nextBody: body(),
    previousExtensions: first,
    nextExtensions: second,
    savedAt: 1000,
    userId: 5,
  });
  expect(history.entries.filter(e => e.kind === "subtitles")).toHaveLength(2);
  expect(
    history.entries.filter(e => e.kind === "subtitles").at(-1)?.value
  ).toEqual(second.subtitleTracks);
});
