import { describe, it, expect } from "vitest";
import { bookAudioText, readBookAudio } from "./bookAudioBlock";
describe("book audio references", () => {
  it("round trips labels without allowing new blocks or external URLs", () => {
    const title = "钢琴 [一]\n雨天";
    const value = bookAudioText(1, 2, title);
    expect(value.split("\n")).toHaveLength(1);
    expect(readBookAudio(value)).toMatchObject({
      storyId: 1,
      assetId: 2,
      title,
    });
    expect(readBookAudio("![音乐:x](https://evil.example/a.mp3)")).toBeNull();
    expect(readBookAudio("![音乐:%](\/api/story-audio-asset/1/2)")).toBeNull();
    expect(() => bookAudioText(-1, 2, "x")).toThrow();
  });
});
it('preserves audiobook classification across save and reload',()=>{
 expect(readBookAudio(bookAudioText(1,2,'雨天','narration'))).toMatchObject({kind:'narration',assetId:2,title:'雨天'});
 expect(readBookAudio(bookAudioText(1,2,'钢琴'))?.kind).toBe('music');
});
