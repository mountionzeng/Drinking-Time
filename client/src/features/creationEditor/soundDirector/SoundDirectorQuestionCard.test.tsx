import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SoundDirectorQuestionCard } from "./SoundDirectorQuestionCard";

vi.stubGlobal("React", React);

describe("SoundDirectorQuestionCard", () => {
  it("shows one grounded question, progress, choices and the free-input path", () => {
    const html = renderToStaticMarkup(
      <SoundDirectorQuestionCard
        director={
          {
            active: true,
            pending: false,
            session: {
              workspace: { revision: 2 },
              complete: false,
              question: {
                id: "global-direction",
                category: "global",
                prompt: "这版声音最重要的原则是什么？",
                why: "后续问题会沿用这个原则。",
                sourceText: "故事发生在雨夜的室内",
                evidence: [],
                options: [
                  {
                    id: "faithful",
                    label: "忠于原始故事",
                    value: "忠于原始故事",
                    evidenceIds: ["story:1"],
                  },
                ],
                freeTextAllowed: true,
              },
              interview: {
                questions: [{ id: "global-direction" }, { id: "ambience" }],
                currentStepIndex: 0,
                reviewSuggestions: [],
                evidenceChanged: false,
              },
            },
            answer: vi.fn(),
            goBack: vi.fn(),
            exit: vi.fn(),
          } as never
        }
      />
    );
    expect(html).toContain("声音导演");
    expect(html).toContain("1/2");
    expect(html).toContain("忠于原始故事");
    expect(html).toContain("依据：故事发生在雨夜的室内");
    expect(html).toContain("直接在下方聊天框说自己的答案");
  });
});
