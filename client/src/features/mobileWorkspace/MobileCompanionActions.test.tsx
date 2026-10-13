import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  setters: [] as ReturnType<typeof vi.fn>[],
  saveBody: vi.fn(),
  save: vi.fn(),
  revise: vi.fn(),
  upload: vi.fn(),
  invalidate: vi.fn(),
  cache: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const i = mock.cursor++;
      const value = i in mock.states ? mock.states[i] : initial;
      const setter = vi.fn();
      mock.setters[i] = setter;
      return [value, setter];
    },
    useRef: (value: unknown) => ({ current: value }),
  };
});
const content = { title: "旧稿", body: "原来的段落", tags: [] };
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      publishingDraft: {
        readBody: { setData: mock.cache },
        read: { invalidate: mock.invalidate },
      },
      memoryWarehouse: {
        list: { invalidate: mock.invalidate },
        forStory: { invalidate: mock.invalidate },
      },
      textDrafts: { read: { setData: mock.cache } },
      storyAgent: {
        storyImages: { invalidate: mock.invalidate },
        storyVideoAssets: { invalidate: mock.invalidate },
        storyMaterialState: { invalidate: mock.invalidate },
      },
    }),
    publishingDraft: {
      saveBody: { useMutation: () => ({ mutateAsync: mock.saveBody }) },
      readBody: {
        useQuery: () => ({
          data: {
            versionId: "pub1",
            platform: "xiaohongshu",
            bodyRevision: 3,
            body: "发布正文",
          },
        }),
      },
    },
    memoryWarehouse: {
      save: { useMutation: () => ({ mutateAsync: mock.save }) },
    },
    textDrafts: {
      revise: { useMutation: () => ({ mutateAsync: mock.revise }) },
      read: {
        useQuery: () => ({
          data: {
            revision: 4,
            versions: [
              {
                id: "v1",
                sequence: 1,
                generated: { title: "旧稿", body: "原来的段落", tags: [] },
              },
            ],
          },
        }),
      },
    },
    creationAgent: {
      importStoryMaterial: {
        useMutation: () => ({ mutateAsync: mock.upload }),
      },
    },
    storyAgent: {
      storyList: {
        useQuery: () => ({ data: { stories: [{ id: 7, title: "故事" }] } }),
      },
      storyMaterialState: { useQuery: () => ({ data: { shots: [] } }) },
    },
  },
}));
import { ActionEditor } from "./MobileCompanionActions";
function nodes(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function setup(
  mode: "memory" | "text" | "import",
  overrides: Record<number, unknown> = {}
) {
  mock.states = [];
  for (const [key, value] of Object.entries(overrides))
    mock.states[Number(key)] = value;
  const props = {
    mode,
    close: vi.fn(),
    storyId: 7,
    draft: "新想法",
    setDraft: vi.fn(),
    messages: [],
    disabled: false,
    onLocked: vi.fn(),
  };
  const tree = ActionEditor(props);
  const button = nodes(tree).find(
    n =>
      n.type === "button" &&
      ["保存记忆", "确认加入", "导入"].includes(n.props.children)
  );
  return { props, submit: button.props.onClick };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.cursor = 0;
  mock.setters = [];
  mock.save.mockResolvedValue({});
  mock.revise.mockResolvedValue({ versionId: "v2", history: { revision: 5 } });
});
it("marks the draft in its current story and refreshes both memory views", async () => {
  const { submit } = setup("memory");
  await submit();
  expect(mock.save).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceStoryId: 7,
      content: "新想法",
      origin: "user",
    })
  );
  expect(mock.invalidate).toHaveBeenCalledWith({ storyId: 7 });
});
it("appends to the chosen immutable text version using revision CAS", async () => {
  const { submit } = setup("text", { 1: "v1" });
  await submit();
  expect(mock.revise).toHaveBeenCalledWith(
    expect.objectContaining({
      storyId: 7,
      versionId: "v1",
      expectedRevision: 4,
      content: { ...content, body: "原来的段落\n\n新想法" },
    })
  );
  expect(mock.cache).toHaveBeenCalledWith({ storyId: 7 }, { revision: 5 });
});
it("keeps failure visible without reporting success or invalidating data", async () => {
  mock.save.mockRejectedValue(new Error("网络中断"));
  const { submit } = setup("memory");
  await submit();
  expect(mock.setters[7]).toHaveBeenCalledWith("网络中断");
  expect(mock.setters[9]).not.toHaveBeenCalledWith(true);
  expect(mock.invalidate).not.toHaveBeenCalled();
});
it("imports UTF-8 text into the existing draft without sending or uploading", async () => {
  const { props, submit } = setup("import", {
    6: {
      name: "notes.md",
      type: "text/plain",
      size: 12,
      text: async () => "补充内容",
    },
  });
  await submit();
  expect(props.setDraft).toHaveBeenCalledWith("新想法\n\n补充内容");
  expect(mock.upload).not.toHaveBeenCalled();
});
it("rejects oversized media before reading or uploading", async () => {
  const { submit } = setup("import", {
    6: { name: "photo.png", type: "image/png", size: 31 * 1024 * 1024 },
  });
  await submit();
  expect(mock.upload).not.toHaveBeenCalled();
  expect(mock.setters[7]).toHaveBeenCalledWith("图片不能超过 30MB。");
});
it("requires an explicit valid shot for video imports", async () => {
  const { submit } = setup("import", {
    6: { name: "clip.mp4", type: "video/mp4", size: 12 },
  });
  await submit();
  expect(mock.upload).not.toHaveBeenCalled();
  expect(mock.setters[7]).toHaveBeenCalledWith(
    expect.stringContaining("请先选择视频所属镜头")
  );
});
it("blocks duplicate submit while save is in flight", async () => {
  let resolve!: () => void;
  mock.save.mockReturnValue(
    new Promise<void>(r => {
      resolve = r;
    })
  );
  const { submit } = setup("memory");
  const pending = submit();
  await submit();
  expect(mock.save).toHaveBeenCalledTimes(1);
  resolve();
  await pending;
});

