import { describe, it, expect } from "vitest";
import { relevantPagePassage } from "../../shared/bookPageReading";
import { printedPage } from "./bookPageOcr";
import { pagesAsSources } from "./manuscriptPageReadings";
import { readBookPage } from "./bookPageReading";
import type { ManuscriptContent } from "../../shared/bookWorkflow";
import type { ShotTextTrial } from "../../shared/shotTextTrial";
describe("reading scanned originals", () => {
  const lines = Array.from({ length: 14 }, (_, i) => ({
    text: "秋天，大家在桂花树下记录花开的日期。",
    confidence: 0.98,
    y: 0.86 - i * 0.04,
  }));
  it("keeps the printed page number and distinguishes a mixed photo page", () => {
    const number = { text: "-32-", confidence: 0.99, y: 0.1 };
    expect(printedPage([...lines, number])).toMatchObject({
      page: "32",
      textPage: true,
    });
    expect(
      printedPage([...lines.slice(0, 2), ...lines.slice(9), number]).textPage
    ).toBe(false);
    expect(printedPage([lines[0]]).textPage).toBe(false);
  });
  it("uses only the source matching the book and page, not near names or creative drafts", async () => {
    const row = {
      id: "a",
      source: "《花期》",
      state: "source",
      text: "第32页：桂花树在秋天开花。",
    } as ShotTextTrial;
    const result = await readBookPage({
      owner: 9,
      url: "/uploads/page.png",
      caption: "第32页《花期》",
      ownedImport: false,
      sources: [
        row,
        { ...row, state: "reference", text: "第32页：外来推测。" },
        { ...row, source: "《果树》", text: "第32页：另一部书。" },
      ],
    });
    expect(result).toEqual({
      label: "《花期》第32页",
      origin: "资料摘录",
      text: "桂花树在秋天开花。",
    });
    expect(
      await readBookPage({
        owner: 9,
        url: "https://example.com/private",
        caption: "书页扫描",
        ownedImport: false,
        sources: [],
      })
    ).toMatchObject({ origin: "待核对", text: "" });
  });
  it("selects a relevant complete sentence and leaves original media and modules in the saved chapter", () => {
    const text = "九月天晴。她第一次闻到桂花香。后来风大了。";
    expect(relevantPagePassage(text, "桂花香")).toBe("她第一次闻到桂花香。");
    expect(relevantPagePassage("没有句号的首行\n桂花香", "首行")).toBe(
      "没有句号的首行"
    );
    const body =
      "花香\n![图片](/api/images/page.png)\n![图片](/api/images/tree.png)";
    const chapter = {
      title: "秋日",
      layout: null,
      blocks: { body },
    } as ManuscriptContent;
    const [input] = pagesAsSources(
      [chapter],
      [
        {
          url: "/api/images/page.png",
          reading: { label: "第32页", origin: "本机识字", text },
        },
      ]
    );
    expect(input.blocks.body).toContain(text);
    expect(input.blocks.body).not.toContain("page.png");
    expect(input.blocks.body).toContain("tree.png");
    expect(chapter.blocks.body).toBe(body);
  });
});
