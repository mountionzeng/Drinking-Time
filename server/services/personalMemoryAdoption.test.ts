import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  articleAdoptionCaptureIfEnabled,
  buildArticleAdoptionCapture,
  buildImageAdoptionCapture,
  imageAdoptionCaptureIfEnabled,
} from "./personalMemoryAdoption";
import { normalizePersonalMemoryEventIdentity } from "../../shared/personalMemory";

const previousAllowlist = process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;

afterEach(() => {
  if (previousAllowlist === undefined) {
    delete process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;
  } else {
    process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = previousAllowlist;
  }
});

function image(
  overrides: Partial<Parameters<typeof buildImageAdoptionCapture>[0]> = {}
) {
  return buildImageAdoptionCapture({
    userId: 7,
    storyId: 1186,
    imageId: 42,
    signalId: 900,
    context: {
      entry: "select_image",
      occurredAt: new Date("2026-09-03T02:00:00.000Z"),
    },
    ...overrides,
  });
}

function article(
  overrides: Partial<Parameters<typeof buildArticleAdoptionCapture>[0]> = {}
) {
  return buildArticleAdoptionCapture({
    userId: 7,
    storyId: 1186,
    versionId: "v3",
    operationToken: "op-token-abc",
    entry: "create_version",
    title: "写给九月的信",
    contentHash: "hash-1",
    occurredAt: new Date("2026-09-03T02:00:00.000Z"),
    ...overrides,
  });
}

describe("图片采用身份", () => {
  it("以权威 signal 行为修订与动作 ID", () => {
    const built = image();
    expect(built.identity.sourceType).toBe("image_adoption");
    expect(built.identity.sourceKey).toBe("image:42");
    expect(built.identity.sourceRevision).toBe("signal:900");
    expect(built.identity.actionKind).toBe("adopted");
    expect(() =>
      normalizePersonalMemoryEventIdentity(built.identity)
    ).not.toThrow();
  });

  // 撤销后再采用会产生新的 signal，因而是一条**新的**采用经历；
  // 历史那条不被改写。这正是「保留曾采用过」的实现方式。
  it("同一张图的两次采用各自成事件", () => {
    expect(image({ signalId: 900 }).identity.actionId).not.toBe(
      image({ signalId: 901 }).identity.actionId
    );
  });

  it("不同账号的同一张图不会相撞", () => {
    expect(image({ userId: 7 }).identity.userId).toBe(7);
    expect(image({ userId: 8 }).identity.userId).toBe(8);
  });

  // 私密图片不得通过公开静态地址交付（U7 的受保护媒体端点才行），
  // 所以事件里连能猜的路径都不许留。
  it("快照里没有图片字节、URL 或磁盘文件名", () => {
    const built = image();
    expect(built.snapshot.excerpt).toBeNull();
    expect(built.snapshot.contentHash).toBeNull();
    const serialized = JSON.stringify(built.snapshot);
    expect(serialized).not.toMatch(/\/api\/images\/|\/local-images|\.png|\.webp/);
  });

  it("记录采用入口，便于解释这条采用是从哪儿来的", () => {
    expect(image({ context: { entry: "swipe_right" } }).snapshot.display).toMatchObject(
      { entry: "swipe_right" }
    );
  });

  it("每条采用带一个与 signal 绑定的稳定 operation ID", () => {
    expect(image().job?.operationId).toBe("pm-image-7-900");
  });
});

describe("文章采用身份", () => {
  // 发布链路本来就有 operationToken 做幂等，所以这里能做到真正的
  // 「同一采用请求重试多次只产生一个事件」。
  it("以操作令牌为修订与动作 ID，重试幂等", () => {
    expect(article().identity.actionId).toBe(article().identity.actionId);
    expect(article({ operationToken: "op-a" }).identity.actionId).not.toBe(
      article({ operationToken: "op-b" }).identity.actionId
    );
  });

  it("冻结采用时的版本身份与内容哈希", () => {
    const built = article();
    expect(built.identity.sourceKey).toBe("publishing:1186:v3");
    expect(built.snapshot.contentHash).toBe("hash-1");
    expect(built.snapshot.display).toMatchObject({ versionId: "v3" });
  });

  it("只留安全的展示标题，不复制正文", () => {
    expect(article().snapshot.excerpt).toBe("写给九月的信");
    expect(article({ title: null }).snapshot.excerpt).toBeNull();
  });

  it("构造出的身份都能通过合同校验", () => {
    for (const built of [article(), article({ entry: "adopt_album_background" })]) {
      expect(() =>
        normalizePersonalMemoryEventIdentity(built.identity)
      ).not.toThrow();
    }
  });
});

describe("Phase 1 白名单门禁同样覆盖采用", () => {
  beforeEach(() => {
    delete process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;
  });

  it("默认全关：采用也不捕获", () => {
    expect(
      imageAdoptionCaptureIfEnabled({
        userId: 7,
        storyId: 1,
        imageId: 1,
        signalId: 1,
        context: { entry: "select_image" },
      })
    ).toBeNull();
    expect(
      articleAdoptionCaptureIfEnabled({
        userId: 7,
        storyId: 1,
        versionId: "v1",
        operationToken: "t",
        entry: "create_version",
        title: null,
        contentHash: null,
      })
    ).toBeNull();
  });

  it("列入白名单后才构造", () => {
    process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = "7";
    expect(
      imageAdoptionCaptureIfEnabled({
        userId: 7,
        storyId: 1,
        imageId: 1,
        signalId: 1,
        context: { entry: "select_image" },
      })
    ).not.toBeNull();
    expect(
      imageAdoptionCaptureIfEnabled({
        userId: 8,
        storyId: 1,
        imageId: 1,
        signalId: 1,
        context: { entry: "select_image" },
      })
    ).toBeNull();
  });
});
