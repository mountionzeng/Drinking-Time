import { expect, it } from "vitest";
import { pictureSourcePages, pageExcerpts } from "./pictureSourcePages";
import { pictureDirections } from "./stillVisualDescription";
import { shotOutputSource } from "./bookShotActions";

it("separates the author's page pointer and editorial motion from the frame sent for illustration", () => {
  const written =
    "画面提示词：第268页五人合影静止呈现，依次标出最左边的小林和最右边的小安。";
  const rows = [
    { id: "shot", format: "shot", parentId: null, text: "旧照片" },
    { id: "p", format: "text", parentId: "shot", text: written },
  ];
  expect(shotOutputSource(rows, 1, "image")).toMatchObject({
    prompt: "五人合影，最左边的小林和最右边的小安。",
    parts: [{ id: "p", text: written }],
  });
  expect(pictureDirections(written).motion).toContain("依次标出");
  const raw = "《城市记忆》第 267 页的原书照片。\n纸上写着“第 268 页”。";
  const projected = pictureSourcePages(raw);
  expect(projected.pages).toEqual([
    { page: "267", label: "《城市记忆》第267页", title: "城市记忆" },
  ]);
  expect(raw.slice(projected.leading)).toBe(projected.text);
  expect(projected.text).toBe("原书照片。\n纸上写着“第 268 页”。");
  expect(pictureSourcePages("第268页").text).toBe("");
  expect(pictureSourcePages("纸角印着第8页。第80页的雕塑").text).toBe(
    "纸角印着第8页。雕塑"
  );
});

it("shows only the saved original page section including its continuation and exact book when named", () => {
  const sources = [
    {
      id: "a",
      state: "source",
      source: "《小路》摘录",
      text: "第26页：清晨\n第268页：五人合影。\n图注在下。\n第269页：下页。",
    },
    {
      id: "b",
      state: "reference",
      source: "《小路》候选",
      text: "第268页：外部猜测。",
    },
  ];
  expect(pageExcerpts(sources, "268", "小路")).toEqual([
    {
      id: "a",
      source: "《小路》摘录",
      text: "第268页：五人合影。\n图注在下。",
    },
  ]);
  expect(pageExcerpts(sources, "26", "其他书")).toEqual([]);
  expect(pageExcerpts(sources, "2")).toEqual([]);
  expect(pageExcerpts(sources, "二百六十八-二百六十九", "小路")[0].text).toBe(
    "第268页：五人合影。\n图注在下。\n\n第269页：下页。"
  );
  expect(
    pictureSourcePages(
      "参考素材：[《小路》第268页](https://example.org/book.pdf#page=268)的五人合影"
    ).text
  ).toBe("五人合影");
  expect(pictureSourcePages("出处：第268页。").text).toBe("");
});
