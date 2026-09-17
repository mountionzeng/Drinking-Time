/** Persistence operations for images. Local and MySQL behavior share this boundary. */
import { eq, and, desc, inArray, isNull, or, sql } from "drizzle-orm";
import {
  stories,
  InsertGeneratedImage,
  generatedImages,
  GeneratedImage,
  InsertImageSignal,
  imageSignals,
  ImageSignal,
} from "../../drizzle/schema";
import {
  applyPersonalMemoryCapture,
  type PersonalMemoryCapture,
} from "../../shared/personalMemory";
import {
  ensureMemoryLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";
import { capturePersonalMemoryEvent } from "./memoryEvents";
import { resolvePromptCompilationIdForAsset } from "./assetLineage";

// ─── Generated Images（手机端） ─────────────────────────────────────────
// 手机端聊天出图的图片记录查询。createGeneratedImage 统一定义在下方桌面端部分。

export async function getGeneratedImageById(
  id: number
): Promise<GeneratedImage | null> {
  const db = await getDb();
  if (!db) {
    return memoryState.generatedImages.find(img => img.id === id) ?? null;
  }
  const [row] = await db
    .select()
    .from(generatedImages)
    .where(eq(generatedImages.id, id));
  return row ?? null;
}

export async function getStoryImages(
  storyId: number
): Promise<GeneratedImage[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.generatedImages
      .filter(img => img.storyId === storyId && img.isCurrent)
      .sort((a, b) => (a.shotNo ?? "").localeCompare(b.shotNo ?? ""));
  }
  return db
    .select()
    .from(generatedImages)
    .where(
      and(
        eq(generatedImages.storyId, storyId),
        eq(generatedImages.isCurrent, true)
      )
    )
    .orderBy(generatedImages.shotNo);
}

export async function getProjectGeneratedImages(
  projectId: number,
  userId: number
): Promise<GeneratedImage[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const storyIds = new Set(
      memoryState.stories
        .filter(
          story => story.projectId === projectId && story.userId === userId
        )
        .map(story => story.id)
    );
    return memoryState.generatedImages
      .filter(
        image =>
          (image.userId === userId || image.userId == null) &&
          (image.projectId === projectId ||
            (image.storyId != null && storyIds.has(image.storyId)))
      )
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );
  }

  const projectStories = await db
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, projectId), eq(stories.userId, userId)));
  const storyIds = projectStories.map(story => story.id);
  const ownership =
    storyIds.length > 0
      ? or(
          eq(generatedImages.projectId, projectId),
          inArray(generatedImages.storyId, storyIds)
        )
      : eq(generatedImages.projectId, projectId);

  return db
    .select()
    .from(generatedImages)
    .where(
      and(
        or(eq(generatedImages.userId, userId), isNull(generatedImages.userId)),
        ownership
      )
    )
    .orderBy(desc(generatedImages.createdAt));
}

// 按 storyId 取生成图片（故事为唯一单位）：每个故事的图片独立，故事间不共享。
// 带 userId 防越权。
export async function getStoryGeneratedImages(
  storyId: number,
  userId: number
): Promise<GeneratedImage[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.generatedImages
      .filter(
        image =>
          image.storyId === storyId &&
          (image.userId === userId || image.userId == null)
      )
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );
  }
  return db
    .select()
    .from(generatedImages)
    .where(
      and(
        eq(generatedImages.storyId, storyId),
        or(eq(generatedImages.userId, userId), isNull(generatedImages.userId))
      )
    )
    .orderBy(desc(generatedImages.createdAt));
}

export async function getGeneratedImageByStoryAndImageKey(
  storyId: number,
  userId: number,
  imageKey: string
): Promise<GeneratedImage | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.generatedImages.find(
        image =>
          image.storyId === storyId &&
          (image.userId === userId || image.userId == null) &&
          image.imageKey === imageKey
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(generatedImages)
    .where(
      and(
        eq(generatedImages.storyId, storyId),
        or(eq(generatedImages.userId, userId), isNull(generatedImages.userId)),
        eq(generatedImages.imageKey, imageKey)
      )
    )
    .limit(1);
  return row ?? null;
}

// ─── Image Signals ──────────────────────────────────────────────────────
// 用户交互信号（左划/右划/编辑等），时序事件流。

