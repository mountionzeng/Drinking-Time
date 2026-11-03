import { describe, expect, it } from "vitest";
import {
  bookImageDropAnchor,
  captureBookImageAnchor,
  insertBookImages,
} from "./bookImageInsert";
import {
  blockBody,
  newWritingBlock,
  restoreStyledBlocks,
  writingStyleOf,
} from "./chapterBlockTree";
import { bookImageText } from "@shared/bookImageBlock";

const urls = ["/api/images/first.png", "/api/images/second.png"];
describe("book image insertion", () => {
  it("inserts ordered images at the cursor, preserves every character, styles and stable IDs through save/reopen", () => {
    const blocks = [newWritingBlock("甲乙丙丁"), newWritingBlock("尾段")];
    blocks[0].emphasis = "bright";
    const anchor = captureBookImageAnchor(blocks, blocks[0].id, 2);
    const result = insertBookImages(blocks, anchor, urls);
    expect(result.blocks.map(b => b.text)).toEqual([
      "甲乙",
      ...urls.map(url => bookImageText(url)),
      "丙丁",
      "尾段",
    ]);
    expect(result.blocks[0].id).toBe(blocks[0].id);
    expect(result.blocks[3].emphasis).toBe("bright");
    expect(result.blocks[4]).toBe(blocks[1]);
    expect(
      restoreStyledBlocks(
        blockBody(result.blocks),
        writingStyleOf(result.blocks)
      )
    ).toEqual(result.blocks);
    expect(blocks[0].text).toBe("甲乙丙丁");
  });
  it("rejects changed/deleted target text but preserves unrelated edits during upload", () => {
    const blocks = [newWritingBlock("原文"), newWritingBlock("尾段")];
    const anchor = captureBookImageAnchor(blocks, blocks[0].id, 1);
    expect(() =>
      insertBookImages(
        [{ ...blocks[0], text: "改稿" }, blocks[1]],
        anchor,
        urls
      )
    ).toThrow("文字已变化");
    expect(() => insertBookImages([blocks[1]], anchor, urls)).toThrow(
      "位置已变化"
    );
    expect(
      insertBookImages(
        [blocks[0], { ...blocks[1], text: "继续写" }],
        anchor,
        urls
      ).blocks.at(-1)?.text
    ).toBe("继续写");
  });
  it("handles start/end/empty paragraph, without deleting selected text or splitting math/media", () => {
    for (const text of ["", "甲乙"])
      for (const offset of [0, text.length]) {
        const block = newWritingBlock(text);
        const next = insertBookImages(
          [block],
          captureBookImageAnchor([block], block.id, offset),
          urls
        ).blocks;
        expect(next.filter(b => b.id === block.id)).toEqual([block]);
      }
    const math = newWritingBlock("公式 $x^2$ 结束");
    expect(captureBookImageAnchor([math], math.id, 5)).toEqual({
      kind: "edge",
      id: math.id,
      side: "after",
    });
  });
  it("inserts under open headings, after collapsed subtrees, and before visible children in their parent", () => {
    const heading = { ...newWritingBlock("标题"), format: "heading1" as const };
    const child = newWritingBlock("下文", heading.id),
      tail = newWritingBlock("尾段");
    const blocks = [heading, child, tail];
    const anchor = {
      kind: "edge" as const,
      id: heading.id,
      side: "after" as const,
    };
    expect(insertBookImages(blocks, anchor, urls).blocks[1].parentId).toBe(
      heading.id
    );
    const collapsed = insertBookImages(
      [{ ...heading, collapsed: true }, child, tail],
      anchor,
      urls
    ).blocks;
    expect(collapsed[2].text).toBe(bookImageText(urls[0]));
    expect(collapsed[2].parentId).toBeNull();
    const beforeChild = insertBookImages(
      blocks,
      { ...anchor, id: child.id, side: "before" },
      urls
    ).blocks;
    expect(beforeChild[1].parentId).toBe(heading.id);
  });
  it("chooses a visible drop edge including columns and the end of a page", () => {
    const boxes = [
      { id: "left", left: 10, right: 100, top: 10, bottom: 100 },
      { id: "right", left: 110, right: 200, top: 10, bottom: 100 },
    ];
    expect(bookImageDropAnchor(boxes, 150, 20)).toEqual({
      kind: "edge",
      id: "right",
      side: "before",
    });
    expect(bookImageDropAnchor(boxes, 20, 300)).toEqual({
      kind: "edge",
      id: "left",
      side: "after",
    });
  });
});
