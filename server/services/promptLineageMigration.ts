import { ensureShotIdentities } from "../../shared/shotIdentity";
import {
  fingerprintCompiledPromptInputs,
  renderCompiledPromptText,
} from "../../shared/promptCompiler";
import { promptDimensionWeight } from "../../shared/promptDimensionWeights";
import { and, eq } from "drizzle-orm";
import {
  promptCompilationHeads,
  promptCompilationInputs,
  promptCompilations,
  promptNodeBindings,
  promptNodes,
  promptOperationReceipts,
  promptRevisions,
  stories,
  storyConversationMessages,
  storyConversations,
  storyPromptStates,
} from "../../drizzle/schema";
import type {
  ConversationMessageRole,
  PromptModality,
  PromptLineageOwner,
  PromptRevisionAuthor,
  PromptScope,
  StoryPromptAggregate,
} from "../../shared/promptLineage";
import type {
  PromptLineageMemoryStore,
  PromptLineageTransaction,
} from "./promptLineageStore";
import {
  clearStoryPromptLineage,
  createPersistentLocalPromptLineageStore,
  loadStoryPromptAggregate,
} from "./promptLineageStore";
import { getDb } from "../db";

type LegacyRecord = Record<string, unknown>;

type MigrationInput = {
  storyId: number;
  userId: number;
  body: unknown;
  source?: "legacy" | "initial";
};

type PromptFact = {
  stableShotId: string | null;
  scope: PromptScope;
  modality: PromptModality;
  dimension: string;
  content: string;
  source: string;
};

type LegacyMessage = {
  key: string;
  role: ConversationMessageRole;
  content: string;
  source: string;
  clientMessageId: string | null;
  timestamp: number;
};

type CompilationSeedInput = {
  nodeId: number;
  revisionId: number;
  dimension: string;
  content: string;
  weight: number;
};

function asRecord(value: unknown): LegacyRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LegacyRecord)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : text(value)
      ? [text(value)]
      : [];
}

function addFact(
  facts: PromptFact[],
  input: Omit<PromptFact, "content"> & { content: unknown },
) {
  const content = text(input.content);
  if (!content) return;
  const duplicate = facts.find(
    fact =>
      fact.stableShotId === input.stableShotId &&
      fact.scope === input.scope &&
      fact.modality === input.modality &&
      fact.dimension === input.dimension,
  );
  if (duplicate) {
    if (!duplicate.content.split("\n").includes(content)) {
      duplicate.content = `${duplicate.content}\n${content}`;
    }
    return;
  }
  facts.push({ ...input, content });
}

function collectStoryFacts(body: LegacyRecord): PromptFact[] {
  const facts: PromptFact[] = [];
  for (const [dimension, key] of [
    ["title", "title"],
    ["theme", "theme"],
    ["story_arc", "arc"],
    ["visual_style", "visualPreference"],
  ] as const) {
    addFact(facts, {
      stableShotId: null,
      scope: "story",
      modality: "shared",
      dimension,
      content: body[key],
      source: `story.${key}`,
    });
  }

  const visualItems = Array.isArray(body.visualCanvasItems)
    ? body.visualCanvasItems
    : [];
  const visualDimensions = new Map<string, string[]>();
  for (const itemValue of visualItems) {
    const item = asRecord(itemValue);
    const analysis = asRecord(item.analysis);
    const entries: Array<[string, unknown]> = [
      ["visual_style", analysis.visualStyle],
      ["color_palette", analysis.colorPalette],
      ["mood", analysis.mood],
      ["composition", analysis.composition],
      ["lighting", analysis.lighting],
      ["subject", analysis.objective],
    ];
    for (const [dimension, value] of entries) {
      const bucket = visualDimensions.get(dimension) ?? [];
      for (const part of textList(value)) {
        if (!bucket.includes(part)) bucket.push(part);
      }
      visualDimensions.set(dimension, bucket);
    }
  }
  for (const [dimension, values] of Array.from(visualDimensions.entries())) {
    addFact(facts, {
      stableShotId: null,
      scope: "story",
      modality: "shared",
      dimension,
      content: values.join("\n"),
      source: "story.visualCanvasItems",
    });
  }
  return facts;
}

