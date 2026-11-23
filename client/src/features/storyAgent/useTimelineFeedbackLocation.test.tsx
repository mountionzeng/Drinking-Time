import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { useTimelineFeedbackLocation } from "./useTimelineFeedbackLocation";
import { registerFeedbackEditor, type FeedbackClock } from "./timelineFeedbackLocation";

it("holds the first keystroke or recording start through later playback and transcription", () => {
  let positionMs = 1250;
  const read = vi.fn((): FeedbackClock => ({ storyId: 8, version: 1, totalMs: 40000, playing: true,
    positionMs, range: null, rows: [], cues: [], hidden: [] }));
  const release = registerFeedbackEditor(8, { read, focus: () => "" });
  let feedback!: ReturnType<typeof useTimelineFeedbackLocation>;
  function Composer() {
    feedback = useTimelineFeedbackLocation(8, "account/story/session", "");
    return null;
  }
  try {
    renderToStaticMarkup(<Composer />);
    feedback.change("这");
    positionMs = 3000;
    feedback.change("这里的画面");
    expect(feedback.begin()?.positionMs).toBe(1250);
    expect(read).toHaveBeenCalledTimes(1);
    feedback.change("");
    expect(feedback.begin()?.positionMs).toBe(3000);
    positionMs = 5400;
    feedback.begin(true); // Permission granted and the recorder actually starts.
    positionMs = 8900;
    expect(feedback.begin()?.positionMs).toBe(5400);
    feedback.reset();
    expect(feedback.begin()?.positionMs).toBe(8900);
  } finally { release(); }
});