export async function createImageSignal(
  data: InsertImageSignal
): Promise<ImageSignal> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: ImageSignal = {
      id: nextMemoryId("imageSignal"),
      userId: data.userId,
      storyId: data.storyId,
      imageId: data.imageId ?? null,
      action: data.action,
      metadata: data.metadata ?? null,
      createdAt: current,
    };
    memoryState.imageSignals.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(imageSignals).values(data);
  const [row] = await db
    .select()
    .from(imageSignals)
    .where(eq(imageSignals.id, result.insertId));
  return row;
}

/**
 * Promote a story image and persist the explicit selection as one operation.
 * Image and video selections are independent layers.
 */
export async function promoteStoryImageToCurrent(data: {
  imageId: number;
  storyId: number;
  userId: number;
  expectedCurrentImageId?: number;
  metadata?: InsertImageSignal["metadata"];
  /**
   * 明确采用上下文（U3）。**只能由 router 边界显式传入。**
   *
   * 这个函数同时被用户点击和内部派生路径（生成后自动置为当前、恢复、
   * 批量迁移）调用，所以不传就是不记采用。特别注意：不要从 `metadata.source`
   * 反推——那字段是给排查用的，把它当采用凭据就是把自动行为伪造成用户选择。
   *
   * 回调形式是因为采用经历要用权威 `imageSignals` 行 ID 做身份，
   * 而那个 ID 得等 signal 在同一事务里插出来才知道。
   */
  adoption?: (signalId: number) => PersonalMemoryCapture | null;
}): Promise<{ image: GeneratedImage; signal: ImageSignal } | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const image = memoryState.generatedImages.find(
      candidate =>
        candidate.id === data.imageId &&
        candidate.storyId === data.storyId &&
        (candidate.userId === data.userId || candidate.userId == null)
    );
    if (!image) return null;
    if (data.expectedCurrentImageId != null) {
      const expected = memoryState.generatedImages.find(
        candidate =>
          candidate.id === data.expectedCurrentImageId &&
          candidate.storyId === data.storyId &&
          (candidate.userId === data.userId || candidate.userId == null)
      );
      const sameIdentity =
        image.shotIdentity != null &&
        expected?.shotIdentity === image.shotIdentity;
      const sameLegacyShot =
        image.shotNo != null &&
        expected?.shotNo === image.shotNo &&
        (image.shotIdentity == null || expected?.shotIdentity == null);
      if (!expected?.isCurrent || (!sameIdentity && !sameLegacyShot))
        return null;
    }

    for (const candidate of memoryState.generatedImages) {
      if (candidate.storyId !== data.storyId || !candidate.isCurrent) continue;
      const sameIdentity =
        image.shotIdentity != null &&
        candidate.shotIdentity === image.shotIdentity;
      const sameLegacyShot =
        image.shotNo != null &&
        candidate.shotNo === image.shotNo &&
        (image.shotIdentity == null || candidate.shotIdentity == null);
      if (sameIdentity || sameLegacyShot) candidate.isCurrent = false;
    }
    image.isCurrent = true;

    const signal: ImageSignal = {
      id: nextMemoryId("imageSignal"),
      userId: data.userId,
      storyId: data.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: data.metadata ?? null,
      createdAt: now(),
    };
    memoryState.imageSignals.push(signal);
    // 采用经历与 isCurrent 翻转、signal 一起进这一次 copy-on-write。
    // 图片与足迹索引同属 local-persist 聚合，所以不需要 outbox。
    const localAdoption = data.adoption?.(signal.id) ?? null;
    const previousPersonalMemory = localAdoption
      ? structuredClone(memoryState.personalMemory)
      : null;
    if (localAdoption) {
      applyPersonalMemoryCapture(memoryState.personalMemory, localAdoption);
    }
    try {
      await persistMemoryState();
    } catch (error) {
      // 落盘失败必须撤回这条采用经历。本函数其余内存态变更（isCurrent 翻转、
      // signal）沿用 db.ts 顶部记录的既有取舍——它们不回滚。但记忆层不能例外：
      // 留下一条「用户采用过」而实际没落盘的记录，会让来信去引用一个根本不存在
      // 的选择，事后也无从分辨真假。
      if (previousPersonalMemory) {
        memoryState.personalMemory = previousPersonalMemory;
      }
      throw error;
    }
    return { image, signal };
  }

  return db.transaction(async tx => {
    const [image] = await tx
      .select()
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.id, data.imageId),
          eq(generatedImages.storyId, data.storyId),
          or(
            eq(generatedImages.userId, data.userId),
            isNull(generatedImages.userId)
          )
        )
      )
      .limit(1);
    if (!image) return null;

    const shotGroup =
      image.shotIdentity != null
        ? image.shotNo != null
          ? or(
              eq(generatedImages.shotIdentity, image.shotIdentity),
              and(
                eq(generatedImages.shotNo, image.shotNo),
                isNull(generatedImages.shotIdentity)
              )
            )
          : eq(generatedImages.shotIdentity, image.shotIdentity)
        : image.shotNo != null
          ? eq(generatedImages.shotNo, image.shotNo)
          : eq(generatedImages.id, image.id);

    const lockedShotImages = await tx
      .select({ id: generatedImages.id })
      .from(generatedImages)
      .where(and(eq(generatedImages.storyId, data.storyId), shotGroup))
      .for("update");
    if (
      data.expectedCurrentImageId != null &&
      !lockedShotImages.some(row => row.id === data.expectedCurrentImageId)
    ) {
      return null;
    }
    if (data.expectedCurrentImageId != null) {
      const [expectedCurrent] = await tx
        .select({ id: generatedImages.id })
        .from(generatedImages)
        .where(
          and(
            eq(generatedImages.id, data.expectedCurrentImageId),
            eq(generatedImages.storyId, data.storyId),
            eq(generatedImages.isCurrent, true),
            shotGroup
          )
        )
        .limit(1);
      if (!expectedCurrent) return null;
    }
    await tx
      .update(generatedImages)
      .set({ isCurrent: false })
      .where(
        and(
          eq(generatedImages.storyId, data.storyId),
          shotGroup,
          eq(generatedImages.isCurrent, true)
        )
      );
    await tx
      .update(generatedImages)
      .set({ isCurrent: true })
      .where(eq(generatedImages.id, image.id));

    const [result] = await tx.insert(imageSignals).values({
      userId: data.userId,
      storyId: data.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: data.metadata ?? null,
    });
    const [signal] = await tx
      .select()
      .from(imageSignals)
      .where(eq(imageSignals.id, result.insertId));
    // 采用经历与 isCurrent 翻转、signal 在同一个 SQL 事务里成立。
    const adoption = data.adoption?.(signal.id) ?? null;
    if (adoption) {
      await capturePersonalMemoryEvent({ mode: "mysql", tx }, adoption);
    }
    return { image: { ...image, isCurrent: true }, signal };
  });
}

