import { describe, expect, it, vi } from "vitest";
import { scrollToLatestChatTurn } from "./chatMessageScroll";

function surface() {
  const scroller = {
    scrollTop: 0, clientHeight: 400, scrollHeight: 9000,
    getBoundingClientRect: () => ({ top: 100 }),
    scrollTo: vi.fn(({ top }: { top: number }) => { scroller.scrollTop = top; }),
  };
  const element = (top: number, height: number, textHeight = height) => ({
    getBoundingClientRect: () => ({ top: 100 + top - scroller.scrollTop, bottom: 100 + top + height - scroller.scrollTop }),
    querySelector: (selector: string) => selector === '[data-chat-message-text]' ? ({ getBoundingClientRect: () => ({ top: 100 + top - scroller.scrollTop, bottom: 100 + top + textHeight - scroller.scrollTop }) }) : null,
  } as unknown as HTMLElement);
  const run = (nodes: Map<string, HTMLElement>, messages: Parameters<typeof scrollToLatestChatTurn>[2], queue?: Parameters<typeof scrollToLatestChatTurn>[3]) =>
    scrollToLatestChatTurn(scroller as unknown as HTMLElement, nodes, messages, queue);
  const visible = (node: HTMLElement, text = false) => {
    const rect = (text ? node.querySelector('[data-chat-message-text]')! : node).getBoundingClientRect();
    return rect.top >= 100 && rect.bottom <= 500;
  };
  return { scroller, element, run, visible };
}
const user = { id: "u", role: "user", timestamp: 1 };
const reply = { id: "a", role: "assistant", timestamp: 3 };

describe("following the latest chat turn", () => {
  it("keeps a sent plain message visible even when a large old gallery follows it", () => {
    const s = surface(); const node = s.element(1500, 60);
    s.run(new Map([["u", node]]), [user]);
    expect(s.visible(node)).toBe(true);
    expect(s.scroller.scrollTop).toBeLessThan(1600);
  });
  it("shows both the request and a short response", () => {
    const s = surface(); const u = s.element(1500, 60); const a = s.element(1570, 150);
    s.run(new Map([["u", u], ["a", a]]), [user, reply]);
    expect(s.visible(u)).toBe(true); expect(s.visible(a)).toBe(true);
  });
  it("keeps the request and reply text visible above oversized region previews", () => {
    const s = surface(); const u = s.element(1500, 60); const a = s.element(1570, 1100, 120);
    const nodes = new Map([["u", u], ["a", a]]);
    s.run(nodes, [user, reply]);
    expect(s.visible(u)).toBe(true); expect(s.visible(a, true)).toBe(true);
    // A late image load may enlarge the preview, but not move the conversation away.
    nodes.set("a", s.element(1570, 1800, 120));
    s.run(nodes, [user, reply]);
    expect(s.visible(u)).toBe(true); expect(s.visible(nodes.get("a")!, true)).toBe(true);
  });
  it("starts a long response at its text instead of at the bottom of its attachments", () => {
    const s = surface(); const a = s.element(1570, 1800, 600);
    s.run(new Map([["a", a]]), [reply]);
    expect(a.getBoundingClientRect().top).toBe(112);
  });
  it("shows a newly queued message while an earlier request is still running", () => {
    const s = surface(); const u = s.element(1500, 60); const q = s.element(5000, 60);
    s.run(new Map([["u", u], ["q", q]]), [user], [{ id: "q", createdAt: 2 }]);
    expect(s.visible(q)).toBe(true);
  });
  it("returns to a newer response, not an older queued message", () => {
    const s = surface(); const a = s.element(1570, 160); const q = s.element(5000, 60);
    s.run(new Map([["a", a], ["q", q]]), [user, reply], [{ id: "q", createdAt: 2 }]);
    expect(s.visible(a)).toBe(true);
  });
  it("does not fall back to unrelated old assets if there is no mounted message", () => {
    const s = surface(); s.scroller.scrollTop = 200;
    s.run(new Map(), [reply]);
    expect(s.scroller.scrollTo).not.toHaveBeenCalled();
  });
  it("shows a finished comparison directly, ahead of other pending region previews", () => {
    const s = surface(); const a = s.element(1500, 1600, 60); const result = s.element(1700, 180);
    const getText = a.querySelector.bind(a);
    a.querySelector = ((selector: string) => selector === '[data-chat-result-preview]' ? result : getText(selector)) as typeof a.querySelector;
    s.run(new Map([["a", a]]), [reply]);
    expect(s.visible(result)).toBe(true);
    expect(s.scroller.scrollTop).toBeLessThan(1900);
  });
});
