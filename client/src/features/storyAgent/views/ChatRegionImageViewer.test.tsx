import React from "react";
import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ setOpen: vi.fn() }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useState: () => [false, h.setOpen], useRef: () => ({ current: null }) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: "dialog-root", DialogContent: "dialog-content", DialogDescription: "dialog-description", DialogTitle: "dialog-title", DialogTrigger: "dialog-trigger" }));
import { ChatRegionImageViewer } from "./ChatRegionImageViewer";
const source = { storyId: 7, stableShotId: "shot", shotNo: 3, imageId: 1, imageUrl: "/api/images/source.png" };
const candidate = { ...source, imageId: 2, imageUrl: "/api/images/candidate.png" };
const pictures = [{ url: source.imageUrl, label: "Source #1", frame: source }, { url: candidate.imageUrl, label: "Candidate #2", frame: candidate }];
function nodes(tree: any): any[] { return !tree || typeof tree !== "object" ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)]; }
afterEach(() => { vi.unstubAllGlobals(); h.setOpen.mockReset(); });
it("returns the exact candidate to the chat only when the user chooses feedback, after the modal closes", () => {
  vi.stubGlobal("React", React);
  const feedback = vi.fn();
  const tree = ChatRegionImageViewer({ pictures, en: true, enabled: true, onFeedback: feedback });
  const content = nodes(tree).find(n => n.type === "dialog-content");
  const event = { preventDefault: vi.fn() };
  content.props.onCloseAutoFocus(event);
  expect(feedback).not.toHaveBeenCalled();
  nodes(tree).find(n => n.type === "button" && n.props.children === "Reply about #2 in chat").props.onClick();
  expect(h.setOpen).toHaveBeenCalledWith(false);
  expect(feedback).not.toHaveBeenCalled();
  content.props.onCloseAutoFocus(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(feedback).toHaveBeenCalledTimes(1); expect(feedback).toHaveBeenCalledWith(candidate);
  content.props.onCloseAutoFocus(event);
  expect(feedback).toHaveBeenCalledTimes(1);
});
it("disables a former story's viewer and does not send feedback into the current story", () => {
  vi.stubGlobal("React", React);
  const feedback = vi.fn();
  const tree = ChatRegionImageViewer({ pictures, en: true, enabled: false, onFeedback: feedback });
  expect(tree.props.open).toBe(false);
  expect(nodes(tree).find(n => n.type === "button").props.disabled).toBe(true);
  nodes(tree).find(n => n.type === "button" && n.props.children === "Reply about #2 in chat").props.onClick();
  nodes(tree).find(n => n.type === "dialog-content").props.onCloseAutoFocus({ preventDefault: vi.fn() });
  expect(feedback).not.toHaveBeenCalled();
});
