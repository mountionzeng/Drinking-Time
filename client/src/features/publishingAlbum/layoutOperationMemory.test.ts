import { describe, expect, it } from "vitest";
import {
  newTextModule,
  newImageModule,
  replaceModule,
  moveModuleToPage,
  insertModulePage,
  deleteModulePage,
  transformModule,
  type ModuleDocument,
} from "./imagePackModules";
import {
  layoutMemoryKey,
  readLayoutMemory,
  recordLayoutOperation,
  markLayoutOperation,
  layoutMemoryContext,
  describeLayoutOperation,
} from "./layoutOperationMemory";
import {
  layoutMemoryContextSchema,
  layoutMemoryDescription,
} from "@shared/layoutOperationMemory";

const text = newTextModule("text", "原文", (_, size) => size);
const image = newImageModule("image", "/private-original.png", {
  width: 800,
  height: 600,
});
const original: ModuleDocument = {
  version: 1,
  pages: [
    { label: "封面", modules: [image, text] },
    { label: "正文", modules: [] },
  ],
};
const style = replaceModule(original, 0, {
  ...text,
  emphasis: "bright",
  backdrop: true,
});

describe("passive layout operation memory", () => {
  it("records completed actions without chatting and survives reload in an account/story key", () => {
    const events = recordLayoutOperation([], "source1", original, style, {
      kind: "style",
      moduleId: text.id,
      page: 0,
    });
    expect(events[0].summary).toContain("加粗浅色字、有半透明底色");
    const key = layoutMemoryKey(1, 7);
    const saved = JSON.stringify(events);
    const storage = {
      getItem: (target: string) => (target === key ? saved : null),
    };
    expect(readLayoutMemory(storage, key)).toEqual(events);
    expect(readLayoutMemory(storage, layoutMemoryKey(2, 7))).toEqual([]);
    expect(readLayoutMemory(storage, layoutMemoryKey(1, 8))).toEqual([]);
    expect(saved).not.toContain("private-original");
    expect(saved).not.toContain("base64");
  });
  it("ignores no-ops and marks the original action undone/redone without adding positive preference examples", () => {
    expect(
      recordLayoutOperation([], "s", original, structuredClone(original), {
        kind: "move",
        page: 0,
      })
    ).toEqual([]);
    const events = recordLayoutOperation([], "s", original, style, {
      kind: "style",
      moduleId: text.id,
      page: 0,
    });
    const undone = markLayoutOperation(events, "s", style, original, true);
    expect(undone).toHaveLength(1);
    expect(undone[0].undone).toBe(true);
    expect(
      layoutMemoryDescription(layoutMemoryContext(undone, 7, "s"))
    ).toContain("已撤销的尝试");
    expect(
      markLayoutOperation(undone, "s", original, style, false)[0].undone
    ).toBe(false);
    expect(
      markLayoutOperation(events, "different-source", style, original, true)
    ).toBe(events);
  });
  it("keeps undone explorations after branching and separates versions", () => {
    const events = recordLayoutOperation([], "s", original, style, {
      kind: "style",
      moduleId: text.id,
      page: 0,
    });
    const undone = markLayoutOperation(events, "s", style, original, true);
    const moved = replaceModule(
      original,
      0,
      transformModule(text, "move", 30, 50)
    );
    const branched = recordLayoutOperation(undone, "s", original, moved, {
      kind: "move",
      moduleId: text.id,
      page: 0,
    });
    expect(branched.map(event => event.undone)).toEqual([true, false]);
    const context = layoutMemoryContext(branched, 7, "new-source");
    expect(context.recent.every(item => !item.sameSource)).toBe(true);
    expect(layoutMemoryContextSchema.safeParse(context).success).toBe(true);
  });
  it("describes content, cross-page, crop, sizing and page operations, while limiting text excerpts", () => {
    const nudged = replaceModule(
      original,
      0,
      transformModule(text, "move", 1, 0)
    );
    const nudge = describeLayoutOperation(original, nudged, {
      kind: "move",
      moduleId: text.id,
      page: 0,
    });
    const [from, to] = nudge.split("移动：")[1].replace(/。$/, "").split(" → ");
    expect(from).not.toEqual(to);
    const revised = replaceModule(original, 0, {
      ...text,
      text: "新文字".repeat(1000),
    });
    expect(
      describeLayoutOperation(original, revised, {
        kind: "text",
        moduleId: text.id,
        page: 0,
      })
    ).toContain("由「原文」改为");
    expect(
      describeLayoutOperation(original, revised, {
        kind: "text",
        moduleId: text.id,
        page: 0,
      }).length
    ).toBeLessThan(300);
    expect(
      describeLayoutOperation(
        original,
        moveModuleToPage(original, 0, image.id, 1),
        { kind: "move-page", moduleId: image.id, page: 0 }
      )
    ).toContain("从第 1 页移到第 2 页");
    expect(
      describeLayoutOperation(
        original,
        replaceModule(original, 0, transformModule(image, "left", 20, 0)),
        { kind: "crop", moduleId: image.id, page: 0 }
      )
    ).toContain("裁切");
    expect(
      describeLayoutOperation(
        original,
        replaceModule(original, 0, transformModule(text, "se", 20, 20)),
        { kind: "resize", moduleId: text.id, page: 0 }
      )
    ).toContain("缩放");
    expect(
      describeLayoutOperation(original, insertModulePage(original, 1), {
        kind: "insert-page",
        page: 1,
      })
    ).toContain("从2页变成3页");
    expect(
      describeLayoutOperation(original, deleteModulePage(original, 1), {
        kind: "delete-page",
        page: 1,
      })
    ).toContain("从2页变成1页");
  });
  it("bounds saved history and chat context independently and tolerates corrupt storage", () => {
    let events = [] as ReturnType<typeof readLayoutMemory>;
    for (let i = 0; i < 120; i++)
      events = recordLayoutOperation(events, "s", original, style, {
        kind: "style",
        moduleId: text.id,
        page: 0,
      });
    expect(events).toHaveLength(100);
    expect(layoutMemoryContext(events, 7, "s").recent).toHaveLength(20);
    expect(readLayoutMemory({ getItem: () => "bad json" }, "key")).toEqual([]);
    expect(
      readLayoutMemory(
        {
          getItem: () => {
            throw new Error("disabled");
          },
        },
        "key"
      )
    ).toEqual([]);
  });
});
