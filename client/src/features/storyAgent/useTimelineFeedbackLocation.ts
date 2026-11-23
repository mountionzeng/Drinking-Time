import { useEffect, useRef } from "react";
import { readFeedbackClock, type FeedbackClock } from "./timelineFeedbackLocation";

/** Sample once, at the first keystroke or microphone press. The composer never subscribes to playback ticks. */
export function useTimelineFeedbackLocation(storyId: number | null, scope: string, text: string) {
  const draft = useRef<{ scope: string; clock: FeedbackClock | null } | null>(null);
  const begin = (fresh = false) => {
    if (fresh || draft.current?.scope !== scope)
      draft.current = { scope, clock: readFeedbackClock(storyId) };
    return draft.current.clock;
  };
  const reset = () => { draft.current = null; };
  const previous = useRef(text);
  useEffect(() => {
    if (previous.current && !text) reset();
    previous.current = text;
  }, [text]);
  return {
    begin, reset,
    change: (value: string) => { if (value.trim()) begin(); else reset(); },
    snapshot: draft.current?.scope === scope ? draft.current.clock : null,
  };
}