export async function assignStoryImageToShot(data: {
  imageId: number;
  storyId: number;
  userId: number;
  shotNo: string;
  shotIdentity: string;
  metadata?: InsertImageSignal["metadata"];
}): Promise<{ image: GeneratedImage; signal: ImageSignal } | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const image = memoryState.generatedImages.find(
      candidate =>
        candidate.id === data.imageId &&
        candidate.storyId === data.storyId &&
        (candidate.userId === data.userId || candidate.userId == null)
    );
    if (!image) return null;

    for (const candidate of memoryState.generatedImages) {
      if (candidate.storyId !== data.storyId || !candidate.isCurrent) continue;
      const sameIdentity = candidate.shotIdentity === data.shotIdentity;
      const sameLegacyShot =
        candidate.shotNo === data.shotNo && candidate.shotIdentity == null;
      if (sameIdentity || sameLegacyShot) candidate.isCurrent = false;
    }
    image.shotNo = data.shotNo;
    image.shotIdentity = data.shotIdentity;
    image.isCurrent = true;

    const signal: ImageSignal = {
      id: nextMemoryId("imageSignal"),
      userId: data.userId,
      storyId: data.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: data.metadata ?? null,
      createdAt: now(),
    };
    memoryState.imageSignals.push(signal);
    await persistMemoryState();
    return { image, signal };
  }

  return db.transaction(async tx => {
    const [image] = await tx
      .select()
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.id, data.imageId),
          eq(generatedImages.storyId, data.storyId),
          or(
            eq(generatedImages.userId, data.userId),
            isNull(generatedImages.userId)
          )
        )
      )
      .limit(1);
    if (!image) return null;

    const shotGroup = or(
      eq(generatedImages.shotIdentity, data.shotIdentity),
      and(
        eq(generatedImages.shotNo, data.shotNo),
        isNull(generatedImages.shotIdentity)
      )
    );
    await tx
      .select({ id: generatedImages.id })
      .from(generatedImages)
      .where(and(eq(generatedImages.storyId, data.storyId), shotGroup))
      .for("update");
    await tx
      .update(generatedImages)
      .set({ isCurrent: false })
      .where(
        and(
          eq(generatedImages.storyId, data.storyId),
          shotGroup,
          eq(generatedImages.isCurrent, true)
        )
      );
    await tx
      .update(generatedImages)
      .set({
        shotNo: data.shotNo,
        shotIdentity: data.shotIdentity,
        isCurrent: true,
      })
      .where(eq(generatedImages.id, image.id));

    const [result] = await tx.insert(imageSignals).values({
      userId: data.userId,
      storyId: data.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: data.metadata ?? null,
    });
    const [signal] = await tx
      .select()
      .from(imageSignals)
      .where(eq(imageSignals.id, result.insertId));
    return {
      image: {
        ...image,
        shotNo: data.shotNo,
        shotIdentity: data.shotIdentity,
        isCurrent: true,
      },
      signal,
    };
  });
}