function collectShotFacts(body: LegacyRecord): {
  facts: PromptFact[];
  stableShotIds: string[];
} {
  const rawShots = Array.isArray(body.shots) ? body.shots : [];
  const shots = ensureShotIdentities(rawShots.map(asRecord));
  const facts: PromptFact[] = [];

  for (const shot of shots) {
    const stableShotId = shot.stableShotId;
    const shared: Array<[string, keyof typeof shot]> = [
      ["subject", "subject"],
      ["action", "action"],
      ["intent", "intent"],
      ["rationale", "rationale"],
      ["location", "location"],
      ["time_light", "timeLight"],
      ["mood", "mood"],
      ["style_reference", "styleRef"],
      ["beat", "beat"],
    ];
    const dialogue: Array<[string, keyof typeof shot]> = [
      ["dialogue", "dialogue"],
    ];
    const image: Array<[string, keyof typeof shot]> = [
      ["image_prompt", "promptDraft"],
      ["negative_prompt", "negativePrompt"],
    ];
    const video: Array<[string, keyof typeof shot]> = [
      ["camera_motion", "cameraMove"],
      ["video_prompt", "videoPrompt"],
      ["sound", "sound"],
    ];

    for (const [dimension, key] of shared) {
      addFact(facts, {
        stableShotId,
        scope: "shot",
        modality: "shared",
        dimension,
        content: shot[key],
        source: `shot.${String(key)}`,
      });
    }
    for (const [dimension, key] of dialogue) {
      addFact(facts, {
        stableShotId,
        scope: "modality",
        modality: "dialogue",
        dimension,
        content: shot[key],
        source: `shot.${String(key)}`,
      });
    }
    for (const [dimension, key] of image) {
      addFact(facts, {
        stableShotId,
        scope: "modality",
        modality: "image",
        dimension,
        content: shot[key],
        source: `shot.${String(key)}`,
      });
    }
    if (shot.promptOverrides && typeof shot.promptOverrides === "object") {
      addFact(facts, {
        stableShotId,
        scope: "modality",
        modality: "image",
        dimension: "image_overrides",
        content: JSON.stringify(shot.promptOverrides),
        source: "shot.promptOverrides",
      });
    }
    for (const [dimension, key] of video) {
      addFact(facts, {
        stableShotId,
        scope: "modality",
        modality: "video",
        dimension,
        content: shot[key],
        source: `shot.${String(key)}`,
      });
    }
  }

  return {
    facts,
    stableShotIds: shots.map(shot => shot.stableShotId),
  };
}

