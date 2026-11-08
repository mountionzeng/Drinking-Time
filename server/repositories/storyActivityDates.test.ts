import { expect, it } from "vitest";
import { storyActivityDates } from "./stories";

it("recognizes both legacy who and canonical role, excluding assistant activity", () => {
  expect(
    storyActivityDates(
      {
        messages: [
          { who: "u", timestamp: "2026-11-05T16:01:00Z" },
          { role: "user", timestamp: "2026-11-06T16:01:00Z" },
          { who: "assistant", timestamp: "2026-11-07T16:01:00Z" },
          { who: "s", timestamp: "2026-11-07T16:01:00Z" },
          { role: "assistant", who: "user", timestamp: "2026-11-07T16:01:00Z" },
        ],
      },
      new Date("2026-11-01T00:00:00Z")
    )
  ).toEqual(["2026-11-06", "2026-11-07"]);
});