export async function getImageSignalsForImages(
  imageIds: number[]
): Promise<ImageSignal[]> {
  if (imageIds.length === 0) return [];
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const targetIds = new Set(imageIds);
    return memoryState.imageSignals
      .filter(signal => signal.imageId != null && targetIds.has(signal.imageId))
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
      );
  }
  return db
    .select()
    .from(imageSignals)
    .where(inArray(imageSignals.imageId, imageIds))
    .orderBy(imageSignals.createdAt);
}

/**
 * 查询某个故事最近的 swipe_left 信号（用于矫正循环：拒绝的风格回流到 prompt）。
 * 返回最近 limit 条，按时间倒序。
 */
export async function getRecentRejectionSignals(
  storyId: number,
  limit = 10
): Promise<ImageSignal[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.imageSignals
      .filter(s => s.storyId === storyId && s.action === "swipe_left")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  return db
    .select()
    .from(imageSignals)
    .where(
      and(
        eq(imageSignals.storyId, storyId),
        eq(imageSignals.action, "swipe_left")
      )
    )
    .orderBy(desc(imageSignals.createdAt))
    .limit(limit);
}

export async function getRecentChatCorrections(
  projectId: number,
  limit = 10
): Promise<ImageSignal[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.imageSignals
      .filter(s => {
        if (s.action !== "chat_correction") return false;
        const meta = s.metadata as Record<string, unknown> | null;
        return meta?.projectId === projectId;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  // MySQL: chat_correction 信号的 projectId 存在 metadata JSON 里，用 JSON_EXTRACT 查询
  return db
    .select()
    .from(imageSignals)
    .where(
      and(
        eq(imageSignals.action, "chat_correction"),
        // @ts-explode — drizzle 不支持 JSON_EXTRACT，用 sql 模板
        sql`JSON_EXTRACT(${imageSignals.metadata}, '$.projectId') = ${projectId}`
      )
    )
    .orderBy(desc(imageSignals.createdAt))
    .limit(limit);
}

// ─── Generated Images（统一） ────────────────────────────────────────────
// 桌面端通过 projectId+shotNo 关联，手机端通过 storyId+userId 关联。

export async function createGeneratedImage(
  data: Omit<InsertGeneratedImage, "id" | "createdAt">
): Promise<GeneratedImage> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const promptCompilationId = await resolvePromptCompilationIdForAsset(null, {
      explicitPromptCompilationId: data.promptCompilationId,
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.shotIdentity,
      modality: "image",
    });
    // 把同一镜头的旧图标记为非当前；优先按稳定镜头身份，旧数据用 shotNo 兜底。
    if (
      data.isCurrent !== false &&
      (data.shotNo != null || data.shotIdentity != null)
    ) {
      for (const img of memoryState.generatedImages) {
        if (!img.isCurrent) continue;
        const sameDesktop = data.projectId && img.projectId === data.projectId;
        const sameMobile = data.storyId && img.storyId === data.storyId;
        const sameIdentity =
          data.shotIdentity != null && img.shotIdentity === data.shotIdentity;
        const sameLegacyShot =
          data.shotNo != null &&
          img.shotNo === data.shotNo &&
          (data.shotIdentity == null || img.shotIdentity == null);
        if ((sameDesktop || sameMobile) && (sameIdentity || sameLegacyShot)) {
          img.isCurrent = false;
        }
      }
    }
    const id = nextMemoryId("generatedImage");
    const image: GeneratedImage = {
      id,
      projectId: data.projectId ?? null,
      storyId: data.storyId ?? null,
      userId: data.userId ?? null,
      shotNo: data.shotNo ?? null,
      shotIdentity: data.shotIdentity ?? null,
      imageKey: data.imageKey ?? null,
      imageUrl: data.imageUrl,
      prompt: data.prompt ?? null,
      promptCompilationId,
      parentImageId: data.parentImageId ?? null,
      isCurrent: data.isCurrent ?? true,
      generationType: data.generationType ?? "generate",
      maskKey: data.maskKey ?? null,
      createdAt: now(),
    };
    memoryState.generatedImages.push(image);
    await persistMemoryState();
    if (image.userId != null) {
      await createImageSignal({
        userId: image.userId,
        storyId: image.storyId ?? 0,
        imageId: image.id,
        action: "edit_complete",
        metadata: {
          source: "generation",
          state: "pending",
          projectId: image.projectId,
        },
      });
    }
    return image;
  }
  // 把同一镜头的旧图标记为非当前；优先按稳定镜头身份，旧数据用 shotNo 兜底。
  if (
    data.isCurrent !== false &&
    (data.shotNo != null || data.shotIdentity != null)
  ) {
    const shotGroup =
      data.shotIdentity != null
        ? data.shotNo != null
          ? or(
              eq(generatedImages.shotIdentity, data.shotIdentity),
              and(
                eq(generatedImages.shotNo, data.shotNo),
                isNull(generatedImages.shotIdentity)
              )
            )
          : eq(generatedImages.shotIdentity, data.shotIdentity)
        : data.shotNo != null
          ? eq(generatedImages.shotNo, data.shotNo)
          : undefined;
    if (data.projectId) {
      await db
        .update(generatedImages)
        .set({ isCurrent: false })
        .where(
          and(
            eq(generatedImages.projectId, data.projectId),
            shotGroup,
            eq(generatedImages.isCurrent, true)
          )
        );
    } else if (data.storyId) {
      await db
        .update(generatedImages)
        .set({ isCurrent: false })
        .where(
          and(
            eq(generatedImages.storyId, data.storyId),
            shotGroup,
            eq(generatedImages.isCurrent, true)
          )
        );
    }
  }
  const promptCompilationId = await resolvePromptCompilationIdForAsset(db, {
    explicitPromptCompilationId: data.promptCompilationId,
    storyId: data.storyId,
    userId: data.userId,
    stableShotId: data.shotIdentity,
    modality: "image",
  });
  const [result] = await db.insert(generatedImages).values({
    ...data,
    promptCompilationId,
  });
  const [image] = await db
    .select()
    .from(generatedImages)
    .where(eq(generatedImages.id, result.insertId));
  if (image.userId != null) {
    await createImageSignal({
      userId: image.userId,
      storyId: image.storyId ?? 0,
      imageId: image.id,
      action: "edit_complete",
      metadata: {
        source: "generation",
        state: "pending",
        projectId: image.projectId,
      },
    });
  }
  return image;
}

