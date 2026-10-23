import { describe, expect, it } from "vitest";
import { composeBodyFromChapters } from "./chapterStore";

const chapter = (id: number, position: number, body: string) => ({
  id,
  position,
  blocks: { body },
});

describe("composeBodyFromChapters", () => {
  const all = [
    chapter(1, 2, "丙一\n\n丙二"),
    chapter(2, 0, "甲一"),
    chapter(3, 1, "  \n乙一\r\n乙二"),
  ];
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
    expect(composeBodyFromChapters(all, [])).toEqual({
      body: "",
      chapterIds: [],
    });
  });
});

import { chapterLayoutProblem } from "./chapterStore";
describe("chapterLayoutProblem", () => {
  const page = (imageUrl: string) => ({
    modules: [{ kind: "image", imageUrl }],
  });
  it("refuses embedded data urls", () => {
    expect(
      chapterLayoutProblem({ pages: [page("data:image/png;base64,AAAA")] })
    ).toMatch(/本机/);
  });
  it("accepts url references, empty layouts and null", () => {
    expect(
      chapterLayoutProblem({ pages: [page("https://x/a.png")] })
    ).toBeNull();
    expect(chapterLayoutProblem(null)).toBeNull();
  });
  it("refuses an oversized layout", () => {
    expect(
      chapterLayoutProblem({
        pages: [{ modules: [{ kind: "text", imageUrl: "x".repeat(300_000) }] }],
      })
    ).toMatch(/太大/);
  });
});

import { realignBlockIds } from "./chapterStore";
describe("realignBlockIds", () => {
  let n = 0;
  const fresh = () => `new-${++n}`;
  const ids = ["a", "b", "c"];
  it("keeps every id when a line is edited in place", () => {
    expect(realignBlockIds("一\n二\n三", ids, "一\n二改\n三", fresh)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("gives a new id to an appended line and keeps the others", () => {
    n = 0;
    expect(realignBlockIds("一\n二\n三", ids, "一\n二\n三\n四", fresh)).toEqual(
      ["a", "b", "c", "new-1"]
    );
  });
  it("drops the id of a deleted middle line and keeps the neighbours", () => {
    expect(realignBlockIds("一\n二\n三", ids, "一\n三", fresh)).toEqual([
      "a",
      "c",
    ]);
  });
  it("inserting a line in the middle keeps head and tail ids", () => {
    n = 0;
    expect(realignBlockIds("一\n三", ["a", "c"], "一\n二\n三", fresh)).toEqual([
      "a",
      "new-1",
      "c",
    ]);
  });
  it("ignores blank lines and gives up when ids do not match the lines", () => {
    expect(realignBlockIds("一\n\n二", ["a", "b"], "一\n二\n", fresh)).toEqual([
      "a",
      "b",
    ]);
    expect(
      realignBlockIds("一\n二", ["a", "b", "img"], "一\n二", fresh)
    ).toEqual([]);
    expect(realignBlockIds("一", [], "一\n二", fresh)).toEqual([]);
  });
});

import {
  readChapterLayout,
  writeChapterLayout,
  type StoredChapterBlocks,
} from "./chapterStore";
it("keeps multiline edits once in canonical text and maintains their ids on another save", () => {
  const blocks: StoredChapterBlocks = {
    body: "甲\n乙",
    blockIds: ["a", "b"],
    containsAiText: false,
    settings: null,
    coverKey: null,
    bodyTextureKey: null,
    images: {},
    illustrations: [],
  };
  const module = (id: string, text: string) => ({
    id,
    text,
    kind: "text" as const,
    rect: { x: 0, y: 0, width: 500, height: 100 },
    fontSize: 32,
    contentWidth: 500,
    contentHeight: 100,
    alignment: "start" as const,
  });
  const document = {
    version: 1 as const,
    pages: [
      {
        label: "页",
        modules: [
          module("paragraph-0", "甲改\n新增行"),
          module("paragraph-1", "乙"),
        ],
      },
    ],
  };
  const first = writeChapterLayout("标题", blocks, null, document, () => "new");
  expect(first.blocks.body).toBe("甲改\n新增行\n乙");
  expect(first.blocks.blockIds).toEqual(["a", "new", "b"]);
  expect(JSON.stringify(first.layout)).not.toContain("新增行");
  expect(readChapterLayout(first.title, first.blocks, first.layout)).toEqual(
    document
  );
  const second = writeChapterLayout(
    first.title,
    first.blocks,
    first.layout,
    document,
    () => {
      throw new Error("不应重新编号");
    }
  );
  expect(second.blocks).toEqual(first.blocks);
});
