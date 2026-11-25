import { describe, expect, it } from "vitest";
import { creativeChatDirection, discussesNewWork, initialPurposeQuestion, isPurposeReply, requestsCreativeWork, requestsStoryFilm, startsCreativeConversation } from "./creativeConversation";

describe("conversation before and after a request to create", () => {
  it.each(["生成视频", "我想做个视频", "把这个故事做成短片", "帮我把书稿拍成一部纪录片", "Generate a video from this story", "turn this story into a short film", "我想要一个视频", "给我做一条视频", "请把这段故事做成短片，给家人看。", "帮我生成一段关于外公的短视频", "我希望你帮我做一个三分钟的视频", "可以把这个故事做成短片吗？", "Could you make a video?"])("opens a film manuscript for %s", message => expect(requestsStoryFilm(message)).toBe(true));
  it.each(["我不想做视频", "如果要做个视频呢？", "他说“生成视频”。", "帮我生成第03镜的视频", "用这张图生成视频", "生成视频字幕", "生成音乐", "请问怎么做视频", "我想生成视频的封面", "我想写一篇关于生成视频的文章", "给我生成音乐配视频", "生成视频的教程", "帮我生成视频的配乐", "朋友说，帮我做一段视频", "create a poster for the film", "make a video soundtrack"])("keeps other chat intents for %s", message => expect(requestsStoryFilm(message)).toBe(false));
  it.each(["今天看到爸爸把伞往我这边挪了挪。", "长辈想做个短片，我自己更在意那次选择。",
    "他说“我想做个视频”。", "朋友说，想做个视频。", "写过一首歌，后来忘了词。", "如果要写成文章，我还得先问问她。", "我还不想拍短片。", "做音乐的时候我认识了她。"])(
    "leaves the purpose open for %s", message => expect(requestsCreativeWork(message)).toBe(false)
  );
  it.each(["我想用这段经历写篇文章", "帮我把刚才这件事写出来。", "我想作首歌送给爸爸", "我想把照片整理成绘本", "I want to compose a song for my dad"])(
    "recognizes the author's request in %s", message => expect(requestsCreativeWork(message)).toBe(true)
  );
  it("asks about a bare medium once and keeps the answer attached to that question", () => {
    const request = "我想做个视频";
    const question = initialPurposeQuestion(request)!;
    expect(question).toBe("你希望看完这条片子的人记住什么？");
    const history = [{ role: "user", content: request }, { role: "assistant", content: question }];
    expect(isPurposeReply("我想让孩子记住外公推车的样子。", history)).toBe(true);
    expect(isPurposeReply("还没想好，先聊聊。", history)).toBe(false);
    expect(isPurposeReply("好的", history)).toBe(false);
    expect(isPurposeReply("我想让孩子记住外公推车的样子。", history.slice(1))).toBe(false);
    expect(initialPurposeQuestion("帮我生成一段关于外公的短视频")).toBeUndefined();
    expect(initialPurposeQuestion("Generate a video")).toBe(question);
    expect(isPurposeReply("给爸爸看", [{ role: "user", content: "我想要一个视频" }, { role: "assistant", content: question }])).toBe(true);
    expect(initialPurposeQuestion("我想作首歌送给爸爸")).toBeUndefined();
  });
  it("leaves target-specific editing on its existing route", () => {
    expect(discussesNewWork("我想制作一段音乐，在爷爷生日那天放")).toBe(true);
    expect(discussesNewWork("我想把第3镜做成视频")).toBe(false);
    expect(discussesNewWork("我想给整本书生成音乐")).toBe(false);
    expect(startsCreativeConversation("帮我生成一篇文章", false)).toBe(true);
    expect(startsCreativeConversation("帮我生成一篇文章", true)).toBe(false);
    expect(startsCreativeConversation("我想生成一张图片", true)).toBe(false);
    expect(creativeChatDirection("随着这句旁白，让画面慢一点")).toContain("可能要调整的是画面。");
  });
});
