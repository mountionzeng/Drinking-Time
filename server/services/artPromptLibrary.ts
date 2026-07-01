import { and, eq, inArray, or } from "drizzle-orm";
import {
  artPromptLibraries,
  artPromptLibraryItems,
  artPromptLibraryVersions,
  promptCompilationHeads,
  promptCompilationInputs,
  promptCompilations,
  promptNodeBindings,
  promptNodes,
  promptOperationReceipts,
  promptRevisions,
  storyArtPromptBindings,
  storyPromptStates,
} from "../../drizzle/schema";
import {
  artPromptLibraryItemsToLineageItems,
  normalizeArtPromptLibraryImport,
  type ArtPromptLibraryImportDraft,
  type NormalizedArtPromptLibraryItem,
} from "../../shared/artPromptLibrary";
import { compilePromptTargets } from "../../shared/promptCompiler";
import { promptDimensionWeight } from "../../shared/promptDimensionWeights";
import type {
  ArtPromptLibrary,
  ArtPromptLibraryItem,
  ArtPromptLibraryVersion,
  PromptLineageOwner,
  PromptNode,
  PromptNodeBinding,
  PromptRevision,
  StoryArtPromptBinding,
  StoryPromptAggregate,
} from "../../shared/promptLineage";
import { getDb, getLocalPromptLineageState, replaceLocalPromptLineageState } from "../db";
import {
  createPersistentLocalPromptLineageStore,
  loadStoryPromptAggregate,
  PromptLineageConflictError,
  PromptLineageOwnershipError,
  PromptLineageValidationError,
} from "./promptLineageStore";
import {
  getActiveStyles,
  styleNegatives,
  type StyleEntry,
} from "./styleLibrary";

type ImportInput = ArtPromptLibraryImportDraft & {
  userId: number;
};

type SyncSystemLibrariesInput = {
  entries?: StyleEntry[];
};

type BindInput = PromptLineageOwner & {
  libraryVersionId: number;
  expectedVersion: number;
  operationKey: string;
};

export type ArtPromptLibraryVersionProjection = {
  library: ArtPromptLibrary;
  version: ArtPromptLibraryVersion;
  items: ArtPromptLibraryItem[];
};

