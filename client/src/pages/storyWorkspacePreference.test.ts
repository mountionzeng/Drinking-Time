import { expect, it } from "vitest";
import { readStoryView, saveStoryView } from "./storyWorkspacePreference";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

it("restores each account and story independently, including the video subview", () => {
  const store = storage();
  saveStoryView(store, 1, 10, "workspace", "editing");
  saveStoryView(store, 1, 10, "video", "editing");
  saveStoryView(store, 1, 11, "workspace", "publishing");
  saveStoryView(store, 2, 10, "workspace", "images");
  expect(readStoryView(store, 1, 10, "workspace")).toBe("editing");
  expect(readStoryView(store, 1, 10, "video")).toBe("editing");
  expect(readStoryView(store, 1, 11, "workspace")).toBe("publishing");
  expect(readStoryView(store, 2, 10, "workspace")).toBe("images");
  expect(readStoryView(store, 2, 10, "video")).toBeNull();
});
it("ignores invalid saved values, unsaved drafts, and unavailable storage", () => {
  const store = storage();
  store.setItem("dt:story-view:1:10:workspace", "unknown");
  store.setItem("dt:story-view:1:10:video", "unknown");
  expect(readStoryView(store, 1, 10, "workspace")).toBeNull();
  expect(readStoryView(store, 1, 10, "video")).toBeNull();
  saveStoryView(store, 1, -1, "workspace", "editing");
  expect(readStoryView(store, 1, -1, "workspace")).toBeNull();
  expect(readStoryView(store, null, 10, "workspace")).toBeNull();
  const unavailable = {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("denied");
    },
  };
  expect(readStoryView(unavailable, 1, 10, "video")).toBeNull();
  expect(() =>
    saveStoryView(unavailable, 1, 10, "video", "plan")
  ).not.toThrow();
});
