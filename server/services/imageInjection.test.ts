import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveInjection,
  deriveStoryboardReferenceInjection,
} from "./imageInjection";
import type { SceneAnalysis } from "../../shared/sceneAnalysis";

const mocks = vi.hoisted(() => ({
  toPublicImageUrl: vi.fn(async (url?: string) => url),
}));

vi.mock("./imageGen", () => ({
  toPublicImageUrl: mocks.toPublicImageUrl,
}));

function storyWithCharacter(imageUrl?: string) {
  return {
    body: {
      artDirection: {
        phase: "locked",
        references: imageUrl
          ? [
              {
                id: "character-1",
                label: "主角",
                source: "visual-anchor",
                purpose: "fact",
                selected: true,
                role: "character",
                imageUrl,
              },
            ]
          : [],
      },
    },
  };
}

const personAnalysis: SceneAnalysis = {
  subjectDescription: "主角在雨夜回头",
  isPerson: true,
  recurringCharacter: { key: "hero", name: "主角" },
  action: "回头",
  emotion: "犹豫",
  keyElements: ["雨夜", "路灯"],
  needsCharacterAnchor: true,
  confidence: 75,
};

const emptySceneAnalysis: SceneAnalysis = {
  subjectDescription: "雨后的空巷",
  isPerson: false,
  recurringCharacter: null,
  action: "积水反光",
  emotion: "清冷",
  keyElements: ["窄巷", "积水"],
  needsCharacterAnchor: false,
  confidence: 75,
};

describe("deriveInjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toPublicImageUrl.mockImplementation(async (url?: string) => url);
  });

  it("有锚点 + 人物镜头时返回 characterRef 和同图 styleRef", async () => {
    const imageUrl = "https://file.302.ai/hero.png";

    await expect(
      deriveInjection(storyWithCharacter(imageUrl), personAnalysis)
    ).resolves.toEqual({
      characterRef: imageUrl,
      characterWeight: 100,
      styleRef: imageUrl,
    });
  });

  it("有锚点 + 空镜时保留 characterRef，但不注入 styleRef", async () => {
    const imageUrl = "https://file.302.ai/hero.png";

    await expect(
      deriveInjection(storyWithCharacter(imageUrl), emptySceneAnalysis)
    ).resolves.toEqual({
      characterRef: imageUrl,
      characterWeight: 100,
    });
  });

  it("无 sceneAnalysis 时保持旧人物锁行为，注入 styleRef", async () => {
    const imageUrl = "https://file.302.ai/hero.png";

    await expect(
      deriveInjection(storyWithCharacter(imageUrl))
    ).resolves.toEqual({
      characterRef: imageUrl,
      characterWeight: 100,
      styleRef: imageUrl,
    });
  });

  it("无锚点时返回空注入", async () => {
    await expect(deriveInjection(storyWithCharacter())).resolves.toEqual({});
  });

  it("本地或 data URI 转公网失败时安全降级为空注入", async () => {
    mocks.toPublicImageUrl.mockResolvedValueOnce(undefined);

    await expect(
      deriveInjection(
        storyWithCharacter("data:image/png;base64,AAAA"),
        personAnalysis
      )
    ).resolves.toEqual({});
  });
});

describe("deriveStoryboardReferenceInjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toPublicImageUrl.mockImplementation(async (url?: string) => url);
  });

  it("没有故事人物锚点时，用选中的身份图锁人物、主参考图锁场景", async () => {
    await expect(
      deriveStoryboardReferenceInjection(storyWithCharacter(), {
        identityImageUrl: "/api/images/hero.webp",
        sceneImageUrl: "/api/images/gallery.webp",
        analysis: personAnalysis,
      })
    ).resolves.toEqual({
      characterRef: "/api/images/hero.webp",
      characterWeight: 100,
      styleRef: "/api/images/gallery.webp",
    });
  });

  it("当前故事版身份图优先于可能已经过时的故事人物锚点", async () => {
    await expect(
      deriveStoryboardReferenceInjection(
        storyWithCharacter("https://file.302.ai/locked-hero.png"),
        {
          identityImageUrl: "/api/images/temporary-person.webp",
          sceneImageUrl: "/api/images/red-gallery.webp",
          analysis: personAnalysis,
        }
      )
    ).resolves.toEqual({
      characterRef: "/api/images/temporary-person.webp",
      characterWeight: 100,
      styleRef: "/api/images/red-gallery.webp",
    });
  });

  it("明确为空镜时只锁场景，不把临时或故事级人物参考带进画面", async () => {
    await expect(
      deriveStoryboardReferenceInjection(
        storyWithCharacter("https://file.302.ai/locked-hero.png"),
        {
          identityImageUrl: "/api/images/hero.webp",
          sceneImageUrl: "/api/images/empty-alley.webp",
          analysis: emptySceneAnalysis,
        }
      )
    ).resolves.toEqual({
      styleRef: "/api/images/empty-alley.webp",
    });
  });

  it("故事版人物或场景锚点无法公网化时不回退到旧美术库", async () => {
    mocks.toPublicImageUrl.mockImplementation(async (url?: string) =>
      url?.startsWith("/api/images/") ? undefined : url
    );

    await expect(
      deriveStoryboardReferenceInjection(
        storyWithCharacter("https://file.302.ai/old-library-hero.png"),
        {
          identityImageUrl: "/api/images/current-hero.webp",
          sceneImageUrl: "/api/images/current-scene.webp",
          analysis: personAnalysis,
        }
      )
    ).resolves.toEqual({});
  });
});