it("appends to publishing body using its own scope and CAS", async () => {
  mock.saveBody.mockResolvedValue({
    status: "saved",
    document: { body: "发布正文\n\n新想法" },
  });
  const { submit } = setup("text", { 1: "current" });
  await submit();
  expect(mock.saveBody).toHaveBeenCalledWith({
    storyId: 7,
    versionId: "pub1",
    platform: "xiaohongshu",
    baseBodyRevision: 3,
    body: "发布正文\n\n新想法",
  });
  expect(mock.revise).not.toHaveBeenCalled();
});
it("does not treat a publishing conflict as success", async () => {
  mock.saveBody.mockResolvedValue({ status: "conflict" });
  const { submit } = setup("text", { 1: "current" });
  await submit();
  expect(mock.cache).not.toHaveBeenCalled();
  expect(mock.setters[7]).toHaveBeenCalledWith(
    expect.stringContaining("正文已在其他地方更新")
  );
});

it("uploads images to the chosen story and checks domain errors", async () => {
  vi.stubGlobal(
    "FileReader",
    class {
      result = "data:image/png;base64,aGVsbG8=";
      onload: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    }
  );
  mock.upload.mockResolvedValue({ status: "error", error: "素材保存失败" });
  const { submit } = setup("import", {
    6: { name: "photo.png", type: "image/png", size: 5 },
  });
  await submit();
  expect(mock.upload).toHaveBeenCalledWith(
    expect.objectContaining({
      storyId: 7,
      fileBase64: "aGVsbG8=",
      targetStableShotId: null,
    })
  );
  expect(mock.setters[7]).toHaveBeenCalledWith("素材保存失败");
  expect(mock.invalidate).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

// These interaction tests invoke components with a lightweight hook harness.
vi.mock("@/features/uiLanguage/UiLanguage", async importOriginal => {
  const actual = await importOriginal<typeof import("@/features/uiLanguage/UiLanguage")>();
  return {...actual, useUiText: () => (source: string, values?: (string | number)[]) => actual.translateUi("zh", source, values)};
});
