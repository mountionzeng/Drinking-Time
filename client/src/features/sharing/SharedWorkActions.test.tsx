import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SharePermissions } from "./SharePermissions";
import { SharedWorkActions } from "./SharedWorkActions";
vi.stubGlobal("React", React);
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 2, loginMethod: "email" }, loading: false }) }));
vi.mock("@/lib/trpc", () => {
  const action = { useMutation: () => ({ isPending: false }) };
  return { trpc: { storyContextShare: { accept: action, contribute: action }, artworkShare: { accept: action, contribute: action } } };
});
const work = { platform: "xiaohongshu" as const, title: "作品", body: "分享正文", tags: [] };
describe("sharing controls", () => {
  it("defaults to reading with two independent optional permissions", () => {
    const html = renderToStaticMarkup(<SharePermissions value={{ rewrite: false, fork: false }} onChange={vi.fn()} />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).not.toContain("checked");
    expect(html).toContain("你确认后采用");
    expect(html).toContain("不包含你的记忆和聊天记录");
  });
  it.each(["story", "artwork"] as const)("only shows authorized %s actions", kind => {
    const render = (rewrite: boolean, fork: boolean) => renderToStaticMarkup(<SharedWorkActions kind={kind} token="token" permissions={{ rewrite, fork }} work={work} />);
    expect(render(false, false)).toBe("");
    expect(render(true, false)).toContain("拿来一起改");
    expect(render(true, false)).toContain("分享回给作者");
    expect(render(false, true)).toContain("拿来一起改");
    expect(render(false, true)).not.toContain("分享回给作者");
    expect(render(true, true)).not.toContain("帮作者改写");
  });
});