export type BindArtPromptLibraryResult = {
  version: number;
  binding: StoryArtPromptBinding;
  changedDimensions: string[];
  projection: StoryPromptAggregate | null;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function canUseLibrary(
  library: Pick<ArtPromptLibrary, "kind" | "ownerUserId">,
  userId: number,
): boolean {
  return library.kind === "system" || library.ownerUserId === userId;
}

function sourceForItem(
  library: ArtPromptLibrary,
  version: ArtPromptLibraryVersion,
  item: Pick<NormalizedArtPromptLibraryItem, "dimension">,
): string {
  return `art-prompt-library:${library.id}:v${version.version}:${item.dimension}`;
}

function normalizeDbLibrary(row: typeof artPromptLibraries.$inferSelect): ArtPromptLibrary {
  return {
    ...row,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function normalizeDbVersion(
  row: typeof artPromptLibraryVersions.$inferSelect,
): ArtPromptLibraryVersion {
  return {
    ...row,
    createdAt: iso(row.createdAt),
    publishedAt: row.publishedAt ? iso(row.publishedAt) : null,
  };
}

function normalizeDbItem(
  row: typeof artPromptLibraryItems.$inferSelect,
): ArtPromptLibraryItem {
  return row;
}

function promptNodeForCompiler(row: typeof promptNodes.$inferSelect): PromptNode {
  return {
    ...row,
    stableShotId: row.stableShotId || null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function promptRevisionForCompiler(
  row: typeof promptRevisions.$inferSelect,
): PromptRevision {
  return {
    ...row,
    createdAt: iso(row.createdAt),
    decidedAt: row.decidedAt ? iso(row.decidedAt) : null,
  };
}

function promptBindingForCompiler(
  row: typeof promptNodeBindings.$inferSelect,
): PromptNodeBinding {
  return {
    ...row,
    stableShotId: row.stableShotId || null,
    createdAt: iso(row.createdAt),
  };
}

async function loadLocalVersionProjection(
  libraryVersionId: number,
  userId: number,
): Promise<ArtPromptLibraryVersionProjection> {
  const state = await getLocalPromptLineageState();
  if (!state) {
    throw new PromptLineageValidationError("本地提示词状态不可用");
  }
  const version = state.artLibraryVersions.find(
    item => item.id === libraryVersionId,
  );
  if (!version) {
    throw new PromptLineageValidationError("美术提示词库版本不存在");
  }
  const library = state.artLibraries.find(item => item.id === version.libraryId);
  if (!library || !canUseLibrary(library, userId)) {
    throw new PromptLineageOwnershipError("无权使用该美术提示词库");
  }
  return {
    library,
    version,
    items: state.artLibraryItems
      .filter(item => item.libraryVersionId === version.id)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id),
  };
}

async function loadDbVersionProjection(
  libraryVersionId: number,
  userId: number,
): Promise<ArtPromptLibraryVersionProjection> {
  const db = await getDb();
  if (!db) return loadLocalVersionProjection(libraryVersionId, userId);
  const [versionRow] = await db
    .select()
    .from(artPromptLibraryVersions)
    .where(eq(artPromptLibraryVersions.id, libraryVersionId))
    .limit(1);
  if (!versionRow) {
    throw new PromptLineageValidationError("美术提示词库版本不存在");
  }
  const [libraryRow] = await db
    .select()
    .from(artPromptLibraries)
    .where(eq(artPromptLibraries.id, versionRow.libraryId))
    .limit(1);
  if (!libraryRow || !canUseLibrary(libraryRow, userId)) {
    throw new PromptLineageOwnershipError("无权使用该美术提示词库");
  }
  const itemRows = await db
    .select()
    .from(artPromptLibraryItems)
    .where(eq(artPromptLibraryItems.libraryVersionId, versionRow.id));
  return {
    library: normalizeDbLibrary(libraryRow),
    version: normalizeDbVersion(versionRow),
    items: itemRows
      .map(normalizeDbItem)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id),
  };
}

function normalizeLocalVersionProjection(
  projection: ArtPromptLibraryVersionProjection,
): ArtPromptLibraryVersionProjection {
  return structuredClone(projection);
}

function cleanLibraryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function joinLibraryTexts(values: readonly string[]): string {
  return values.map(cleanLibraryText).filter(Boolean).join(", ");
}

function styleEntryToLibraryDraft(entry: StyleEntry): ArtPromptLibraryImportDraft {
  const recipe = [
    cleanLibraryText(entry.one_liner),
    cleanLibraryText(entry.signature)
      ? `signature: ${cleanLibraryText(entry.signature)}`
      : "",
    cleanLibraryText(entry.era_culture)
      ? `era/culture: ${cleanLibraryText(entry.era_culture)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    name: entry.name,
    description: entry.one_liner || null,
    source: `style-library:${entry.id}`,
    items: [
      { dimension: "visual_style", content: joinLibraryTexts(entry.style) },
      { dimension: "color_palette", content: joinLibraryTexts(entry.palette) },
      { dimension: "lighting", content: entry.light },
      { dimension: "composition", content: entry.composition },
      { dimension: "material", content: entry.material },
      {
        dimension: "negative_prompt",
        content: joinLibraryTexts(styleNegatives(entry)),
      },
      { dimension: "art_style_recipe", content: recipe },
    ].filter(item => cleanLibraryText(item.content)),
  };
}

async function upsertLocalSystemArtPromptLibrary(
  draft: ArtPromptLibraryImportDraft,
): Promise<ArtPromptLibraryVersionProjection> {
  const normalized = normalizeArtPromptLibraryImport(draft);
  const state = await getLocalPromptLineageState();
  if (!state) {
    throw new PromptLineageValidationError("本地提示词状态不可用");
  }
  const timestamp = nowIso();
  let library = state.artLibraries.find(
    item =>
      item.kind === "system" &&
      item.ownerUserId == null &&
      item.name === normalized.name,
  );
  if (!library) {
    library = {
      id: state.nextIds.artLibrary++,
      kind: "system",
      ownerUserId: null,
      name: normalized.name,
      description: normalized.description,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.artLibraries.push(library);
  } else {
    library.description = normalized.description;
    library.updatedAt = timestamp;
  }
  const existing = state.artLibraryVersions.find(
    item =>
      item.libraryId === library!.id &&
      item.contentFingerprint === normalized.contentFingerprint,
  );
  if (existing) {
    const items = state.artLibraryItems
      .filter(item => item.libraryVersionId === existing.id)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
    return normalizeLocalVersionProjection({ library, version: existing, items });
  }
  const versionNumber =
    Math.max(
      0,
      ...state.artLibraryVersions
        .filter(item => item.libraryId === library!.id)
        .map(item => item.version),
    ) + 1;
  const version: ArtPromptLibraryVersion = {
    id: state.nextIds.artLibraryVersion++,
    libraryId: library.id,
    version: versionNumber,
    status: "published",
    contentFingerprint: normalized.contentFingerprint,
    source: normalized.source,
    createdAt: timestamp,
    publishedAt: timestamp,
  };
  state.artLibraryVersions.push(version);
  const items = normalized.items.map(item => ({
    id: state.nextIds.artLibraryItem++,
    libraryVersionId: version.id,
    dimension: item.dimension,
    content: item.content,
    negativeContent: item.negativeContent,
    sourceRevisionId: null,
    sortOrder: item.sortOrder,
  }));
  state.artLibraryItems.push(...items);
  await replaceLocalPromptLineageState(state);
  return normalizeLocalVersionProjection({ library, version, items });
}

async function upsertDbSystemArtPromptLibrary(
  draft: ArtPromptLibraryImportDraft,
): Promise<ArtPromptLibraryVersionProjection> {
  const normalized = normalizeArtPromptLibraryImport(draft);
  const db = await getDb();
  if (!db) return upsertLocalSystemArtPromptLibrary(draft);
  return db.transaction(async tx => {
    const [existingLibrary] = await tx
      .select()
      .from(artPromptLibraries)
      .where(
        and(
          eq(artPromptLibraries.kind, "system"),
          eq(artPromptLibraries.name, normalized.name),
        ),
      )
      .limit(1);
    let library = existingLibrary;
    if (!library) {
      const [inserted] = await tx.insert(artPromptLibraries).values({
        kind: "system",
        ownerUserId: null,
        name: normalized.name,
        description: normalized.description,
      });
      [library] = await tx
        .select()
        .from(artPromptLibraries)
        .where(eq(artPromptLibraries.id, inserted.insertId))
        .limit(1);
    } else {
      await tx
        .update(artPromptLibraries)
        .set({ description: normalized.description })
        .where(eq(artPromptLibraries.id, library.id));
      library = { ...library, description: normalized.description };
    }
    if (!library) {
      throw new PromptLineageValidationError("无法创建系统美术提示词库");
    }
    const [existingVersion] = await tx
      .select()
      .from(artPromptLibraryVersions)
      .where(
        and(
          eq(artPromptLibraryVersions.libraryId, library.id),
          eq(
            artPromptLibraryVersions.contentFingerprint,
            normalized.contentFingerprint,
          ),
        ),
      )
      .limit(1);
    if (existingVersion) {
      const itemRows = await tx
        .select()
        .from(artPromptLibraryItems)
        .where(eq(artPromptLibraryItems.libraryVersionId, existingVersion.id));
      return {
        library: normalizeDbLibrary(library),
        version: normalizeDbVersion(existingVersion),
        items: itemRows
          .map(normalizeDbItem)
          .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id),
      };
    }
    const versions = await tx
      .select()
      .from(artPromptLibraryVersions)
      .where(eq(artPromptLibraryVersions.libraryId, library.id));
    const versionNumber =
      Math.max(0, ...versions.map(item => item.version)) + 1;
    const [versionInsert] = await tx.insert(artPromptLibraryVersions).values({
      libraryId: library.id,
      version: versionNumber,
      status: "published",
      contentFingerprint: normalized.contentFingerprint,
      source: normalized.source,
      publishedAt: new Date(),
    });
    const [version] = await tx
      .select()
      .from(artPromptLibraryVersions)
      .where(eq(artPromptLibraryVersions.id, versionInsert.insertId))
      .limit(1);
    if (!version) {
      throw new PromptLineageValidationError("无法创建系统美术提示词库版本");
    }
    await tx.insert(artPromptLibraryItems).values(
      normalized.items.map(item => ({
        libraryVersionId: version.id,
        dimension: item.dimension,
        content: item.content,
        negativeContent: item.negativeContent,
        sortOrder: item.sortOrder,
      })),
    );
    const itemRows = await tx
      .select()
      .from(artPromptLibraryItems)
      .where(eq(artPromptLibraryItems.libraryVersionId, version.id));
    return {
      library: normalizeDbLibrary(library),
      version: normalizeDbVersion(version),
      items: itemRows.map(normalizeDbItem),
    };
  });
}

export async function syncSystemArtPromptLibraries(
  input: SyncSystemLibrariesInput = {},
): Promise<ArtPromptLibraryVersionProjection[]> {
  const entries = input.entries ?? getActiveStyles();
  const projections: ArtPromptLibraryVersionProjection[] = [];
  for (const entry of entries) {
    try {
      projections.push(
        await upsertDbSystemArtPromptLibrary(styleEntryToLibraryDraft(entry)),
      );
    } catch (error) {
      console.warn(
        `[artPromptLibrary] 跳过系统美术库 ${entry.id}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return projections;
}

export async function importUserArtPromptLibrary(
  input: ImportInput,
): Promise<ArtPromptLibraryVersionProjection> {
  const normalized = normalizeArtPromptLibraryImport(input);
  const db = await getDb();
  if (!db) {
    const state = await getLocalPromptLineageState();
    if (!state) {
      throw new PromptLineageValidationError("本地提示词状态不可用");
    }
    const timestamp = nowIso();
    let library = state.artLibraries.find(
      item =>
        item.kind === "user" &&
        item.ownerUserId === input.userId &&
        item.name === normalized.name,
    );
    if (!library) {
      library = {
        id: state.nextIds.artLibrary++,
        kind: "user",
        ownerUserId: input.userId,
        name: normalized.name,
        description: normalized.description,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.artLibraries.push(library);
    } else {
      library.description = normalized.description;
      library.updatedAt = timestamp;
    }
    const existing = state.artLibraryVersions.find(
      item =>
        item.libraryId === library!.id &&
        item.contentFingerprint === normalized.contentFingerprint,
    );
    if (existing) {
      return normalizeLocalVersionProjection({
        library,
        version: existing,
        items: state.artLibraryItems.filter(
          item => item.libraryVersionId === existing.id,
        ),
      });
    }
    const versionNumber =
      Math.max(
        0,
        ...state.artLibraryVersions
          .filter(item => item.libraryId === library!.id)
          .map(item => item.version),
      ) + 1;
    const version: ArtPromptLibraryVersion = {
      id: state.nextIds.artLibraryVersion++,
      libraryId: library.id,
      version: versionNumber,
      status: "published",
      contentFingerprint: normalized.contentFingerprint,
      source: normalized.source,
      createdAt: timestamp,
      publishedAt: timestamp,
    };
    state.artLibraryVersions.push(version);
    const items = normalized.items.map(item => ({
      id: state.nextIds.artLibraryItem++,
      libraryVersionId: version.id,
      dimension: item.dimension,
      content: item.content,
      negativeContent: item.negativeContent,
      sourceRevisionId: null,
      sortOrder: item.sortOrder,
    }));
    state.artLibraryItems.push(...items);
    await replaceLocalPromptLineageState(state);
    return normalizeLocalVersionProjection({ library, version, items });
  }

  return db.transaction(async tx => {
    const [existingLibrary] = await tx
      .select()
      .from(artPromptLibraries)
      .where(
        and(
          eq(artPromptLibraries.kind, "user"),
          eq(artPromptLibraries.ownerUserId, input.userId),
          eq(artPromptLibraries.name, normalized.name),
        ),
      )
      .limit(1);
    let library = existingLibrary;
    if (!library) {
      const [inserted] = await tx.insert(artPromptLibraries).values({
        kind: "user",
        ownerUserId: input.userId,
        name: normalized.name,
        description: normalized.description,
      });
      [library] = await tx
        .select()
        .from(artPromptLibraries)
        .where(eq(artPromptLibraries.id, inserted.insertId))
        .limit(1);
    } else {
      await tx
        .update(artPromptLibraries)
        .set({ description: normalized.description })
        .where(eq(artPromptLibraries.id, library.id));
      library = { ...library, description: normalized.description };
    }
    if (!library) {
      throw new PromptLineageValidationError("无法创建美术提示词库");
    }
    const [existingVersion] = await tx
      .select()
      .from(artPromptLibraryVersions)
      .where(
        and(
          eq(artPromptLibraryVersions.libraryId, library.id),
          eq(
            artPromptLibraryVersions.contentFingerprint,
            normalized.contentFingerprint,
          ),
        ),
      )
      .limit(1);
    if (existingVersion) {
      const itemRows = await tx
        .select()
        .from(artPromptLibraryItems)
        .where(eq(artPromptLibraryItems.libraryVersionId, existingVersion.id));
      return {
        library: normalizeDbLibrary(library),
        version: normalizeDbVersion(existingVersion),
        items: itemRows.map(normalizeDbItem),
      };
    }
    const versions = await tx
      .select()
      .from(artPromptLibraryVersions)
      .where(eq(artPromptLibraryVersions.libraryId, library.id));
    const versionNumber =
      Math.max(0, ...versions.map(item => item.version)) + 1;
    const [versionInsert] = await tx.insert(artPromptLibraryVersions).values({
      libraryId: library.id,
      version: versionNumber,
      status: "published",
      contentFingerprint: normalized.contentFingerprint,
      source: normalized.source,
      publishedAt: new Date(),
    });
    const [version] = await tx
      .select()
      .from(artPromptLibraryVersions)
      .where(eq(artPromptLibraryVersions.id, versionInsert.insertId))
      .limit(1);
    if (!version) {
      throw new PromptLineageValidationError("无法创建美术提示词库版本");
    }
    await tx.insert(artPromptLibraryItems).values(
      normalized.items.map(item => ({
        libraryVersionId: version.id,
        dimension: item.dimension,
        content: item.content,
        negativeContent: item.negativeContent,
        sortOrder: item.sortOrder,
      })),
    );
    const itemRows = await tx
      .select()
      .from(artPromptLibraryItems)
      .where(eq(artPromptLibraryItems.libraryVersionId, version.id));
    return {
      library: normalizeDbLibrary(library),
      version: normalizeDbVersion(version),
      items: itemRows.map(normalizeDbItem),
    };
  });
}

export async function listArtPromptLibraries(input: {
  userId: number;
}): Promise<ArtPromptLibraryVersionProjection[]> {
  await syncSystemArtPromptLibraries();
  const db = await getDb();
  if (!db) {
    const state = await getLocalPromptLineageState();
    if (!state) return [];
    return state.artLibraryVersions
      .flatMap(version => {
        const library = state.artLibraries.find(
          item => item.id === version.libraryId,
        );
        if (!library || !canUseLibrary(library, input.userId)) return [];
        return {
          library,
          version,
          items: state.artLibraryItems
            .filter(item => item.libraryVersionId === version.id)
            .sort(
              (left, right) =>
                left.sortOrder - right.sortOrder || left.id - right.id,
            ),
        };
      })
      .sort(
        (left, right) =>
          left.library.name.localeCompare(right.library.name) ||
          right.version.version - left.version.version,
      );
  }
  const libraryRows = await db
    .select()
    .from(artPromptLibraries)
    .where(
      or(
        eq(artPromptLibraries.kind, "system"),
        eq(artPromptLibraries.ownerUserId, input.userId),
      ),
    );
  if (libraryRows.length === 0) return [];
  const libraryIds = libraryRows.map(item => item.id);
  const versionRows = await db
    .select()
    .from(artPromptLibraryVersions)
    .where(inArray(artPromptLibraryVersions.libraryId, libraryIds));
  const itemRows = versionRows.length === 0
    ? []
    : await db
        .select()
        .from(artPromptLibraryItems)
        .where(
          inArray(
            artPromptLibraryItems.libraryVersionId,
            versionRows.map(item => item.id),
          ),
        );
  return versionRows
    .flatMap(version => {
      const library = libraryRows.find(item => item.id === version.libraryId);
      if (!library) return [];
      return {
        library: normalizeDbLibrary(library),
        version: normalizeDbVersion(version),
        items: itemRows
          .filter(item => item.libraryVersionId === version.id)
          .map(normalizeDbItem)
          .sort(
            (left, right) =>
              left.sortOrder - right.sortOrder || left.id - right.id,
          ),
      };
    })
    .sort(
      (left, right) =>
        left.library.name.localeCompare(right.library.name) ||
        right.version.version - left.version.version,
    );
}

function stableShotIdsFromAggregate(aggregate: StoryPromptAggregate): string[] {
  return Array.from(
    new Set(
      aggregate.nodes
        .map(node => node.stableShotId)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();
}

export async function bindStoryArtPromptLibraryVersion(
  input: BindInput,
): Promise<BindArtPromptLibraryResult> {
  const versionProjection = await loadDbVersionProjection(
    input.libraryVersionId,
    input.userId,
  );
  const lineageItems = artPromptLibraryItemsToLineageItems(
    versionProjection.items.map(item => ({
      dimension: item.dimension as NormalizedArtPromptLibraryItem["dimension"],
      content: item.content,
      negativeContent: item.negativeContent,
      sortOrder: item.sortOrder,
    })),
  );
  const changedDimensions = lineageItems.map(item => item.dimension);
  const db = await getDb();
  if (!db) {
    const store = await createPersistentLocalPromptLineageStore();
    const aggregate = store.getStoryAggregate(input);
    const stableShotIds = stableShotIdsFromAggregate(aggregate);
    const existingByDimension = new Map(
      aggregate.nodes
        .filter(
          node =>
            node.scope === "story" &&
            node.modality === "shared" &&
            node.stableShotId == null,
        )
        .map(node => [node.dimension, node]),
    );
    const committed = await store.transact(
      {
        storyId: input.storyId,
        userId: input.userId,
        expectedVersion: input.expectedVersion,
        operationKey: input.operationKey,
      },
      tx => {
        const binding = tx.upsertStoryArtBinding(input.libraryVersionId);
        for (const item of lineageItems) {
          let node = existingByDimension.get(item.dimension);
          if (!node) {
            node = tx.createNode({
              scope: "story",
              modality: "shared",
              dimension: item.dimension,
            });
            tx.bindNode({
              nodeId: node.id,
              stableShotId: null,
              modality: "shared",
              sortOrder: 200 + item.sortOrder,
            });
            existingByDimension.set(item.dimension, node);
          }
          const revision = tx.createRevision({
            nodeId: node.id,
            parentRevisionId: node.currentRevisionId,
            content: item.content,
            weight: promptDimensionWeight(item.dimension),
            authorType: "user",
            reason: `bind art library ${versionProjection.library.name} v${versionProjection.version.version}`,
            source: sourceForItem(
              versionProjection.library,
              versionProjection.version,
              item,
            ),
          });
          tx.confirmRevision(node.id, revision.id);
        }
        for (const stableShotId of stableShotIds) {
          const compiled = tx.compileTargets(stableShotId);
          for (const modality of ["image", "video"] as const) {
            if (!compiled[modality].finalText.trim()) continue;
            tx.createCompilation({
              stableShotId,
              modality,
              finalText: compiled[modality].finalText,
              inputFingerprint: compiled[modality].inputFingerprint,
              revisionIds: compiled[modality].revisionIds,
            });
          }
        }
        return {
          binding,
          changedDimensions,
        };
      },
    );
    return {
      version: committed.version,
      binding: committed.result.binding,
      changedDimensions,
      projection: await loadStoryPromptAggregate(input),
    };
  }

  const result = await db.transaction(async tx => {
    const [priorReceipt] = await tx
      .select()
      .from(promptOperationReceipts)
      .where(
        and(
          eq(promptOperationReceipts.storyId, input.storyId),
          eq(promptOperationReceipts.userId, input.userId),
          eq(promptOperationReceipts.operationKey, input.operationKey),
        ),
      )
      .limit(1);
    if (priorReceipt) {
      return {
        version: priorReceipt.committedVersion,
      };
    }
    const [state] = await tx
      .select()
      .from(storyPromptStates)
      .where(
        and(
          eq(storyPromptStates.storyId, input.storyId),
          eq(storyPromptStates.userId, input.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!state) {
      throw new PromptLineageValidationError("故事提示词尚未迁移");
    }
    if (state.version !== input.expectedVersion) {
      throw new PromptLineageConflictError(
        `Expected prompt lineage version ${input.expectedVersion}, received ${state.version}`,
        state.version,
      );
    }

    await tx
      .insert(storyArtPromptBindings)
      .values({
        storyId: input.storyId,
        userId: input.userId,
        libraryVersionId: input.libraryVersionId,
      })
      .onDuplicateKeyUpdate({
        set: { libraryVersionId: input.libraryVersionId, updatedAt: new Date() },
      });

    const existingNodes = await tx
      .select()
      .from(promptNodes)
      .where(
        and(
          eq(promptNodes.storyId, input.storyId),
          eq(promptNodes.userId, input.userId),
        ),
      );
    const existingByDimension = new Map(
      existingNodes
        .filter(
          node =>
            node.scope === "story" &&
            node.modality === "shared" &&
            node.stableShotId === "",
        )
        .map(node => [node.dimension, node]),
    );
    for (const item of lineageItems) {
      let node = existingByDimension.get(item.dimension);
      if (!node) {
        const [inserted] = await tx.insert(promptNodes).values({
          storyId: input.storyId,
          userId: input.userId,
          stableShotId: "",
          scope: "story",
          modality: "shared",
          dimension: item.dimension,
        });
        [node] = await tx
          .select()
          .from(promptNodes)
          .where(eq(promptNodes.id, inserted.insertId))
          .limit(1);
        if (!node) {
          throw new PromptLineageValidationError("无法创建美术提示词节点");
        }
        await tx.insert(promptNodeBindings).values({
          storyId: input.storyId,
          userId: input.userId,
          nodeId: node.id,
          stableShotId: "",
          modality: "shared",
          sortOrder: 200 + item.sortOrder,
        });
        existingByDimension.set(item.dimension, node);
      }
      const [insertedRevision] = await tx.insert(promptRevisions).values({
        storyId: input.storyId,
        userId: input.userId,
        nodeId: node.id,
        parentRevisionId: node.currentRevisionId,
        content: item.content,
        weight: promptDimensionWeight(item.dimension),
        authorType: "user",
        authorUserId: input.userId,
        reason: `bind art library ${versionProjection.library.name} v${versionProjection.version.version}`,
        source: sourceForItem(
          versionProjection.library,
          versionProjection.version,
          item,
        ),
        status: "confirmed",
        decidedAt: new Date(),
      });
      await tx
        .update(promptNodes)
        .set({ currentRevisionId: insertedRevision.insertId })
        .where(eq(promptNodes.id, node.id));
    }

    const [nodeRows, revisionRows, bindingRows] = await Promise.all([
      tx
        .select()
        .from(promptNodes)
        .where(
          and(
            eq(promptNodes.storyId, input.storyId),
            eq(promptNodes.userId, input.userId),
          ),
        ),
      tx
        .select()
        .from(promptRevisions)
        .where(
          and(
            eq(promptRevisions.storyId, input.storyId),
            eq(promptRevisions.userId, input.userId),
          ),
        ),
      tx
        .select()
        .from(promptNodeBindings)
        .where(
          and(
            eq(promptNodeBindings.storyId, input.storyId),
            eq(promptNodeBindings.userId, input.userId),
          ),
        ),
    ]);
    const compilerNodes = nodeRows.map(promptNodeForCompiler);
    const compilerRevisions = revisionRows.map(promptRevisionForCompiler);
    const compilerBindings = bindingRows.map(promptBindingForCompiler);
    const stableShotIds = Array.from(
      new Set(
        compilerNodes
          .map(node => node.stableShotId)
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort();
    for (const stableShotId of stableShotIds) {
      const compiled = compilePromptTargets({
        stableShotId,
        nodes: compilerNodes,
        revisions: compilerRevisions,
        bindings: compilerBindings,
      });
      for (const modality of ["image", "video"] as const) {
        const target = compiled[modality];
        if (!target.finalText.trim()) continue;
        const [compilationInsert] = await tx.insert(promptCompilations).values({
          storyId: input.storyId,
          userId: input.userId,
          stableShotId,
          modality,
          finalText: target.finalText,
          inputFingerprint: target.inputFingerprint,
        });
        await tx.insert(promptCompilationInputs).values(
          target.revisionIds.map((revisionId, position) => ({
            compilationId: compilationInsert.insertId,
            revisionId,
            position,
          })),
        );
        await tx
          .insert(promptCompilationHeads)
          .values({
            storyId: input.storyId,
            userId: input.userId,
            stableShotId,
            modality,
            currentCompilationId: compilationInsert.insertId,
          })
          .onDuplicateKeyUpdate({
            set: {
              currentCompilationId: compilationInsert.insertId,
              updatedAt: new Date(),
            },
          });
      }
    }
    const nextVersion = state.version + 1;
    await tx
      .update(storyPromptStates)
      .set({ version: nextVersion })
      .where(eq(storyPromptStates.id, state.id));
    await tx.insert(promptOperationReceipts).values({
      storyId: input.storyId,
      userId: input.userId,
      operationKey: input.operationKey,
      committedVersion: nextVersion,
      result: { libraryVersionId: input.libraryVersionId, changedDimensions },
    });
    return { version: nextVersion };
  });

  const projection = await loadStoryPromptAggregate(input);
  const binding = projection?.artBinding;
  if (!binding) {
    throw new PromptLineageValidationError("美术提示词库绑定未持久化");
  }
  return {
    version: result.version,
    binding,
    changedDimensions,
    projection,
  };
}
