import { describe, expect, it } from "vitest";
import { composeBodyFromChapters } from "./chapterStore";

const chapter = (id: number, position: number, body: string) => ({ id, position, blocks: { body } });

describe("composeBodyFromChapters", () => {
  const all = [chapter(1, 2, "丙一\n\n丙二"), chapter(2, 0, "甲一"), chapter(3, 1, "  \n乙一\r\n乙二")];
  it("joins picked chapters in chapter order, one line per block", () => {
    expect(composeBodyFromChapters(all, [1, 2, 3])).toEqual({
      body: "甲一\n乙一\n乙二\n丙一\n丙二",
      chapterIds: [2, 3, 1],
    });
  });
  it("ignores pick order, unknown ids and duplicates", () => {
    expect(composeBodyFromChapters(all, [3, 99, 3]).body).toBe("乙一\n乙二");
  });
  it("returns an empty body when nothing is picked", () => {
    expect(composeBodyFromChapters(all, [])).toEqual({ body: "", chapterIds: [] });
  });
});