export async function deleteGeneratedImage(
  imageId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    if (
      memoryState.stories.some(
        story =>
          story.userId === userId &&
          finishedProductReferencesImage(story.body, imageId)
      )
    ) {
      throw new Error("该图片已被成品版本引用，不能删除");
    }
    memoryState.generatedImages = memoryState.generatedImages.filter(
      img => !(img.id === imageId && img.userId === userId)
    );
    memoryState.imageSignals = memoryState.imageSignals.filter(
      sig => sig.imageId !== imageId
    );
    await persistMemoryState();
    return;
  }
  const ownedStories = await db
    .select({ body: stories.body })
    .from(stories)
    .where(eq(stories.userId, userId));
  if (
    ownedStories.some(story =>
      finishedProductReferencesImage(story.body, imageId)
    )
  ) {
    throw new Error("该图片已被成品版本引用，不能删除");
  }
  await db.delete(imageSignals).where(eq(imageSignals.imageId, imageId));
  await db
    .delete(generatedImages)
    .where(
      and(eq(generatedImages.id, imageId), eq(generatedImages.userId, userId))
    );
}

function finishedProductReferencesImage(
  body: unknown,
  imageId: number
): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const finishedProduct = (body as Record<string, unknown>).finishedProduct;
  if (
    !finishedProduct ||
    typeof finishedProduct !== "object" ||
    Array.isArray(finishedProduct)
  ) {
    return false;
  }
  const versions = (finishedProduct as Record<string, unknown>).versions;
  if (!Array.isArray(versions)) return false;
  return versions.some(version => {
    if (!version || typeof version !== "object" || Array.isArray(version)) {
      return false;
    }
    const images = (version as Record<string, unknown>).images;
    return (
      Array.isArray(images) &&
      images.some(
        image =>
          image != null &&
          typeof image === "object" &&
          !Array.isArray(image) &&
          (image as Record<string, unknown>).imageId === imageId
      )
    );
  });
}

