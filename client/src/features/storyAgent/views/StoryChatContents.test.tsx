import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/ui/popover", () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return { Popover: Wrapper, PopoverContent: Wrapper, PopoverTrigger: Wrapper };
});
import StoryChatContents, {
  storyChatHistoryEntries,
} from "./StoryChatContents";
import type { ChatMessage } from "../types";
const messages: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    content: "小时候下雨，爷爷在修伞",
    timestamp: 1790000000000,
  },
  {
    id: "a1",
    role: "assistant",
    content: "你还记得那把旧伞吗？",
    timestamp: 1790000001000,
  },
  {
    id: "u2",
    role: "user",
    content: "今天再去看那家铺子",
    timestamp: 1790003600000,
  },
];
describe("电脑故事聊天目录", () => {
  it("uses original user messages and separates sessions without summarizing", () => {
    const entries = storyChatHistoryEntries(messages, "");
    expect(entries).toHaveLength(2);
    expect(
      entries.flatMap(group => group.entries).map(message => message.id)
    ).toEqual(["u1", "u2"]);
    expect(entries[0].entries[0]).toBe(messages[0]);
  });
  it("searches both roles in the current story and retains the source", () => {
    const entries = storyChatHistoryEntries(messages, "旧伞");
    expect(entries).toHaveLength(1);
    expect(entries[0].entries).toEqual([messages[1]]);
    expect(entries[0].entries[0].role).toBe("assistant");
    expect(storyChatHistoryEntries(messages, "没有这句话")).toEqual([]);
  });
  it("keeps assistant-only sessions reachable", () => {
    expect(storyChatHistoryEntries([messages[1]], "")[0].entries).toEqual([
      messages[1],
    ]);
  });
  it("searches only visible assistant replies", () => {
    const reply = { ...messages[1], content: "<think>内部推理片段</think>还记得那把旧伞吗？" };
    expect(storyChatHistoryEntries([reply], "内部推理")).toEqual([]);
    expect(storyChatHistoryEntries([reply], "旧伞")[0].entries).toEqual([reply]);
    const html = renderToStaticMarkup(<StoryChatContents messages={[reply]} onLocate={() => {}} onLatest={() => {}} disabled={false} />);
    expect(html).not.toContain("内部推理");
    expect(html).toContain("小忆");
  });
  it("renders content tools and original quotes without sending or generating", () => {
    const locate = vi.fn();
    const latest = vi.fn();
    const html = renderToStaticMarkup(
      <StoryChatContents
        messages={messages}
        onLocate={locate}
        onLatest={latest}
        disabled={false}
      />
    );
    expect(html).toContain("聊天目录");
    expect(html).toContain("记事与文章来源");
    expect(html).toContain("小时候下雨，爷爷在修伞");
    expect(locate).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
  });
});
