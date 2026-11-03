import { expect, it } from "vitest";
import { bookShareArticle, bookShareReading } from "./bookShareArticle";
import { bookImageText } from "@shared/bookImageBlock";
import { bookAudioText } from "@shared/bookAudioBlock";

it("shares current text without media access URLs, preserving blank lines and multiline formulas", () => {
  const text = "第一段\n\n$$\nx^2 + y^2 = z^2\n$$\n结尾";
  const article = bookShareArticle("当前标题", `${text}\n${bookImageText("/api/private-image")}\n${bookAudioText(1, 2, "音乐")}`, "wechat_moments");
  expect(article).toEqual({ title: "当前标题", body: text, platform: "wechat_moments", tags: [] });
});
it("rejects empty and audio-only manuscripts but allows pictures without prose", () => {
  for (const body of ["\n ", bookAudioText(1, 2, "音乐")])
    expect(() => bookShareArticle("标题", body)).toThrow("请先写好");
  expect(bookShareArticle("相册", bookImageText("/uploads/photo.png")).body).toBe("");
});

it("keeps images between their original paragraphs and reuses bytes for repeated pictures", () => {
  const photo = bookImageText("/api/images/a.png", {x:0.1,y:0,width:0.8,height:1});
  const result = bookShareReading(`开头\n${photo}\n中间\n${bookImageText("/api/images/b.png")}\n${photo}\n结尾`);
  expect(result.urls).toEqual(["/api/images/a.png", "/api/images/b.png"]);
  expect(result.reading.blocks.map(block => block.kind === "text" ? block.text : block.image)).toEqual(["开头",0,"中间",1,0,"结尾"]);
  expect(result.reading.blocks[1]).toMatchObject({crop:{x:0.1,y:0,width:0.8,height:1}});
  expect(JSON.stringify(result.reading)).not.toContain("/api/");
});
