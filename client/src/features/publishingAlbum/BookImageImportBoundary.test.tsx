import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  refs: [] as any[],
  ref: 0,
  upload: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useRef: (value: any) => {
    const index = mock.ref++;
    return mock.refs[index] ?? (mock.refs[index] = { current: value });
  },
  useEffect: () => {},
  useState: (value: any) => [value, vi.fn()],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    creationAgent: {
      importStoryMaterial: {
        useMutation: () => ({ mutateAsync: mock.upload }),
      },
    },
    useUtils: () => ({
      storyAgent: {
        storyMaterialState: { invalidate: mock.invalidate },
        storyImages: { invalidate: mock.invalidate },
      },
    }),
  },
}));
vi.mock("@/lib/imageUpload", () => ({
  blobToBase64: async (file: File) => file.name,
}));
vi.mock("sonner", () => ({ toast: { error: mock.toast, info: mock.toast } }));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({
  useUiText:
    () =>
    (text: string, values: unknown[] = []) =>
      text.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)])),
}));
import { BookImageImportBoundary } from "./BookImageImportBoundary";
import { newWritingBlock } from "./chapterBlockTree";
beforeEach(() => {
  mock.refs = [];
  mock.ref = 0;
  vi.clearAllMocks();
  mock.invalidate.mockResolvedValue(undefined);
  mock.upload.mockResolvedValue({
    status: "ok",
    kind: "image",
    imageUrl: "/api/images/one.png",
  });
  vi.stubGlobal("React", React);
  vi.stubGlobal("HTMLTextAreaElement", class {});
});
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  const props = {
    storyId: 7,
    scope: "a",
    disabled: false,
    blocks: [newWritingBlock("原文")],
    activeId: null,
    onInsert: vi.fn(),
    children: null,
  };
  const draw = () => {
    mock.ref = 0;
    return BookImageImportBoundary(props).props;
  };
  const event = () => ({
    target: {},
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    clipboardData: {
      files: [new File(["bytes"], "one.png", { type: "image/png" })],
      items: [],
      getData: () => "",
    },
  });
  return { props, draw, event };
}
it("imports once, refreshes the captured story warehouse and inserts at the original target", async () => {
  const { props, draw, event } = setup();
  const handlers = draw(),
    paste = event();
  handlers.onPasteCapture(paste);
  handlers.onPasteCapture(event());
  await settle();
  expect(mock.upload).toHaveBeenCalledTimes(1);
  expect(mock.upload.mock.calls[0][0]).toMatchObject({
    storyId: 7,
    fileName: "one.png",
  });
  expect(mock.invalidate).toHaveBeenCalledWith({ storyId: 7 });
  expect(props.onInsert).toHaveBeenCalledWith(
    { kind: "edge", id: props.blocks[0].id, side: "after" },
    ["/api/images/one.png"]
  );
  expect(paste.preventDefault).toHaveBeenCalled();
});
it("does not insert into another story when an upload finishes late", async () => {
  const { props, draw, event } = setup();
  let resolve!: (result: unknown) => void;
  mock.upload.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  draw().onPasteCapture(event());
  await settle();
  props.storyId = 8;
  props.scope = "b";
  draw();
  resolve({ status: "ok", kind: "image", imageUrl: "/api/images/one.png" });
  await settle();
  expect(props.onInsert).not.toHaveBeenCalled();
  expect(mock.invalidate).toHaveBeenCalledWith({ storyId: 7 });
});
it("keeps ordinary text paste native and prevents image upload in a disabled editor", async () => {
  const { props, draw, event } = setup();
  const plain = event();
  plain.clipboardData.files = [];
  draw().onPasteCapture(plain);
  expect(plain.preventDefault).not.toHaveBeenCalled();
  props.disabled = true;
  draw().onPasteCapture(event());
  await settle();
  expect(mock.upload).not.toHaveBeenCalled();
  expect(props.onInsert).not.toHaveBeenCalled();
});

it("does not capture paste inside a portalled music or conversion dialog", async () => {
  const { draw, event } = setup();
  const handlers = draw();
  mock.refs[0].current = { contains: () => false };
  const paste = event();
  handlers.onPasteCapture(paste);
  await settle();
  expect(paste.preventDefault).not.toHaveBeenCalled();
  expect(mock.upload).not.toHaveBeenCalled();
});

it("imports a multi-file drop once and leaves ordinary HTML text drops alone", async () => {
  const { props, draw, event } = setup();
  const plain = {
    dataTransfer: {
      types: ["text/html"],
      files: [],
      items: [],
      getData: () => "",
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  draw().onDrop(plain);
  expect(plain.preventDefault).not.toHaveBeenCalled();
  const paste = event();
  paste.clipboardData.files.push(
    new File(["bytes"], "two.png", { type: "image/png" })
  );
  draw().onDrop({
    ...plain,
    dataTransfer: { ...paste.clipboardData, types: ["Files"] },
  });
  await settle();
  expect(mock.upload).toHaveBeenCalledTimes(2);
  expect(props.onInsert).toHaveBeenCalledTimes(1);
  expect(props.onInsert.mock.calls[0][1]).toHaveLength(2);
});