export async function updateImageCurrent(
  imageId: number,
  isCurrent: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const img = memoryState.generatedImages.find(i => i.id === imageId);
    if (img) {
      img.isCurrent = isCurrent;
      await persistMemoryState();
    }
    return;
  }
  await db
    .update(generatedImages)
    .set({ isCurrent })
    .where(eq(generatedImages.id, imageId));
}

export async function reassignImage(
  imageId: number,
  newShotNo: string
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const img = memoryState.generatedImages.find(i => i.id === imageId);
    if (!img) return;

    const oldShotNo = img.shotNo;
    const projectId = img.projectId;

    // Mark existing current images on the target shot as non-current
    for (const other of memoryState.generatedImages) {
      if (
        other.projectId === projectId &&
        other.shotNo === newShotNo &&
        other.isCurrent
      ) {
        other.isCurrent = false;
      }
    }

    // Move the image and make it current on the new shot
    img.shotNo = newShotNo;
    img.isCurrent = true;

    // Promote the most recent remaining image on the old shot
    const oldShotImages = memoryState.generatedImages
      .filter(
        i =>
          i.projectId === projectId &&
          i.shotNo === oldShotNo &&
          i.id !== imageId
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (oldShotImages.length > 0) {
      oldShotImages[0].isCurrent = true;
    }

    await persistMemoryState();
    return;
  }

  const [img] = await db
    .select()
    .from(generatedImages)
    .where(eq(generatedImages.id, imageId))
    .limit(1);
  if (!img) return;

  const oldShotNo = img.shotNo;
  const projectId = img.projectId;
  if (projectId == null || oldShotNo == null) return; // 没有 projectId/shotNo 的图片不支持重分配

  // 将目标镜号上的当前图片标记为非当前
  await db
    .update(generatedImages)
    .set({ isCurrent: false })
    .where(
      and(
        eq(generatedImages.projectId, projectId),
        eq(generatedImages.shotNo, newShotNo),
        eq(generatedImages.isCurrent, true)
      )
    );

  // 移动图片到新镜号并设为当前
  await db
    .update(generatedImages)
    .set({ shotNo: newShotNo, isCurrent: true })
    .where(eq(generatedImages.id, imageId));

  // 在旧镜号上提升最新的图片为当前
  const remaining = await db
    .select()
    .from(generatedImages)
    .where(
      and(
        eq(generatedImages.projectId, projectId),
        eq(generatedImages.shotNo, oldShotNo)
      )
    )
    .orderBy(desc(generatedImages.createdAt))
    .limit(1);
  if (remaining.length > 0) {
    await db
      .update(generatedImages)
      .set({ isCurrent: true })
      .where(eq(generatedImages.id, remaining[0].id));
  }
}
