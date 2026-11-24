import { expect, it } from "vitest";
import { wholeBookSoundText, narrationSegments, spokenBookDialogue } from "./bookSound";
import { bookAudioText } from "./bookAudioBlock";
it("separates an explicitly quoted voice-over from a shot direction without guessing at ordinary dialogue", () => {
  expect(spokenBookDialogue("画外音（回忆）：「雨停了吗？」画面切至窗外。")).toBe("雨停了吗？");
  expect(spokenBookDialogue("画外音继续：“等一等。”镜头拉远。")).toBe("等一等。");
  for (const text of ["她说：「我喜欢这个画面。」", "旁白：继续走。", "旁白：「来了。」她又说：「再等等。」", "旁白：「我想说「谢谢」。」"]) {
    expect(spokenBookDialogue(text)).toBe(text);
  }
});
it("reads all chapters in order, excludes media and never truncates long books", () => {
  const chapters = [
    {
      blocks: {
        body: "第一章\n![图](/a.png)\n" + bookAudioText(1, 2, "旧声音"),
      },
    },
    { blocks: { body: "末章" + "字".repeat(12000) } },
  ];
  const text = wholeBookSoundText(chapters, false);
  expect(text).toBe("第一章\n\n末章" + "字".repeat(12000));
  expect(narrationSegments(text).join("")).toBe(text);
  expect(narrationSegments(text).every(part => part.length <= 4800)).toBe(true);
});
it("reads only explicitly marked dialogue across every scene", () => {
  const style = (id: string, dialogue = false) => ({
    id,
    format: "text" as const,
    parentId: null,
    collapsed: false,
    ...(dialogue ? { videoRole: "dialogue" as const } : {}),
  });
  expect(
    wholeBookSoundText(
      [
        {
          blocks: {
            body: "镜头拉近\n我回来了",
            writingStyle: [style("a"), style("b", true)],
          },
        },
        {
          blocks: {
            body: "欢迎\n响起音乐",
            writingStyle: [style("c", true), style("d")],
          },
        },
      ],
      true
    )
  ).toBe("我回来了\n\n欢迎");
  const text = "字".repeat(4799) + "😀" + "尾";
  expect(narrationSegments(text).join("")).toBe(text);
  expect(narrationSegments(text)[0]).toHaveLength(4799);
});
