import { describe, expect, it } from "vitest";
import {
  WRITING_EXPLORATION_CONTEXT,
  WRITING_TECHNIQUES,
} from "./writingTechniqueLibrary";

describe("literary perspectives for situated writing", () => {
  it("pairs each existing craft note with an editorial observation lens", () => {
    expect(new Set(WRITING_TECHNIQUES.map(card => card.id)).size).toBe(
      WRITING_TECHNIQUES.length
    );
    for (const card of WRITING_TECHNIQUES) {
      expect(card.perspective.length).toBeGreaterThan(0);
      expect(card.provenance).toContain("编辑解读，非引文");
      expect(WRITING_EXPLORATION_CONTEXT).toContain(card.perspective);
      // Conversation uses the general observation method, not author imitation
      // or an invented anecdote that could be mistaken for the user's life.
      expect(WRITING_EXPLORATION_CONTEXT).not.toContain(card.author);
      expect(WRITING_EXPLORATION_CONTEXT).not.toContain(card.example);
    }
  });

  it("opens a grounded path without imposing introspection or a creative goal", () => {
    expect(WRITING_EXPLORATION_CONTEXT).toContain("发生了什么");
    expect(WRITING_EXPLORATION_CONTEXT).toContain("现在怎样理解");
    expect(WRITING_EXPLORATION_CONTEXT).toContain("想表达什么可以在交流中逐渐出现");
    expect(WRITING_EXPLORATION_CONTEXT).toContain("不是必须依次完成的问卷");
    expect(WRITING_EXPLORATION_CONTEXT).toContain("只想记录");
    expect(WRITING_EXPLORATION_CONTEXT).toContain("不必每轮提问");
    expect(WRITING_EXPLORATION_CONTEXT).toContain("明确修改、生成或操作要求优先");
    expect(WRITING_EXPLORATION_CONTEXT).toContain("不能当成用户事实或已经认可的判断");
    expect(WRITING_EXPLORATION_CONTEXT.length).toBeLessThan(3000);
  });
});