function collectMessages(body: LegacyRecord): LegacyMessage[] {
  const sources: Array<[string, unknown]> = [
    ["story", body.messages],
    ["creation", body.creationMessages],
  ];
  const byKey = new Map<string, LegacyMessage>();

  for (const [source, value] of sources) {
    const messages = Array.isArray(value) ? value : [];
    for (const raw of messages) {
      const message = asRecord(raw);
      const id = text(message.id);
      const content = text(message.content) || text(message.text);
      const roleText = text(message.role) || text(message.who);
      if (
        !content ||
        id === "first-question" ||
        message.ephemeral === true ||
        text(message.kind) === "greeting"
      ) {
        continue;
      }
      const role: ConversationMessageRole =
        roleText === "assistant" || roleText === "system"
          ? roleText
          : "user";
      const timestamp =
        typeof message.timestamp === "number" &&
        Number.isFinite(message.timestamp)
          ? message.timestamp
          : 0;
      const key = id || `${timestamp}:${role}:${content}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          role,
          content,
          source,
          clientMessageId: id || null,
          timestamp,
        });
      }
    }
  }
  return Array.from(byKey.values()).sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.key.localeCompare(right.key),
  );
}

type MigrationSeed = {
  facts: PromptFact[];
  stableShotIds: string[];
  messages: LegacyMessage[];
};

function buildMigrationSeed(body: LegacyRecord): MigrationSeed {
  const { facts: shotFacts, stableShotIds } = collectShotFacts(body);
  return {
    facts: [...collectStoryFacts(body), ...shotFacts],
    stableShotIds,
    messages: collectMessages(body),
  };
}

function factSignature(fact: PromptFact): string {
  return [
    fact.stableShotId ?? "",
    fact.scope,
    fact.modality,
    fact.dimension,
    fact.content,
  ].join("|");
}

function messageSignature(
  message:
    | LegacyMessage
    | Pick<
        StoryPromptAggregate["messages"][number],
        "role" | "content" | "source" | "clientMessageId"
      >,
): string {
  return [
    message.role,
    message.content,
    message.source ?? "",
    message.clientMessageId ?? "",
  ].join("|");
}

function seedSignatures(seed: MigrationSeed): {
  facts: string[];
  messages: string[];
} {
  return {
    facts: seed.facts.map(factSignature).sort(),
    messages: seed.messages.map(messageSignature),
  };
}

function aggregateSignatures(aggregate: StoryPromptAggregate): {
  facts: string[];
  messages: string[];
} {
  const currentRevisionById = new Map(
    aggregate.revisions.map(revision => [revision.id, revision]),
  );
  return {
    facts: aggregate.nodes
      .map(node => {
        if (node.currentRevisionId == null) return null;
        const revision = currentRevisionById.get(node.currentRevisionId);
        if (!revision) return null;
        return factSignature({
          stableShotId: node.stableShotId,
          scope: node.scope,
          modality: node.modality,
          dimension: node.dimension,
          content: revision.content,
          source: revision.source ?? "",
        });
      })
      .filter((value): value is string => Boolean(value))
      .sort(),
    messages: aggregate.messages.map(messageSignature),
  };
}

function hasManualPromptEdits(aggregate: StoryPromptAggregate): boolean {
  return aggregate.revisions.some(
    revision =>
      revision.authorType === "user" || revision.authorType === "agent",
  );
}

function migrationSeedChanged(
  aggregate: StoryPromptAggregate,
  seed: MigrationSeed,
): boolean {
  const current = aggregateSignatures(aggregate);
  const next = seedSignatures(seed);
  if (current.facts.length !== next.facts.length) return true;
  if (current.messages.length !== next.messages.length) return true;
  for (let index = 0; index < current.facts.length; index += 1) {
    if (current.facts[index] !== next.facts[index]) return true;
  }
  for (let index = 0; index < current.messages.length; index += 1) {
    if (current.messages[index] !== next.messages[index]) return true;
  }
  return false;
}

async function maybeResetStaleMigration(
  owner: PromptLineageOwner,
  seed: MigrationSeed,
): Promise<StoryPromptAggregate | null> {
  const aggregate = await loadStoryPromptAggregate(owner);
  if (!aggregate || aggregate.state.migrationStatus !== "migrated") {
    return aggregate;
  }
  if (!migrationSeedChanged(aggregate, seed)) {
    return aggregate;
  }
  if (hasManualPromptEdits(aggregate)) {
    return aggregate;
  }
  await clearStoryPromptLineage(owner);
  return null;
}

function createFacts(
  tx: PromptLineageTransaction,
  facts: PromptFact[],
  authorType: PromptRevisionAuthor,
) {
  const revisionsByShot = new Map<
    string,
    Map<PromptModality, CompilationSeedInput[]>
  >();
  for (const fact of facts) {
    const weight = promptDimensionWeight(fact.dimension);
    const node = tx.createNode({
      stableShotId: fact.stableShotId,
      scope: fact.scope,
      modality: fact.modality,
      dimension: fact.dimension,
    });
    const revision = tx.createRevision({
      nodeId: node.id,
      content: fact.content,
      weight,
      authorType,
      source: fact.source,
      reason: authorType === "migration" ? "legacy import" : "initial story",
    });
    tx.confirmRevision(node.id, revision.id);
    tx.bindNode({
      nodeId: node.id,
      stableShotId: fact.stableShotId,
      modality: fact.modality,
      sortOrder: facts.indexOf(fact),
    });
    const shotKey = fact.stableShotId ?? "__story__";
    const byModality = revisionsByShot.get(shotKey) ?? new Map();
    const modalityRevisions = byModality.get(fact.modality) ?? [];
    modalityRevisions.push({
      nodeId: node.id,
      revisionId: revision.id,
      dimension: fact.dimension,
      content: revision.content,
      weight,
    });
    byModality.set(fact.modality, modalityRevisions);
    revisionsByShot.set(shotKey, byModality);
  }
  return revisionsByShot;
}

export async function migrateLegacyPromptLineage(
  store: PromptLineageMemoryStore,
  input: MigrationInput,
): Promise<{ migrated: boolean; version: number }> {
  const body = asRecord(input.body);
  const seed = buildMigrationSeed(body);
  if (store.hasStoryState(input)) {
    const existing = store.getStoryAggregate(input);
    if (existing.state.migrationStatus === "migrated") {
      if (!migrationSeedChanged(existing, seed)) {
        return { migrated: false, version: existing.state.version };
      }
      if (hasManualPromptEdits(existing)) {
        return { migrated: false, version: existing.state.version };
      }
      await store.clearStory(input);
    }
  }
  const expectedVersion = store.hasStoryState(input)
    ? store.getStoryAggregate(input).state.version
    : 0;

  const committed = await store.transact(
    {
      storyId: input.storyId,
      userId: input.userId,
      expectedVersion,
      operationKey: "prompt-lineage-migration-v1",
    },
    tx => {
      tx.setMigrationStatus("migrating");
      const revisionsByShot = createFacts(
        tx,
        seed.facts,
        input.source === "initial" ? "system" : "migration",
      );

      const storyShared = revisionsByShot.get("__story__")?.get("shared") ?? [];
      for (const stableShotId of seed.stableShotIds) {
        const byModality = revisionsByShot.get(stableShotId) ?? new Map();
        const shotShared = byModality.get("shared") ?? [];
        for (const modality of ["dialogue", "image", "video"] as const) {
          const local = byModality.get(modality) ?? [];
          const inputs = [...storyShared, ...shotShared, ...local];
          if (inputs.length === 0) continue;
          tx.createCompilation({
            stableShotId,
            modality,
            finalText: renderCompiledPromptText(inputs),
            inputFingerprint: fingerprintCompiledPromptInputs({
              stableShotId,
              modality,
              inputs: inputs.map(item => ({
                nodeId: item.nodeId,
                revisionId: item.revisionId,
                dimension: item.dimension,
                content: item.content,
                weight: item.weight,
              })),
            }),
            revisionIds: inputs.map(item => item.revisionId),
          });
        }
      }

      for (const message of seed.messages) {
        tx.appendMessage({
          role: message.role,
          content: message.content,
          source: message.source,
          clientMessageId: message.clientMessageId,
        });
      }
      tx.setMigrationStatus("migrated");
      return {
        nodeCount: seed.facts.length,
        messageCount: seed.messages.length,
      };
    },
  );

  return { migrated: true, version: committed.version };
}

export async function migrateStoryPromptLineage(
  input: MigrationInput,
): Promise<{ migrated: boolean; version: number }> {
  const body = asRecord(input.body);
  const seed = buildMigrationSeed(body);
  const current = await maybeResetStaleMigration(input, seed);
  if (current?.state.migrationStatus === "migrated") {
    return { migrated: false, version: current.state.version };
  }

  const db = await getDb();
  if (!db) {
    const store = await createPersistentLocalPromptLineageStore();
    return migrateLegacyPromptLineage(store, input);
  }

  return db.transaction(async tx => {
    const [ownedStory] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(and(eq(stories.id, input.storyId), eq(stories.userId, input.userId)))
      .for("update")
      .limit(1);
    if (!ownedStory) {
      throw new Error("故事不存在或无权操作");
    }

    await tx
      .insert(storyPromptStates)
      .values({
        storyId: input.storyId,
        userId: input.userId,
        version: 0,
        migrationStatus: "migrating",
      })
      .onDuplicateKeyUpdate({
        set: { updatedAt: new Date() },
      });
    const [promptState] = await tx
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
    if (!promptState) {
      throw new Error("无法建立故事提示词状态");
    }
    if (promptState.migrationStatus === "migrated") {
      return { migrated: false, version: promptState.version };
    }

    const timestamp = new Date();
    const revisionsByShot = new Map<
      string,
      Map<PromptModality, CompilationSeedInput[]>
    >();
    for (const [sortOrder, fact] of Array.from(seed.facts.entries())) {
      const weight = promptDimensionWeight(fact.dimension);
      const [nodeInsert] = await tx.insert(promptNodes).values({
        storyId: input.storyId,
        userId: input.userId,
        stableShotId: fact.stableShotId ?? "",
        scope: fact.scope,
        modality: fact.modality,
        dimension: fact.dimension,
      });
      const nodeId = nodeInsert.insertId;
      const [revisionInsert] = await tx.insert(promptRevisions).values({
        storyId: input.storyId,
        userId: input.userId,
        nodeId,
        content: fact.content,
        weight,
        authorType: input.source === "initial" ? "system" : "migration",
        reason: input.source === "initial" ? "initial story" : "legacy import",
        source: fact.source,
        status: "confirmed",
        decidedAt: timestamp,
      });
      const revisionId = revisionInsert.insertId;
      await tx
        .update(promptNodes)
        .set({ currentRevisionId: revisionId })
        .where(eq(promptNodes.id, nodeId));
      await tx.insert(promptNodeBindings).values({
        storyId: input.storyId,
        userId: input.userId,
        nodeId,
        stableShotId: fact.stableShotId ?? "",
        modality: fact.modality,
        sortOrder,
      });

      const shotKey = fact.stableShotId ?? "__story__";
      const byModality = revisionsByShot.get(shotKey) ?? new Map();
      const modalityRevisions = byModality.get(fact.modality) ?? [];
      modalityRevisions.push({
        nodeId,
        revisionId,
        dimension: fact.dimension,
        content: fact.content,
        weight,
      });
      byModality.set(fact.modality, modalityRevisions);
      revisionsByShot.set(shotKey, byModality);
    }

    const storyShared = revisionsByShot.get("__story__")?.get("shared") ?? [];
    for (const stableShotId of seed.stableShotIds) {
      const byModality = revisionsByShot.get(stableShotId) ?? new Map();
      const shotShared = byModality.get("shared") ?? [];
      for (const modality of ["dialogue", "image", "video"] as const) {
        const local = byModality.get(modality) ?? [];
        const inputs = [...storyShared, ...shotShared, ...local];
        if (inputs.length === 0) continue;
        const [compilationInsert] = await tx.insert(promptCompilations).values({
          storyId: input.storyId,
          userId: input.userId,
          stableShotId,
          modality,
          finalText: renderCompiledPromptText(inputs),
          inputFingerprint: fingerprintCompiledPromptInputs({
            stableShotId,
            modality,
            inputs: inputs.map(item => ({
              nodeId: item.nodeId,
              revisionId: item.revisionId,
              dimension: item.dimension,
              content: item.content,
              weight: item.weight,
            })),
          }),
        });
        const compilationId = compilationInsert.insertId;
        await tx.insert(promptCompilationInputs).values(
          inputs.map((revision, position) => ({
            compilationId,
            revisionId: revision.revisionId,
            position,
          })),
        );
        await tx.insert(promptCompilationHeads).values({
          storyId: input.storyId,
          userId: input.userId,
          stableShotId,
          modality,
          currentCompilationId: compilationId,
        });
      }
    }

    if (seed.messages.length > 0) {
      const [conversationInsert] = await tx.insert(storyConversations).values({
        storyId: input.storyId,
        userId: input.userId,
      });
      await tx.insert(storyConversationMessages).values(
        seed.messages.map(message => ({
          conversationId: conversationInsert.insertId,
          storyId: input.storyId,
          userId: input.userId,
          role: message.role,
          content: message.content,
          source: message.source,
          clientMessageId: message.clientMessageId,
        })),
      );
    }

    const nextVersion = promptState.version + 1;
    await tx
      .update(storyPromptStates)
      .set({
        version: nextVersion,
        migrationStatus: "migrated",
        migratedAt: timestamp,
      })
      .where(eq(storyPromptStates.id, promptState.id));
    await tx.insert(promptOperationReceipts).values({
      storyId: input.storyId,
      userId: input.userId,
      operationKey: "prompt-lineage-migration-v1",
      committedVersion: nextVersion,
      result: {
        nodeCount: seed.facts.length,
        messageCount: seed.messages.length,
      },
    });
    return { migrated: true, version: nextVersion };
  });
}
