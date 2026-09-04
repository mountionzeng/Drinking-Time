import {
  bigint,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  float,
  boolean as mysqlBoolean,
  json,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/mysql-core";
import type { PublishingDraftState } from "../shared/publishingDraft";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /**
   * 会话版本。JWT 里带上它，服务端校验时比对；改密码/找回密码时自增即可让旧 session 失效。
   * 老用户默认 1，不需要回填。
   */
  sessionVersion: int("sessionVersion").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * AccessSessions — 已登录用户的轻量访问时长记录。
 *
 * 只记录访问起止和累计活跃秒数，不保存 IP、设备指纹、访问内容或故事数据。
 */
export const accessSessions = mysqlTable(
  "access_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    visitId: varchar("visitId", { length: 64 }).notNull(),
    siteHost: varchar("siteHost", { length: 255 }).notNull(),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    durationSeconds: int("durationSeconds").default(0).notNull(),
  },
  table => ({
    visitUnique: uniqueIndex("access_sessions_visit_unique").on(
      table.userId,
      table.visitId,
      table.siteHost
    ),
    userHostIndex: index("access_sessions_user_host_index").on(
      table.userId,
      table.siteHost
    ),
    lastSeenIndex: index("access_sessions_last_seen_index").on(
      table.lastSeenAt
    ),
  })
);

export type AccessSession = typeof accessSessions.$inferSelect;
export type InsertAccessSession = typeof accessSessions.$inferInsert;

/**
 * Projects — each analysis session is a project
 */
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  deadline: varchar("deadline", { length: 32 }),
  autoRender: mysqlBoolean("autoRender").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * References — uploaded materials (images, scripts, briefs, etc.)
 */
export const references = mysqlTable("references", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  sourceType: mysqlEnum("sourceType", [
    "image",
    "video",
    "script",
    "storyboard",
    "brief",
    "note",
    "pdf",
  ]).notNull(),
  fileUrl: text("fileUrl"),
  fileKey: varchar("fileKey", { length: 512 }),
  mimeType: varchar("mimeType", { length: 128 }),
  fileSize: int("fileSize"),
  dateBucket: varchar("dateBucket", { length: 32 }),
  importance: int("importance").default(3).notNull(),
  pinned: mysqlBoolean("pinned").default(false).notNull(),
  excluded: mysqlBoolean("excluded").default(false).notNull(),
  extractedText: text("extractedText"),
  extractedTags: json("extractedTags"),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Reference = typeof references.$inferSelect;
export type InsertReference = typeof references.$inferInsert;

/**
 * Shots — NLP-decomposed scene/shot production rows
 */
export const shots = mysqlTable("shots", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  // 故事归属：镜头按 storyId 归到具体故事（故事是唯一单位，见
  // docs/plans/2026-06-13-001-refactor-story-as-single-unit-plan.md）。
  // 可空：存量镜头回填前为 null，回填后指向所属故事。
  storyId: int("storyId"),
  userId: int("userId").notNull(),
  sceneNo: varchar("sceneNo", { length: 32 }).notNull(),
  shotNo: varchar("shotNo", { length: 32 }).notNull(),
  sourceSummary: text("sourceSummary"),
  intentType: mysqlEnum("intentType", [
    "idea",
    "client_requirement",
    "director_note",
  ])
    .default("idea")
    .notNull(),
  status: mysqlEnum("status", [
    "idea_pool",
    "requirement_pool",
    "structured",
    "production_ready",
    "queued",
    "rendered",
    "blocked",
  ])
    .default("idea_pool")
    .notNull(),
  readinessScore: float("readinessScore").default(0).notNull(),
  deadline: varchar("deadline", { length: 32 }),
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"])
    .default("medium")
    .notNull(),
  autoRender: mysqlBoolean("autoRender").default(false).notNull(),
  blockingIssues: json("blockingIssues"),
  nextAction: text("nextAction"),
  // Analysis result fields
  sceneType: varchar("sceneType", { length: 128 }),
  timeOfDay: varchar("timeOfDay", { length: 64 }),
  weather: varchar("weather", { length: 64 }),
  lighting: text("lighting"),
  cameraFocalLength: varchar("cameraFocalLength", { length: 64 }),
  cameraMovement: varchar("cameraMovement", { length: 128 }),
  spatialLayers: text("spatialLayers"),
  mood: text("mood"),
  colorPalette: text("colorPalette"),
  promptDraft: text("promptDraft"),
  negativePrompt: text("negativePrompt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Shot = typeof shots.$inferSelect;
export type InsertShot = typeof shots.$inferInsert;

/**
 * AnalysisResults — environment template drafts generated from analysis
 */
export const analysisResults = mysqlTable("analysis_results", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  mood: text("mood"),
  lighting: text("lighting"),
  spatialStructure: text("spatialStructure"),
  cameraLanguage: text("cameraLanguage"),
  colorPalette: text("colorPalette"),
  atmosphereKeywords: json("atmosphereKeywords"),
  promptDraft: text("promptDraft"),
  negativePrompt: text("negativePrompt"),
  parameterSuggestions: json("parameterSuggestions"),
  summary: text("summary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AnalysisResult = typeof analysisResults.$inferSelect;
export type InsertAnalysisResult = typeof analysisResults.$inferInsert;

/**
 * EmotionAnalysisProfiles — 用户自愿提供的长期情绪分析底盘。
 *
 * 出生日期等敏感线索只在用户明确同意后写入；dailyReference / analysisSeed
 * 保留当日首页生成的社会学、人类学与历史参照，供后续对话 Agent 读取。
 */
export const emotionAnalysisProfiles = mysqlTable("emotion_analysis_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId"),
  birthDate: varchar("birthDate", { length: 10 }).notNull(),
  consentVersion: varchar("consentVersion", { length: 64 }).notNull(),
  consentText: text("consentText"),
  dailyReference: json("dailyReference"),
  analysisSeed: json("analysisSeed"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmotionAnalysisProfile =
  typeof emotionAnalysisProfiles.$inferSelect;
export type InsertEmotionAnalysisProfile =
  typeof emotionAnalysisProfiles.$inferInsert;

/**
 * EmotionDailyLetters — 每位用户按日期保存的一封回信。
 *
 * 长期画像继续保留“今天”的快照供旧链路读取；这里保存可回看、可修改的历史，
 * 让修改某天的原话只重写当天回信，不覆盖其他日期。
 */
export const emotionDailyLetters = mysqlTable(
  "emotion_daily_letters",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    letterDate: varchar("letterDate", { length: 10 }).notNull(),
    userMessage: text("userMessage"),
    userMessageSaidAt: timestamp("userMessageSaidAt"),
    userMessageEditedAt: timestamp("userMessageEditedAt"),
    dailyReference: json("dailyReference").notNull(),
    analysisSeed: json("analysisSeed").notNull(),
    revision: int("revision").default(1).notNull(),
    /**
     * 当前版本指针（U1 起）。正文权威是 emotion_daily_letter_versions；
     * 这一行只在追加版本的同一事务里推进指针，并保留可由版本重建的兼容字段。
     *
     * 这里刻意不建外键：versions 表定义在本表之后，drizzle 的 extra config 是
     * 立即求值的，往回引用会在模块加载期炸 TDZ。跨租户在这里也不可能——
     * (userId, letterDate) 本来就唯一，指针只由同事务的版本写入方推进。
     */
    currentVersionId: int("currentVersionId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userDateUnique: uniqueIndex("emotion_daily_letters_user_date_unique").on(
      table.userId,
      table.letterDate
    ),
    userDateIndex: index("emotion_daily_letters_user_date_index").on(
      table.userId,
      table.letterDate
    ),
  })
);

export type EmotionDailyLetter = typeof emotionDailyLetters.$inferSelect;
export type InsertEmotionDailyLetter = typeof emotionDailyLetters.$inferInsert;

/**
 * Stories — drinking-time 工坊的剧本/镜头表。
 *
 * 设计取舍：
 * - 元数据列（title/logline/theme/arc/summary）抽出来方便列表页排序/筛选/预览
 * - body 走 JSON，存 cards/characters/shots 这些重的嵌套数组——iframe 那边本来
 *   就是按整故事 blob 在写，不需要拆字段
 * - userId 是所有者（owner）。Phase 3 加 storyMembers 表做共享时再放权
 * - projectId 可空：当前 iframe 里 PROJECTS 是 mock 的，等真项目模型起来再绑
 */
export const stories = mysqlTable("stories", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId"),
  title: varchar("title", { length: 255 }).notNull(),
  logline: text("logline"),
  theme: text("theme"),
  arc: text("arc"),
  summary: text("summary"),
  body: json("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Story = typeof stories.$inferSelect;
export type InsertStory = typeof stories.$inferInsert;

/**
 * StoryBody — 期望塞进 stories.body 的形状。Drizzle 把 json 列推成 unknown，
 * 服务器和 iframe 都按这个 shape 来读写。
 */
export type StoryBody = {
  cards: Array<{
    id: string;
    content: string;
    rawText?: string;
    sourceQuote?: string;
    createdAt: number;
    emotion?: string;
    emotionOptions?: string[];
    emotionBlend?: string[];
    intensity?: number;
    direction?: string;
    complexity?: string;
    trigger?: string;
    dramaticFunction?: string;
    personalTrace?: string;
    retrievalQuery?: string;
    themeHints?: string[];
    outlierSignal?: string;
    softMembership?: string[];
    order?: number;
  }>;
  characters: Array<{ name: string; role: string; oneLiner: string }>;
  shots: Array<{
    stableShotId?: string;
    shotIdentity?: string;
    shotNo: number;
    sceneNo?: string;
    sceneTitle?: string;
    sceneArtBrief?: string;
    subject: string;
    action: string;
    dialogue: string;
    shotType: string;
    beat: string; // "开场" | "起势" | "转折" | "收束"
    cameraAngle: string;
    cameraMove: string;
    location: string;
    timeLight: string;
    mood: string;
    sound: string;
    styleRef: string;
    note: string;
    emotion: string;
    sourceCardContent: string;
    intent?: string | null;
    rationale?: string | null;
    emotionCharge?: string;
    emotionDelta?: string;
    visualAnchorText?: string;
    promptDraft?: string;
    negativePrompt?: string;
  }>;
  scenes?: Array<{
    sceneNo: string;
    title: string;
    artBrief: string;
    shotRange?: string;
    sourceStoryId?: number;
    sourceStoryTitle?: string;
  }>;
  // 历史压缩状态（前端 storyAgent 自己用，原样回传即可）
  summaryThroughTurn?: number;
  variants?: Array<{
    mode: "克制版" | "戏剧版" | "诗意版";
    logline: string;
    arc: string;
    treatment: string;
  }>;
  boringCheck?: {
    hasConflict: boolean;
    hasTurn: boolean;
    hasWish: boolean;
    hasCost: boolean;
    hasChange: boolean;
    note: string;
  };
  visualCanvasItems?: Array<{
    id: string;
    title: string;
    imageUrl: string;
    originalImageUrl?: string;
    source: "reference" | "riff";
    parentId?: string;
    cardId?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    prompt: string;
    userInstruction?: string;
    analysis: {
      objective: string;
      aesthetic: string;
      visualStyle: string[];
      mood: string[];
      colorPalette: string[];
      composition: string;
      lighting: string;
      promptDraft: string;
      negativePrompt: string;
      confidence: number;
    };
    createdAt: number;
  }>;
  visualPreference?: string;
  /** Server-owned social publishing state; written through publishing operations. */
  publishing?: PublishingDraftState;
  // 未来扩展点：连接镜的 connectorPolicy、风格全局参数等都可以塞进来
  [key: string]: unknown;
};

export const storyPromptStates = mysqlTable(
  "story_prompt_states",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: int("version").default(0).notNull(),
    migrationStatus: mysqlEnum("migrationStatus", [
      "legacy",
      "migrating",
      "migrated",
    ])
      .default("legacy")
      .notNull(),
    migratedAt: timestamp("migratedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    storyOwner: uniqueIndex("story_prompt_states_story_owner_unique").on(
      table.storyId,
      table.userId
    ),
  })
);

export type StoryPromptState = typeof storyPromptStates.$inferSelect;
export type InsertStoryPromptState = typeof storyPromptStates.$inferInsert;

export const promptNodes = mysqlTable(
  "prompt_nodes",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stableShotId: varchar("stableShotId", { length: 128 })
      .default("")
      .notNull(),
    scope: mysqlEnum("scope", ["story", "shot", "modality"]).notNull(),
    modality: mysqlEnum("modality", [
      "shared",
      "dialogue",
      "image",
      "video",
    ]).notNull(),
    dimension: varchar("dimension", { length: 128 }).notNull(),
    currentRevisionId: int("currentRevisionId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    semanticKey: uniqueIndex("prompt_nodes_semantic_key_unique").on(
      table.storyId,
      table.userId,
      table.stableShotId,
      table.scope,
      table.modality,
      table.dimension
    ),
    storyLookup: index("prompt_nodes_story_lookup").on(
      table.storyId,
      table.userId,
      table.stableShotId
    ),
  })
);

export type PromptNode = typeof promptNodes.$inferSelect;
export type InsertPromptNode = typeof promptNodes.$inferInsert;

export const promptRevisions = mysqlTable(
  "prompt_revisions",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nodeId: int("nodeId")
      .notNull()
      .references(() => promptNodes.id, { onDelete: "cascade" }),
    parentRevisionId: int("parentRevisionId"),
    content: text("content").notNull(),
    weight: float("weight").default(0.3).notNull(),
    authorType: mysqlEnum("authorType", [
      "user",
      "agent",
      "system",
      "migration",
    ]).notNull(),
    authorUserId: int("authorUserId"),
    reason: text("reason"),
    source: varchar("source", { length: 128 }),
    status: mysqlEnum("status", ["candidate", "confirmed", "rejected"])
      .default("candidate")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    decidedAt: timestamp("decidedAt"),
  },
  table => ({
    nodeHistory: index("prompt_revisions_node_history").on(
      table.nodeId,
      table.id
    ),
    storyCandidates: index("prompt_revisions_story_candidates").on(
      table.storyId,
      table.userId,
      table.status
    ),
  })
);

export type PromptRevision = typeof promptRevisions.$inferSelect;
export type InsertPromptRevision = typeof promptRevisions.$inferInsert;

export const promptNodeBindings = mysqlTable(
  "prompt_node_bindings",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nodeId: int("nodeId")
      .notNull()
      .references(() => promptNodes.id, { onDelete: "cascade" }),
    stableShotId: varchar("stableShotId", { length: 128 })
      .default("")
      .notNull(),
    modality: mysqlEnum("modality", [
      "shared",
      "dialogue",
      "image",
      "video",
    ]).notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    bindingKey: uniqueIndex("prompt_node_bindings_key_unique").on(
      table.storyId,
      table.userId,
      table.nodeId,
      table.stableShotId,
      table.modality
    ),
    shotOrder: index("prompt_node_bindings_shot_order").on(
      table.storyId,
      table.userId,
      table.stableShotId,
      table.modality,
      table.sortOrder
    ),
  })
);

export type PromptNodeBinding = typeof promptNodeBindings.$inferSelect;
export type InsertPromptNodeBinding = typeof promptNodeBindings.$inferInsert;

export const promptCompilations = mysqlTable(
  "prompt_compilations",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stableShotId: varchar("stableShotId", { length: 128 }).notNull(),
    modality: mysqlEnum("modality", ["dialogue", "image", "video"]).notNull(),
    finalText: text("finalText").notNull(),
    inputFingerprint: varchar("inputFingerprint", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    shotModality: index("prompt_compilations_shot_modality").on(
      table.storyId,
      table.userId,
      table.stableShotId,
      table.modality,
      table.id
    ),
  })
);

export type PromptCompilation = typeof promptCompilations.$inferSelect;
export type InsertPromptCompilation = typeof promptCompilations.$inferInsert;

export const promptCompilationInputs = mysqlTable(
  "prompt_compilation_inputs",
  {
    id: int("id").autoincrement().primaryKey(),
    compilationId: int("compilationId")
      .notNull()
      .references(() => promptCompilations.id, { onDelete: "cascade" }),
    revisionId: int("revisionId")
      .notNull()
      .references(() => promptRevisions.id, { onDelete: "restrict" }),
    position: int("position").notNull(),
  },
  table => ({
    orderedInput: uniqueIndex("prompt_compilation_inputs_order_unique").on(
      table.compilationId,
      table.position
    ),
  })
);

export type PromptCompilationInput =
  typeof promptCompilationInputs.$inferSelect;
export type InsertPromptCompilationInput =
  typeof promptCompilationInputs.$inferInsert;

export const promptCompilationHeads = mysqlTable(
  "prompt_compilation_heads",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stableShotId: varchar("stableShotId", { length: 128 }).notNull(),
    modality: mysqlEnum("modality", ["dialogue", "image", "video"]).notNull(),
    currentCompilationId: int("currentCompilationId")
      .notNull()
      .references(() => promptCompilations.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    currentKey: uniqueIndex("prompt_compilation_heads_current_unique").on(
      table.storyId,
      table.userId,
      table.stableShotId,
      table.modality
    ),
  })
);

export type PromptCompilationHead = typeof promptCompilationHeads.$inferSelect;
export type InsertPromptCompilationHead =
  typeof promptCompilationHeads.$inferInsert;

export const storyConversations = mysqlTable(
  "story_conversations",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    storyOwner: uniqueIndex("story_conversations_story_owner_unique").on(
      table.storyId,
      table.userId
    ),
  })
);

export type StoryConversation = typeof storyConversations.$inferSelect;
export type InsertStoryConversation = typeof storyConversations.$inferInsert;

export const storyConversationTurns = mysqlTable(
  "story_conversation_turns",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId")
      .notNull()
      .references(() => storyConversations.id, { onDelete: "cascade" }),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientTurnId: varchar("clientTurnId", { length: 128 }).notNull(),
    requestHash: varchar("requestHash", { length: 128 }).notNull(),
    userClientMessageId: varchar("userClientMessageId", { length: 128 }).notNull(),
    assistantClientMessageId: varchar("assistantClientMessageId", { length: 128 }).notNull(),
    userContent: text("userContent").notNull(),
    assistantContent: text("assistantContent"),
    generationStatus: mysqlEnum("generationStatus", [
      "pending",
      "completed",
      "failed",
      "unknown",
    ]).default("pending").notNull(),
    appendStatus: mysqlEnum("appendStatus", ["pending", "appended"])
      .default("pending")
      .notNull(),
    generationAttempt: int("generationAttempt").default(1).notNull(),
    contextMessageId: int("contextMessageId"),
    claimToken: varchar("claimToken", { length: 128 }),
    failureMessage: text("failureMessage"),
    claimedAt: timestamp("claimedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    completedAt: timestamp("completedAt"),
    appendedAt: timestamp("appendedAt"),
  },
  table => ({
    storyTurn: uniqueIndex("story_conversation_turns_story_turn_unique").on(
      table.storyId,
      table.userId,
      table.clientTurnId
    ),
    userMessage: uniqueIndex("story_conversation_turns_user_message_unique").on(
      table.storyId,
      table.userId,
      table.userClientMessageId
    ),
    assistantMessage: uniqueIndex(
      "story_conversation_turns_assistant_message_unique"
    ).on(
      table.storyId,
      table.userId,
      table.assistantClientMessageId
    ),
    conversationOrder: index("story_conversation_turns_order").on(
      table.conversationId,
      table.id
    ),
  })
);

export type StoryConversationTurn = typeof storyConversationTurns.$inferSelect;
export type InsertStoryConversationTurn =
  typeof storyConversationTurns.$inferInsert;

export const storyConversationMessages = mysqlTable(
  "story_conversation_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId")
      .notNull()
      .references(() => storyConversations.id, { onDelete: "cascade" }),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    turnId: int("turnId").references(() => storyConversationTurns.id, {
      onDelete: "set null",
    }),
    role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
    content: text("content").notNull(),
    source: varchar("source", { length: 128 }),
    clientMessageId: varchar("clientMessageId", { length: 128 }),
    candidateRevisionId: int("candidateRevisionId").references(
      () => promptRevisions.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    conversationOrder: index("story_conversation_messages_order").on(
      table.conversationId,
      table.id
    ),
    clientMessage: uniqueIndex("story_conversation_messages_client_unique").on(
      table.conversationId,
      table.clientMessageId
    ),
    turnRole: uniqueIndex("story_conversation_messages_turn_role_unique").on(
      table.turnId,
      table.role
    ),
  })
);

export type StoryConversationMessage =
  typeof storyConversationMessages.$inferSelect;
export type InsertStoryConversationMessage =
  typeof storyConversationMessages.$inferInsert;

export const storyMessageReferences = mysqlTable(
  "story_message_references",
  {
    id: int("id").autoincrement().primaryKey(),
    messageId: int("messageId")
      .notNull()
      .references(() => storyConversationMessages.id, { onDelete: "cascade" }),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    objectType: varchar("objectType", { length: 64 }).notNull(),
    objectId: varchar("objectId", { length: 255 }).notNull(),
    objectVersion: varchar("objectVersion", { length: 128 }),
    selection: json("selection"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    messageLookup: index("story_message_references_message").on(
      table.messageId
    ),
  })
);

export type StoryMessageReference = typeof storyMessageReferences.$inferSelect;
export type InsertStoryMessageReference =
  typeof storyMessageReferences.$inferInsert;

export const artPromptLibraries = mysqlTable(
  "art_prompt_libraries",
  {
    id: int("id").autoincrement().primaryKey(),
    kind: mysqlEnum("kind", ["system", "user"]).notNull(),
    ownerUserId: int("ownerUserId").references(() => users.id, {
      onDelete: "cascade",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerName: index("art_prompt_libraries_owner_name").on(
      table.ownerUserId,
      table.name
    ),
  })
);

export type ArtPromptLibrary = typeof artPromptLibraries.$inferSelect;
export type InsertArtPromptLibrary = typeof artPromptLibraries.$inferInsert;

export const artPromptLibraryVersions = mysqlTable(
  "art_prompt_library_versions",
  {
    id: int("id").autoincrement().primaryKey(),
    libraryId: int("libraryId")
      .notNull()
      .references(() => artPromptLibraries.id, { onDelete: "cascade" }),
    version: int("version").notNull(),
    status: mysqlEnum("status", ["draft", "published"])
      .default("draft")
      .notNull(),
    contentFingerprint: varchar("contentFingerprint", {
      length: 128,
    }).notNull(),
    source: varchar("source", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    publishedAt: timestamp("publishedAt"),
  },
  table => ({
    libraryVersion: uniqueIndex("art_prompt_library_versions_number_unique").on(
      table.libraryId,
      table.version
    ),
    libraryFingerprint: uniqueIndex(
      "art_prompt_library_versions_fingerprint_unique"
    ).on(table.libraryId, table.contentFingerprint),
  })
);

export type ArtPromptLibraryVersion =
  typeof artPromptLibraryVersions.$inferSelect;
export type InsertArtPromptLibraryVersion =
  typeof artPromptLibraryVersions.$inferInsert;

export const artPromptLibraryItems = mysqlTable(
  "art_prompt_library_items",
  {
    id: int("id").autoincrement().primaryKey(),
    libraryVersionId: int("libraryVersionId")
      .notNull()
      .references(() => artPromptLibraryVersions.id, { onDelete: "cascade" }),
    dimension: varchar("dimension", { length: 128 }).notNull(),
    content: text("content").notNull(),
    negativeContent: text("negativeContent"),
    sourceRevisionId: int("sourceRevisionId").references(
      () => promptRevisions.id,
      { onDelete: "set null" }
    ),
    sortOrder: int("sortOrder").default(0).notNull(),
  },
  table => ({
    versionOrder: index("art_prompt_library_items_version_order").on(
      table.libraryVersionId,
      table.sortOrder
    ),
  })
);

export type ArtPromptLibraryItem = typeof artPromptLibraryItems.$inferSelect;
export type InsertArtPromptLibraryItem =
  typeof artPromptLibraryItems.$inferInsert;

export const storyArtPromptBindings = mysqlTable(
  "story_art_prompt_bindings",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    libraryVersionId: int("libraryVersionId")
      .notNull()
      .references(() => artPromptLibraryVersions.id, {
        onDelete: "restrict",
      }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    storyOwner: uniqueIndex("story_art_prompt_bindings_story_unique").on(
      table.storyId,
      table.userId
    ),
  })
);

export type StoryArtPromptBinding = typeof storyArtPromptBindings.$inferSelect;
export type InsertStoryArtPromptBinding =
  typeof storyArtPromptBindings.$inferInsert;

export const promptOperationReceipts = mysqlTable(
  "prompt_operation_receipts",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationKey: varchar("operationKey", { length: 255 }).notNull(),
    committedVersion: int("committedVersion").notNull(),
    result: json("result"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    ownerOperation: uniqueIndex(
      "prompt_operation_receipts_owner_operation_unique"
    ).on(table.storyId, table.userId, table.operationKey),
  })
);

export type PromptOperationReceipt =
  typeof promptOperationReceipts.$inferSelect;
export type InsertPromptOperationReceipt =
  typeof promptOperationReceipts.$inferInsert;

/**
 * GeneratedImages — AI 生成的图片记录（统一表，桌面端+手机端共用）。
 *
 * 桌面端（Creation Engine）通过 projectId + shotNo(varchar) 关联镜头；
 * 手机端（Mobile Chat）通过 storyId + userId 关联故事。
 * 两端共享版本链能力（parentImageId → isCurrent）。
 */
export const generatedImages = mysqlTable("generated_images", {
  id: int("id").autoincrement().primaryKey(),
  // 桌面端 Creation Engine 用
  projectId: int("projectId"),
  // 手机端 Mobile Chat 用
  storyId: int("storyId"),
  userId: int("userId"),
  // shotNo: 桌面端传 "SH02" 格式字符串，手机端传数字的字符串形式
  shotNo: varchar("shotNo", { length: 32 }),
  // 稳定镜头身份：跨故事体、图片、视频和聊天选区的主关联键。shotNo 只负责展示和旧数据兜底。
  shotIdentity: varchar("shotIdentity", { length: 128 }),
  imageKey: varchar("imageKey", { length: 512 }), // 桌面端存储 key
  imageUrl: text("imageUrl").notNull(),
  prompt: text("prompt"),
  promptCompilationId: int("promptCompilationId").references(
    () => promptCompilations.id,
    { onDelete: "set null" }
  ),
  generationType: mysqlEnum("generationType", [
    "generate",
    "initial",
    "inpaint",
  ])
    .default("generate")
    .notNull(),
  parentImageId: int("parentImageId"),
  isCurrent: mysqlBoolean("isCurrent").default(true).notNull(),
  maskKey: varchar("maskKey", { length: 512 }), // 桌面端 inpaint 蒙版
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GeneratedImage = typeof generatedImages.$inferSelect;
export type InsertGeneratedImage = typeof generatedImages.$inferInsert;

export const previewMaskedImageOperations = mysqlTable(
  "preview_masked_image_operations",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationToken: varchar("operationToken", { length: 160 }).notNull(),
    inputHash: varchar("inputHash", { length: 64 }).notNull(),
    // Keep the source id as an audit tombstone. A restrictive foreign key
    // would make ordinary image/story deletion fail once a paid receipt exists.
    sourceImageId: int("sourceImageId").notNull(),
    maskKey: varchar("maskKey", { length: 512 }).notNull(),
    targetKind: mysqlEnum("targetKind", [
      "shot-primary",
      "timeline-image-clip",
    ]).notNull(),
    stableShotId: varchar("stableShotId", { length: 240 }).notNull(),
    clipId: varchar("clipId", { length: 240 }),
    quoteId: varchar("quoteId", { length: 64 }).notNull(),
    currency: varchar("currency", { length: 8 }).default("CNY").notNull(),
    estimatedCny: float("estimatedCny").notNull(),
    quoteExpiresAt: timestamp("quoteExpiresAt").notNull(),
    claimToken: varchar("claimToken", { length: 64 }).notNull(),
    leaseUntil: timestamp("leaseUntil").notNull(),
    attempt: int("attempt").default(1).notNull(),
    status: mysqlEnum("status", [
      "claimed",
      "provider_accepted",
      "succeeded",
      "failed",
      "unknown",
    ]).notNull(),
    providerTaskId: varchar("providerTaskId", { length: 255 }),
    candidateImageId: int("candidateImageId").references(
      () => generatedImages.id,
      { onDelete: "set null" }
    ),
    errorCode: varchar("errorCode", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerToken: uniqueIndex("preview_masked_image_owner_token_unique").on(
      table.storyId,
      table.userId,
      table.operationToken
    ),
    candidateLookup: index("preview_masked_image_candidate_index").on(
      table.candidateImageId
    ),
    inputLookup: index("preview_masked_image_input_index").on(
      table.storyId,
      table.userId,
      table.inputHash
    ),
  })
);

export type PreviewMaskedImageOperation =
  typeof previewMaskedImageOperations.$inferSelect;
export type InsertPreviewMaskedImageOperation =
  typeof previewMaskedImageOperations.$inferInsert;

export const timelineFrameExtractionOperations = mysqlTable(
  "timeline_frame_extraction_operations",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: varchar("requestId", { length: 160 }).notNull(),
    inputHash: varchar("inputHash", { length: 64 }).notNull(),
    timelineFrame: int("timelineFrame").notNull(),
    operationLayer: int("operationLayer").notNull(),
    claimToken: varchar("claimToken", { length: 64 }).notNull(),
    leaseUntil: timestamp("leaseUntil").notNull(),
    attempt: int("attempt").default(1).notNull(),
    status: mysqlEnum("status", [
      "claimed",
      "asset_ready",
      "succeeded",
      "failed",
    ]).notNull(),
    winnerIdentity: varchar("winnerIdentity", { length: 255 }),
    descriptor: json("descriptor"),
    imageId: int("imageId").references(() => generatedImages.id, {
      onDelete: "set null",
    }),
    clipId: varchar("clipId", { length: 255 }),
    timelineVersion: int("timelineVersion"),
    errorCode: varchar("errorCode", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerRequest: uniqueIndex(
      "timeline_frame_extraction_owner_request_unique"
    ).on(table.storyId, table.userId, table.requestId),
    imageLookup: index("timeline_frame_extraction_image_index").on(
      table.imageId
    ),
  })
);

export type TimelineFrameExtractionOperation =
  typeof timelineFrameExtractionOperations.$inferSelect;
export type InsertTimelineFrameExtractionOperation =
  typeof timelineFrameExtractionOperations.$inferInsert;

/**
 * StoryAudioAsset (U2) — the managed audio bytes boundary. A Timeline audio
 * clip only ever holds a non-owning `assetId`; deleting/undoing a clip must
 * never touch the row or the file here. `storageKey` is opaque and minted
 * server-side (see server/services/audioMedia.ts); `checksum` + `sourceKey`
 * give per-Story idempotent reuse of a `ready` asset.
 */
export const storyAudioAssets = mysqlTable(
  "story_audio_assets",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageKey: varchar("storageKey", { length: 64 }).notNull(),
    displayName: varchar("displayName", { length: 200 }).notNull(),
    /** Semantic role hint recorded at import; the Timeline track owns the real kind. */
    mediaKind: mysqlEnum("mediaKind", [
      "narration",
      "music",
      "ambience",
      "sfx",
      "source",
      "unknown",
    ])
      .notNull()
      .default("unknown"),
    sourceKind: mysqlEnum("sourceKind", [
      "local-upload",
      "chatcut",
      "tts",
    ]).notNull(),
    /** Stable identity of the upstream bytes, for idempotent reuse within a Story. */
    sourceKey: varchar("sourceKey", { length: 255 }),
    checksum: varchar("checksum", { length: 64 }),
    status: mysqlEnum("status", ["pending", "ready", "failed"])
      .notNull()
      .default("pending"),
    failureReason: varchar("failureReason", { length: 255 }),
    durationFrames: int("durationFrames"),
    durationSeconds: float("durationSeconds"),
    sampleRate: int("sampleRate"),
    channels: int("channels"),
    codecName: varchar("codecName", { length: 64 }),
    formatName: varchar("formatName", { length: 128 }),
    /** Source-kind specific provenance (TTS operation, ChatCut clip id, upload name). */
    provenance: json("provenance"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    storyLookup: index("story_audio_assets_story_index").on(
      table.storyId,
      table.userId
    ),
    storageKeyUnique: uniqueIndex("story_audio_assets_storage_key_unique").on(
      table.storageKey
    ),
    reuseLookup: index("story_audio_assets_reuse_index").on(
      table.storyId,
      table.userId,
      table.sourceKind,
      table.sourceKey
    ),
    idUserUnique: uniqueIndex("story_audio_assets_id_user_unique").on(
      table.id,
      table.userId
    ),
  })
);

export type StoryAudioAsset = typeof storyAudioAssets.$inferSelect;
export type InsertStoryAudioAsset = typeof storyAudioAssets.$inferInsert;

/**
 * The recoverable staged-import state machine for one set of audio bytes. The
 * filesystem and the DB never pretend to share a transaction: this row is the
 * single source of truth a crash recovery pass reads to replay, compensate, or
 * clean up.
 */
export const storyAudioImportOperations = mysqlTable(
  "story_audio_import_operations",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: varchar("operationId", { length: 128 }).notNull(),
    assetId: int("assetId"),
    sourceKind: mysqlEnum("sourceKind", [
      "local-upload",
      "chatcut",
      "tts",
    ]).notNull(),
    /** pending -> staged -> probed -> ready | failed */
    status: mysqlEnum("status", [
      "pending",
      "staged",
      "probed",
      "ready",
      "failed",
    ])
      .notNull()
      .default("pending"),
    failureCode: varchar("failureCode", { length: 128 }),
    stagingKey: varchar("stagingKey", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerOperationUnique: uniqueIndex(
      "story_audio_import_owner_operation_unique"
    ).on(table.storyId, table.userId, table.operationId),
    recoveryLookup: index("story_audio_import_recovery_index").on(
      table.status,
      table.updatedAt
    ),
  })
);

export type StoryAudioImportOperation =
  typeof storyAudioImportOperations.$inferSelect;
export type InsertStoryAudioImportOperation =
  typeof storyAudioImportOperations.$inferInsert;

/**
 * VideoTakes — 单镜头图生视频产物。storyId + stableShotId 是唯一业务归属；
 * taskId 只是供应商任务句柄，videoKey 是后续托管素材库的对象 key。
 */
export const videoTakes = mysqlTable("video_takes", {
  id: int("id").autoincrement().primaryKey(),
  storyId: int("storyId").notNull(),
  userId: int("userId").notNull(),
  stableShotId: varchar("stableShotId", { length: 128 }).notNull(),
  sourceImageId: int("sourceImageId"),
  promptCompilationId: int("promptCompilationId").references(
    () => promptCompilations.id,
    { onDelete: "set null" }
  ),
  status: mysqlEnum("status", [
    "submitted",
    "processing",
    "available",
    "failed",
    "timeout",
    "unfollowable",
  ])
    .default("submitted")
    .notNull(),
  taskId: varchar("taskId", { length: 255 }),
  provider: varchar("provider", { length: 64 }).default("302").notNull(),
  model: varchar("model", { length: 128 }).notNull(),
  prompt: text("prompt").notNull(),
  subtitle: text("subtitle"),
  durationSec: float("durationSec"),
  aspectRatio: varchar("aspectRatio", { length: 32 }).default("16:9").notNull(),
  videoKey: varchar("videoKey", { length: 512 }),
  videoUrl: text("videoUrl"),
  errorMessage: text("errorMessage"),
  parameterSnapshot: json("parameterSnapshot"),
  idempotencyKey: varchar("idempotencyKey", { length: 255 }),
  extractionCapability: mysqlEnum("extractionCapability", [
    "available",
    "unavailable",
  ])
    .default("unavailable")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoTake = typeof videoTakes.$inferSelect;
export type InsertVideoTake = typeof videoTakes.$inferInsert;

export const videoTakeRanges = mysqlTable("video_take_ranges", {
  id: int("id").autoincrement().primaryKey(),
  takeId: int("takeId").notNull(),
  storyId: int("storyId").notNull(),
  userId: int("userId").notNull(),
  stableShotId: varchar("stableShotId", { length: 128 }).notNull(),
  startSec: float("startSec").notNull(),
  endSec: float("endSec").notNull(),
  label: varchar("label", { length: 255 }),
  source: mysqlEnum("source", ["manual", "extracted"])
    .default("manual")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoTakeRange = typeof videoTakeRanges.$inferSelect;
export type InsertVideoTakeRange = typeof videoTakeRanges.$inferInsert;

export const videoTimelineSelections = mysqlTable("video_timeline_selections", {
  id: int("id").autoincrement().primaryKey(),
  storyId: int("storyId").notNull(),
  userId: int("userId").notNull(),
  stableShotId: varchar("stableShotId", { length: 128 }).notNull(),
  takeId: int("takeId").notNull(),
  rangeId: int("rangeId"),
  selectionType: mysqlEnum("selectionType", ["full_take", "range"])
    .default("full_take")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoTimelineSelection =
  typeof videoTimelineSelections.$inferSelect;
export type InsertVideoTimelineSelection =
  typeof videoTimelineSelections.$inferInsert;

export const storyTimelines = mysqlTable(
  "story_timelines",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId").notNull(),
    userId: int("userId").notNull(),
    version: int("version").default(1).notNull(),
    items: json("items").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    storyOwner: uniqueIndex("story_timelines_story_owner_unique").on(
      table.storyId,
      table.userId
    ),
  })
);

export type StoryTimeline = typeof storyTimelines.$inferSelect;
export type InsertStoryTimeline = typeof storyTimelines.$inferInsert;

export const shotDerivationDrafts = mysqlTable("shot_derivation_drafts", {
  id: int("id").autoincrement().primaryKey(),
  storyId: int("storyId").notNull(),
  userId: int("userId").notNull(),
  sourceStableShotId: varchar("sourceStableShotId", { length: 128 }).notNull(),
  sourceTakeId: int("sourceTakeId").notNull(),
  sourceTimeSec: float("sourceTimeSec").notNull(),
  crop: json("crop").notNull(),
  fullFrameImageUrl: text("fullFrameImageUrl").notNull(),
  cropImageUrl: text("cropImageUrl").notNull(),
  referenceRole: mysqlEnum("referenceRole", [
    "person",
    "scene",
    "object",
    "composition",
  ]),
  analysis: json("analysis"),
  proposal: json("proposal"),
  candidateImageIds: json("candidateImageIds"),
  provisionalStableShotId: varchar("provisionalStableShotId", {
    length: 128,
  }).notNull(),
  status: mysqlEnum("status", ["draft", "ready", "confirmed", "reverted"])
    .default("draft")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ShotDerivationDraft = typeof shotDerivationDrafts.$inferSelect;
export type InsertShotDerivationDraft =
  typeof shotDerivationDrafts.$inferInsert;

export const storyOperations = mysqlTable("story_operations", {
  id: int("id").autoincrement().primaryKey(),
  storyId: int("storyId").notNull(),
  userId: int("userId").notNull(),
  kind: mysqlEnum("kind", ["derive_shot"]).notNull(),
  status: mysqlEnum("status", ["applied", "reverted"])
    .default("applied")
    .notNull(),
  beforeState: json("beforeState").notNull(),
  afterStoryRevision: int("afterStoryRevision").notNull(),
  afterTimelineVersion: int("afterTimelineVersion").notNull(),
  draftId: int("draftId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StoryOperation = typeof storyOperations.$inferSelect;
export type InsertStoryOperation = typeof storyOperations.$inferInsert;

/**
 * ImageSignals — 用户对图片的交互信号（左划/右划/编辑等），时序事件流。
 */
export const imageSignals = mysqlTable("image_signals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  storyId: int("storyId").notNull(),
  imageId: int("imageId"),
  action: mysqlEnum("action", [
    "swipe_left",
    "swipe_right",
    "edit_start",
    "edit_complete",
    "chat_correction",
  ]).notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ImageSignal = typeof imageSignals.$inferSelect;
export type InsertImageSignal = typeof imageSignals.$inferInsert;

/**
 * Edit snapshots — captures project state at generation boundaries
 */
export const editSnapshots = mysqlTable("edit_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  sessionId: varchar("sessionId", { length: 128 }).notNull(),
  state: json("state").notNull(),
  previousSnapshotId: int("previousSnapshotId"),
  diff: json("diff"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export type EditSnapshot = typeof editSnapshots.$inferSelect;
export type InsertEditSnapshot = typeof editSnapshots.$inferInsert;

/**
 * Semantic annotations — LLM-generated preference inferences from edit diffs
 */
export const semanticAnnotations = mysqlTable("semantic_annotations", {
  id: int("id").autoincrement().primaryKey(),
  snapshotId: int("snapshotId").notNull(),
  previousSnapshotId: int("previousSnapshotId"),
  factualChanges: text("factualChanges").notNull(),
  inferredPreferences: text("inferredPreferences").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  status: mysqlEnum("status", ["pending", "active", "archived"])
    .default("active")
    .notNull(),
});

export type SemanticAnnotation = typeof semanticAnnotations.$inferSelect;
export type InsertSemanticAnnotation = typeof semanticAnnotations.$inferInsert;

/**
 * EmailOtps — 邮箱 OTP 验证码记录
 */
export const emailOtps = mysqlTable("email_otps", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  code: varchar("code", { length: 16 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmailOtp = typeof emailOtps.$inferSelect;
export type InsertEmailOtp = typeof emailOtps.$inferInsert;

/**
 * InviteCodes — 内测邀请码。
 *
 * 数据库只保存 SHA-256 哈希，不保存可直接使用的原始邀请码。邀请码首次成功
 * 登录时绑定邮箱；此后每次登录仍需提交同一邀请码，且只能由绑定邮箱使用。
 */
export const inviteCodes = mysqlTable(
  "invite_codes",
  {
    id: int("id").autoincrement().primaryKey(),
    codeHash: varchar("codeHash", { length: 64 }).notNull(),
    label: varchar("label", { length: 255 }),
    redeemedByEmail: varchar("redeemedByEmail", { length: 320 }),
    redeemedByUserId: int("redeemedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expiresAt"),
    redeemedAt: timestamp("redeemedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    codeHashUnique: uniqueIndex("invite_codes_code_hash_unique").on(
      table.codeHash
    ),
    redeemedEmailIndex: index("invite_codes_redeemed_email_index").on(
      table.redeemedByEmail
    ),
  })
);

export type InviteCode = typeof inviteCodes.$inferSelect;
export type InsertInviteCode = typeof inviteCodes.$inferInsert;

/* ════════════════════════════════════════════════════════════════════════════
 * 统一账号、赠送卡与算力账本（U2 地基）
 *
 * 金额单位：**微元**，1 元 = 1_000_000 微元。用整数保存，避免浮点累计误差，
 * 同时保留比一分钱更细的模型用量精度。¥30 = 30_000_000。展示层统一格式化，
 * 数据库里永远不出现小数金额。
 *
 * 这一批表全部是新增的（additive / expand-compatible）：不改旧表语义、不删列、
 * 不在 migration 里猜历史归属。旧邀请码与历史用户数据由 U3/U5 显式回填。
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * AccountIdentities — 登录身份。
 *
 * 一个 `userId` 可以有多条身份（邮箱现在、微信以后），但 (provider, subject) 全局唯一，
 * 保证同一邮箱只解析到一个用户。冲突时上层必须停下来人工处理，不静默 merge。
 */
export const accountIdentities = mysqlTable(
  "account_identities",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: mysqlEnum("provider", ["email", "wechat"])
      .default("email")
      .notNull(),
    /** 标准化后的身份标识：邮箱走小写 trim，微信以后放 openid */
    subject: varchar("subject", { length: 320 }).notNull(),
    verifiedAt: timestamp("verifiedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    providerSubjectUnique: uniqueIndex("account_identities_provider_subject_unique").on(
      table.provider,
      table.subject
    ),
    userIndex: index("account_identities_user_index").on(table.userId),
  })
);

export type AccountIdentity = typeof accountIdentities.$inferSelect;
export type InsertAccountIdentity = typeof accountIdentities.$inferInsert;

/**
 * AccountCredentials — 密码等可校验凭据。
 *
 * `secret` 存版本化 scrypt record（含算法参数与随机 salt），永远不是裸 SHA-256。
 * 每个用户每种凭据只有一条。
 */
export const accountCredentials = mysqlTable(
  "account_credentials",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: mysqlEnum("kind", ["password"]).default("password").notNull(),
    /** 形如 scrypt$v1$N$r$p$<salt>$<hash>，参数升级时提升版本号重算 */
    secret: varchar("secret", { length: 512 }).notNull(),
    algorithmVersion: int("algorithmVersion").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userKindUnique: uniqueIndex("account_credentials_user_kind_unique").on(
      table.userId,
      table.kind
    ),
  })
);

export type AccountCredential = typeof accountCredentials.$inferSelect;
export type InsertAccountCredential = typeof accountCredentials.$inferInsert;

/**
 * AccountVerificationChallenges — 邮箱验证码挑战。
 *
 * 只保存带独立服务端 secret 和版本的摘要，泄库也不能离线枚举 6 位码。
 * 按用途隔离：登录、验证、找回互不通用。同邮箱同用途签发新挑战时旧挑战置 invalidatedAt。
 */
export const accountVerificationChallenges = mysqlTable(
  "account_verification_challenges",
  {
    id: int("id").autoincrement().primaryKey(),
    purpose: mysqlEnum("purpose", ["login", "verify", "recover"]).notNull(),
    normalizedEmail: varchar("normalizedEmail", { length: 320 }).notNull(),
    codeHash: varchar("codeHash", { length: 64 }).notNull(),
    secretVersion: int("secretVersion").default(1).notNull(),
    attemptCount: int("attemptCount").default(0).notNull(),
    maxAttempts: int("maxAttempts").default(5).notNull(),
    sentAt: timestamp("sentAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    invalidatedAt: timestamp("invalidatedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    lookupIndex: index("account_verification_challenges_lookup_index").on(
      table.normalizedEmail,
      table.purpose,
      table.expiresAt
    ),
  })
);

export type AccountVerificationChallenge =
  typeof accountVerificationChallenges.$inferSelect;
export type InsertAccountVerificationChallenge =
  typeof accountVerificationChallenges.$inferInsert;

/**
 * AccountRateLimits — 共享持久化限流。
 *
 * 必须落在 MySQL：PM2 重启或多进程时，进程内内存限流形同虚设。
 * `scope` 是用途（otp:send / otp:verify / gift:redeem…），`subject` 是邮箱、IP 或两者组合。
 */
export const accountRateLimits = mysqlTable(
  "account_rate_limits",
  {
    id: int("id").autoincrement().primaryKey(),
    scope: varchar("scope", { length: 64 }).notNull(),
    subject: varchar("subject", { length: 320 }).notNull(),
    windowStartedAt: timestamp("windowStartedAt").defaultNow().notNull(),
    windowSeconds: int("windowSeconds").notNull(),
    attemptCount: int("attemptCount").default(0).notNull(),
    blockedUntil: timestamp("blockedUntil"),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    scopeSubjectUnique: uniqueIndex("account_rate_limits_scope_subject_unique").on(
      table.scope,
      table.subject
    ),
  })
);

export type AccountRateLimit = typeof accountRateLimits.$inferSelect;
export type InsertAccountRateLimit = typeof accountRateLimits.$inferInsert;

/**
 * GiftCards — 一次性算力赠送卡。
 *
 * 与登录凭据分离：卡只负责「开通工作台 + 增加算力」，不是密码。
 * 不预绑邮箱，首个已验证账号原子领取；默认签发后 30 天未领取过期，
 * **领取后的余额不因卡过期而失效**。原码只在创建时出现一次，库里只有摘要。
 */
export const giftCards = mysqlTable(
  "gift_cards",
  {
    id: int("id").autoincrement().primaryKey(),
    codeHash: varchar("codeHash", { length: 64 }).notNull(),
    label: varchar("label", { length: 255 }),
    /** 面额，微元。¥30 = 30_000_000 */
    amountMinor: bigint("amountMinor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 8 }).default("CNY").notNull(),
    purpose: mysqlEnum("purpose", ["access_grant", "topup"])
      .default("access_grant")
      .notNull(),
    redeemedByUserId: int("redeemedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    redeemedAt: timestamp("redeemedAt"),
    revokedAt: timestamp("revokedAt"),
    expiresAt: timestamp("expiresAt"),
    /** 由旧邀请码转换而来时指回来源，保证重复迁移不重复赠送 */
    legacyInviteCodeId: int("legacyInviteCodeId").references(
      () => inviteCodes.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    codeHashUnique: uniqueIndex("gift_cards_code_hash_unique").on(table.codeHash),
    legacyInviteUnique: uniqueIndex("gift_cards_legacy_invite_unique").on(
      table.legacyInviteCodeId
    ),
    redeemedUserIndex: index("gift_cards_redeemed_user_index").on(
      table.redeemedByUserId
    ),
  })
);

export type GiftCard = typeof giftCards.$inferSelect;
export type InsertGiftCard = typeof giftCards.$inferInsert;

/**
 * CreditAccounts — 每个用户一行的余额投影，也是并发预占时被锁的那一行。
 *
 * **它不是事实来源**：事实来源永远是下面的 append-only 账本。这一行是账本在事务里
 * 维护的派生投影，存在的意义是让「检查余额 → 预占」能在一条 `SELECT ... FOR UPDATE`
 * 里原子完成，而不是每次去 SUM 全表。
 *
 * 可用余额 = balanceMinor − reservedMinor。
 */
export const creditAccounts = mysqlTable(
  "credit_accounts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 已入账余额，微元 */
    balanceMinor: bigint("balanceMinor", { mode: "number" }).default(0).notNull(),
    /** 活动预占合计，微元 */
    reservedMinor: bigint("reservedMinor", { mode: "number" }).default(0).notNull(),
    /** 累计消费，微元，只增不减 */
    lifetimeSpentMinor: bigint("lifetimeSpentMinor", { mode: "number" })
      .default(0)
      .notNull(),
    currency: varchar("currency", { length: 8 }).default("CNY").notNull(),
    accessEnabledAt: timestamp("accessEnabledAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userUnique: uniqueIndex("credit_accounts_user_unique").on(table.userId),
  })
);

export type CreditAccount = typeof creditAccounts.$inferSelect;
export type InsertCreditAccount = typeof creditAccounts.$inferInsert;

/**
 * CreditLedgerEntries — 不可改写的逐笔账本。只 append，永不 UPDATE、永不 DELETE。
 *
 * 人工调整也是新增一条 `adjustment`，不去改旧的消费记录。
 * `amountMinor` 带符号：赠送/退款/释放为正，消费为负。
 */
export const creditLedgerEntries = mysqlTable(
  "credit_ledger_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryType: mysqlEnum("entryType", [
      "gift",
      "adjustment",
      "consumption",
      "refund",
      "release",
    ]).notNull(),
    /** 带符号金额，微元 */
    amountMinor: bigint("amountMinor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 8 }).default("CNY").notNull(),
    /** 幂等键：同一笔业务事实重复写入被唯一约束挡下。允许为空（人工调整等） */
    idempotencyKey: varchar("idempotencyKey", { length: 191 }),
    operationId: varchar("operationId", { length: 128 }),
    giftCardId: int("giftCardId").references(() => giftCards.id, {
      onDelete: "set null",
    }),
    /** 人工调整时的操作者，用户自己的消费为空 */
    actorUserId: int("actorUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    reason: varchar("reason", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    idempotencyUnique: uniqueIndex("credit_ledger_entries_idempotency_unique").on(
      table.idempotencyKey
    ),
    userOrderIndex: index("credit_ledger_entries_user_order_index").on(
      table.userId,
      table.id
    ),
    operationIndex: index("credit_ledger_entries_operation_index").on(
      table.operationId
    ),
  })
);

export type CreditLedgerEntry = typeof creditLedgerEntries.$inferSelect;
export type InsertCreditLedgerEntry = typeof creditLedgerEntries.$inferInsert;

/**
 * BillingOperations — 业务层的一次付费操作。
 *
 * 一次 operation 只预占一次、只结算一次。`operationId` 全局唯一：
 * 同 id + 同 requestHash 重放只返回原状态；同 id 不同参数必须冲突而不是覆盖。
 * `submission_unknown` 保留 hold 进入对账，既不自动释放也不自动重提。
 */
export const billingOperations = mysqlTable(
  "billing_operations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: varchar("operationId", { length: 128 }).notNull(),
    operationType: varchar("operationType", { length: 64 }).notNull(),
    /** 稳定参数的规范化哈希，用于判定「同一次调用」 */
    requestHash: varchar("requestHash", { length: 128 }).notNull(),
    status: mysqlEnum("status", [
      "created",
      "reserved",
      "submitted",
      "submission_unknown",
      "settled",
      "released",
      "exception",
    ])
      .default("created")
      .notNull(),
    /** 可信最高费用（预占上界），微元。没有可信上界的入口不得提交 */
    maxCostMinor: bigint("maxCostMinor", { mode: "number" }).notNull(),
    /** 可核验实际费用，微元。结算前为空 */
    actualCostMinor: bigint("actualCostMinor", { mode: "number" }),
    storyId: int("storyId"),
    /** 高成本媒体报价的过期时间；过期报价必须被拒绝 */
    quoteExpiresAt: timestamp("quoteExpiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    operationUnique: uniqueIndex("billing_operations_operation_unique").on(
      table.operationId
    ),
    userOrderIndex: index("billing_operations_user_order_index").on(
      table.userId,
      table.id
    ),
    statusIndex: index("billing_operations_status_index").on(table.status),
  })
);

export type BillingOperation = typeof billingOperations.$inferSelect;
export type InsertBillingOperation = typeof billingOperations.$inferInsert;

/**
 * CreditHolds — 活动预占。一个 operation 最多一个 hold。
 *
 * 预占在锁定 credit_accounts 行的短事务里建立，供应商网络调用发生在事务之外，
 * 结算/释放再用新事务完成。
 */
export const creditHolds = mysqlTable(
  "credit_holds",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: varchar("operationId", { length: 128 }).notNull(),
    /** 预占金额，微元，始终为正 */
    amountMinor: bigint("amountMinor", { mode: "number" }).notNull(),
    status: mysqlEnum("status", ["active", "settled", "released", "exception"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    operationUnique: uniqueIndex("credit_holds_operation_unique").on(
      table.operationId
    ),
    userStatusIndex: index("credit_holds_user_status_index").on(
      table.userId,
      table.status
    ),
  })
);

export type CreditHold = typeof creditHolds.$inferSelect;
export type InsertCreditHold = typeof creditHolds.$inferInsert;

/**
 * ProviderAttempts — 供应商层的每次尝试。
 *
 * 与业务 operation 分层：业务层只预占/结算一次，这里记录 fallback、重试和真实用量，
 * 避免 router 漏算或 adapter 重复扣费。`providerTaskId` 已知时只允许恢复查询，
 * 没有确定提交结果时不自动重提。
 */
export const providerAttempts = mysqlTable(
  "provider_attempts",
  {
    id: int("id").autoincrement().primaryKey(),
    billingOperationId: int("billingOperationId")
      .notNull()
      .references(() => billingOperations.id, { onDelete: "cascade" }),
    attemptIndex: int("attemptIndex").default(1).notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    model: varchar("model", { length: 128 }),
    providerTaskId: varchar("providerTaskId", { length: 191 }),
    receiptId: varchar("receiptId", { length: 191 }),
    status: mysqlEnum("status", [
      "prepared",
      "submitted",
      "task_known",
      "succeeded",
      "charged_failure",
      "not_charged_failure",
      "submission_unknown",
    ])
      .default("prepared")
      .notNull(),
    usage: json("usage"),
    /** 该次尝试的可核验费用，微元 */
    costMinor: bigint("costMinor", { mode: "number" }),
    submittedAt: timestamp("submittedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    operationAttemptUnique: uniqueIndex("provider_attempts_operation_attempt_unique").on(
      table.billingOperationId,
      table.attemptIndex
    ),
    providerTaskUnique: uniqueIndex("provider_attempts_provider_task_unique").on(
      table.provider,
      table.providerTaskId
    ),
    statusIndex: index("provider_attempts_status_index").on(table.status),
  })
);

export type ProviderAttempt = typeof providerAttempts.$inferSelect;
export type InsertProviderAttempt = typeof providerAttempts.$inferInsert;

/**
 * RechargeRequests — 站内追加测试算力申请。
 *
 * 同一账号最多一个待处理申请，靠 `pendingSlot` 实现：pending 时为 'pending'，
 * 终态时置 NULL。MySQL 唯一索引忽略 NULL，所以历史申请可以有任意多条。
 * 批准与账本入账在同一事务；终态不可再次审批。
 */
export const rechargeRequests = mysqlTable(
  "recharge_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 用户申请金额，微元 */
    requestedAmountMinor: bigint("requestedAmountMinor", { mode: "number" }).notNull(),
    /** 管理员实际批准金额，微元；拒绝时为空 */
    approvedAmountMinor: bigint("approvedAmountMinor", { mode: "number" }),
    status: mysqlEnum("status", ["pending", "approved", "rejected"])
      .default("pending")
      .notNull(),
    /** pending 时为 'pending'，终态置 NULL —— 每人只允许一个待处理申请 */
    pendingSlot: varchar("pendingSlot", { length: 16 }),
    userReason: text("userReason"),
    decisionReason: varchar("decisionReason", { length: 255 }),
    decidedByUserId: int("decidedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decidedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    pendingUnique: uniqueIndex("recharge_requests_pending_unique").on(
      table.userId,
      table.pendingSlot
    ),
    userOrderIndex: index("recharge_requests_user_order_index").on(
      table.userId,
      table.id
    ),
  })
);

export type RechargeRequest = typeof rechargeRequests.$inferSelect;
export type InsertRechargeRequest = typeof rechargeRequests.$inferInsert;

/**
 * DataMigrationReceipts — 三来源导入的幂等凭据。
 *
 * 每个来源 + 批次一条 receipt，重复导入必须零新增、零重复赠送。
 * `details` 里放 counts、hash 和映射摘要，供 before/after 报告核对。
 */
export const dataMigrationReceipts = mysqlTable(
  "data_migration_receipts",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 来源标识：legacy_mysql / staging_mysql / local_persist… */
    sourceKey: varchar("sourceKey", { length: 128 }).notNull(),
    batchKey: varchar("batchKey", { length: 128 }).notNull(),
    /** 来源快照摘要，导入过程中来源发生变化时能发现 */
    sourceHash: varchar("sourceHash", { length: 64 }).notNull(),
    recordCount: int("recordCount").default(0).notNull(),
    details: json("details"),
    appliedAt: timestamp("appliedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    sourceBatchUnique: uniqueIndex("data_migration_receipts_source_batch_unique").on(
      table.sourceKey,
      table.batchKey
    ),
  })
);

export type DataMigrationReceipt = typeof dataMigrationReceipts.$inferSelect;
export type InsertDataMigrationReceipt = typeof dataMigrationReceipts.$inferInsert;

// ─── 个人记忆（U1 数据合同）────────────────────────────────────────────
//
// 语义定义在 shared/personalMemory.ts，本地模式（server/db.ts）读同一份。
// 这里只负责把两条不变量落到数据库自己能强制的层面：
//
// 1. 参与事件唯一性的六列**全部 NOT NULL**。MySQL 的唯一索引会放过任意多行
//    NULL，任何一列可空都等于把幂等保证悄悄取消掉。
// 2. 跨账号引用由**包含 userId 的复合外键**挡住，而不是只靠 repository 记得
//    带 where。repository 仍然必须显式带用户条件——那是纵深防御的第二层，
//    不是第一层。

/**
 * PersonalMemorySources — 租户来源注册表。
 *
 * 聊天消息、发布版本、图片、理解……来源是多态的，没法各自建外键。
 * 先把「这个用户拥有这个来源」登记在这里，事件／证据／任务再用
 * (id, userId) 复合外键指过来，跨租户引用在数据库层就写不进去。
 */
export const personalMemorySources = mysqlTable(
  "personal_memory_sources",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceType: varchar("sourceType", { length: 32 }).notNull(),
    sourceKey: varchar("sourceKey", { length: 191 }).notNull(),
    /** 来源所属 Story（可空：每日留言与理解不属于任何 Story）。 */
    storyId: int("storyId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userSourceUnique: uniqueIndex("personal_memory_sources_user_unique").on(
      table.userId,
      table.sourceType,
      table.sourceKey
    ),
    // 复合外键的落点。没有它，下面几张表的 (xxxId, userId) 引用无处可指。
    idUserUnique: uniqueIndex("personal_memory_sources_id_user_unique").on(
      table.id,
      table.userId
    ),
  })
);

export type PersonalMemorySource = typeof personalMemorySources.$inferSelect;
export type InsertPersonalMemorySource =
  typeof personalMemorySources.$inferInsert;

/**
 * PersonalMemoryEvents — 账号级不可变经历事件。
 *
 * 正文仍归来源权威所有；这里只对「当次发生时用户说了／采用了什么」负责，
 * 不反向覆盖来源当前状态。
 */
export const personalMemoryEvents = mysqlTable(
  "personal_memory_events",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceId: int("sourceId").notNull(),
    // 下面六列构成规范身份，全部 NOT NULL。
    sourceType: varchar("sourceType", { length: 32 }).notNull(),
    sourceKey: varchar("sourceKey", { length: 191 }).notNull(),
    sourceRevision: varchar("sourceRevision", { length: 64 }).notNull(),
    actionKind: varchar("actionKind", { length: 32 }).notNull(),
    actionId: varchar("actionId", { length: 191 }).notNull(),
    /** 中国时区日期。跨日修改不重写旧日期。 */
    occurredOn: varchar("occurredOn", { length: 10 }).notNull(),
    occurredAt: timestamp("occurredAt").notNull(),
    /** 最小必要摘录；来源删除后清空。 */
    excerpt: text("excerpt"),
    /** 仅供一致性校验，不得当作可恢复正文或删除后的语义匹配材料。 */
    contentHash: varchar("contentHash", { length: 128 }),
    display: json("display"),
    /** 来源被明确删除后置真：内容已清除，只留无内容 tombstone。 */
    contentScrubbed: mysqlBoolean("contentScrubbed").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    identityUnique: uniqueIndex("personal_memory_events_identity_unique").on(
      table.userId,
      table.sourceType,
      table.sourceKey,
      table.sourceRevision,
      table.actionKind,
      table.actionId
    ),
    idUserUnique: uniqueIndex("personal_memory_events_id_user_unique").on(
      table.id,
      table.userId
    ),
    // 足迹按 occurredAt DESC, id DESC 做 keyset 分页，这条索引就是它的支撑。
    timelineIndex: index("personal_memory_events_timeline_index").on(
      table.userId,
      table.occurredAt,
      table.id
    ),
    sourceFk: foreignKey({
      columns: [table.sourceId, table.userId],
      foreignColumns: [personalMemorySources.id, personalMemorySources.userId],
      name: "personal_memory_events_source_fk",
    }),
  })
);

export type PersonalMemoryEvent = typeof personalMemoryEvents.$inferSelect;
export type InsertPersonalMemoryEvent =
  typeof personalMemoryEvents.$inferInsert;

/**
 * PersonalMemoryInsights — 派生理解的版本化状态机。
 *
 * 纠正产生新版本并 supersede 旧版本，旧话不被改写成新结论。
 */
export const personalMemoryInsights = mysqlTable(
  "personal_memory_insights",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 同一条理解跨版本的稳定身份；忘记抑制绑定在它上面。 */
    lineageKey: varchar("lineageKey", { length: 191 }).notNull(),
    revision: int("revision").notNull(),
    state: mysqlEnum("state", [
      "active",
      "superseded",
      "archived",
      "unsupported",
      "forgotten",
    ])
      .default("active")
      .notNull(),
    /** 用户明确陈述与纠正的可信级别高于系统推断。 */
    origin: mysqlEnum("origin", [
      "user_stated",
      "user_corrected",
      "inferred",
    ]).notNull(),
    category: mysqlEnum("category", [
      "fact",
      "preference",
      "relationship",
      "goal",
      "concern",
      "reflection",
    ]).notNull(),
    /** forgotten 后为 NULL：正文已清除。 */
    text: text("text"),
    scope: json("scope"),
    confidence: float("confidence").default(0).notNull(),
    /** 敏感主题默认不允许来信主动提及。 */
    allowProactiveMention: mysqlBoolean("allowProactiveMention")
      .default(false)
      .notNull(),
    supersededByInsightId: int("supersededByInsightId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    lineageRevisionUnique: uniqueIndex(
      "personal_memory_insights_lineage_unique"
    ).on(table.userId, table.lineageKey, table.revision),
    idUserUnique: uniqueIndex("personal_memory_insights_id_user_unique").on(
      table.id,
      table.userId
    ),
    userStateIndex: index("personal_memory_insights_user_state_index").on(
      table.userId,
      table.state
    ),
  })
);

export type PersonalMemoryInsight = typeof personalMemoryInsights.$inferSelect;
export type InsertPersonalMemoryInsight =
  typeof personalMemoryInsights.$inferInsert;

/** PersonalMemoryEvidence — 理解与经历之间的多对多证据边。 */
export const personalMemoryEvidence = mysqlTable(
  "personal_memory_evidence",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    insightId: int("insightId").notNull(),
    eventId: int("eventId").notNull(),
    /** 建边时看到的来源修订；旧任务不能拿过期修订复活理解。 */
    sourceRevision: varchar("sourceRevision", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    edgeUnique: uniqueIndex("personal_memory_evidence_edge_unique").on(
      table.insightId,
      table.eventId
    ),
    insightFk: foreignKey({
      columns: [table.insightId, table.userId],
      foreignColumns: [personalMemoryInsights.id, personalMemoryInsights.userId],
      name: "personal_memory_evidence_insight_fk",
    }),
    eventFk: foreignKey({
      columns: [table.eventId, table.userId],
      foreignColumns: [personalMemoryEvents.id, personalMemoryEvents.userId],
      name: "personal_memory_evidence_event_fk",
    }),
  })
);

export type PersonalMemoryEvidenceEdge =
  typeof personalMemoryEvidence.$inferSelect;
export type InsertPersonalMemoryEvidenceEdge =
  typeof personalMemoryEvidence.$inferInsert;

/**
 * PersonalMemorySuppressions — 忘记 tombstone。
 *
 * 只阻止**旧证据**重新生成同一理解，不承诺对未来新表达做语义级永久封禁。
 * 里面不存原文。
 */
export const personalMemorySuppressions = mysqlTable(
  "personal_memory_suppressions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lineageKey: varchar("lineageKey", { length: 191 }).notNull(),
    /** 被禁止再次成为证据的事件 ID 列表。 */
    suppressedEventIds: json("suppressedEventIds").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    lineageUnique: uniqueIndex(
      "personal_memory_suppressions_lineage_unique"
    ).on(table.userId, table.lineageKey),
  })
);

export type PersonalMemorySuppression =
  typeof personalMemorySuppressions.$inferSelect;
export type InsertPersonalMemorySuppression =
  typeof personalMemorySuppressions.$inferInsert;

/**
 * PersonalMemoryJobs — 耐久提炼任务。
 *
 * `operationId` 同时是算力账本的 operation ID：提炼是计费动作，
 * 预占／结算／对账都用它，重复投递不得重复扣费。
 */
export const personalMemoryJobs = mysqlTable(
  "personal_memory_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: int("eventId").notNull(),
    operationId: varchar("operationId", { length: 128 }).notNull(),
    extractorVersion: varchar("extractorVersion", { length: 64 }).notNull(),
    state: mysqlEnum("state", [
      "pending",
      "claimed",
      "succeeded",
      "failed",
      "permanently_failed",
      "cancelled",
    ])
      .default("pending")
      .notNull(),
    attempts: int("attempts").default(0).notNull(),
    /** claim 令牌；完成时按它条件提交，过期 lease 不能覆盖新状态。 */
    leaseToken: varchar("leaseToken", { length: 64 }),
    leaseExpiresAt: timestamp("leaseExpiresAt"),
    availableAt: timestamp("availableAt").notNull(),
    /** 只记错误类别，不记原话与 prompt。 */
    lastErrorKind: varchar("lastErrorKind", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    operationUnique: uniqueIndex("personal_memory_jobs_operation_unique").on(
      table.operationId
    ),
    // 同一事件 + 同一提炼器版本只排一次；换版本才产生新任务。
    eventExtractorUnique: uniqueIndex("personal_memory_jobs_event_unique").on(
      table.eventId,
      table.extractorVersion
    ),
    claimIndex: index("personal_memory_jobs_claim_index").on(
      table.state,
      table.availableAt
    ),
    eventFk: foreignKey({
      columns: [table.eventId, table.userId],
      foreignColumns: [personalMemoryEvents.id, personalMemoryEvents.userId],
      name: "personal_memory_jobs_event_fk",
    }),
  })
);

export type PersonalMemoryJob = typeof personalMemoryJobs.$inferSelect;
export type InsertPersonalMemoryJob = typeof personalMemoryJobs.$inferInsert;

/**
 * PersonalMemoryPrivacyEpochs — 用户级隐私 epoch，每个用户一行。
 *
 * 忘记或删除来源时在同一短事务里递增，使在途的来信生成即使已经拿到模型结果
 * 也无法提交旧输入。
 */
export const personalMemoryPrivacyEpochs = mysqlTable(
  "personal_memory_privacy_epochs",
  {
    userId: int("userId")
      .notNull()
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    epoch: int("epoch").default(1).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  }
);

export type PersonalMemoryPrivacyEpoch =
  typeof personalMemoryPrivacyEpochs.$inferSelect;
export type InsertPersonalMemoryPrivacyEpoch =
  typeof personalMemoryPrivacyEpochs.$inferInsert;

/**
 * EmotionDailyLetterVersions — 不可变每日来信版本。
 *
 * **这是来信正文的唯一权威**。`emotion_daily_letters` 从 U1 起降级为
 * 「当前版本指针 + 可重建兼容投影」，不接受独立正文写入。
 *
 * envelope 永不清除（用户仍能知道那天有过一封信）；payload 可在明确删除
 * 来源时整体 scrub。
 */
export const emotionDailyLetterVersions = mysqlTable(
  "emotion_daily_letter_versions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    letterDate: varchar("letterDate", { length: 10 }).notNull(),
    versionNumber: int("versionNumber").notNull(),
    /** 版本号、生成时间、触发方式与 selector／prompt／model 版本。 */
    envelope: json("envelope").notNull(),
    /** 可清除的隐私 payload；被 scrub 后为 NULL。 */
    payload: json("payload"),
    privacyEpoch: int("privacyEpoch").notNull(),
    /** 产生这一版的稳定动作 ID；重复提交同一次重读返回同一版本。 */
    actionId: varchar("actionId", { length: 191 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    versionUnique: uniqueIndex(
      "emotion_daily_letter_versions_version_unique"
    ).on(table.userId, table.letterDate, table.versionNumber),
    actionUnique: uniqueIndex("emotion_daily_letter_versions_action_unique").on(
      table.userId,
      table.letterDate,
      table.actionId
    ),
    idUserUnique: uniqueIndex(
      "emotion_daily_letter_versions_id_user_unique"
    ).on(table.id, table.userId),
  })
);

export type EmotionDailyLetterVersion =
  typeof emotionDailyLetterVersions.$inferSelect;
export type InsertEmotionDailyLetterVersion =
  typeof emotionDailyLetterVersions.$inferInsert;

/**
 * EmotionDailyLetterAttempts — 来信生成 attempt。
 *
 * 开始生成的短事务里创建，固定输入截点与当时的 privacy epoch；
 * 外部生成结束后用同一 attempt 做条件提交。重复提交同一 action ID
 * 返回同一 attempt，不排第二次生成。
 */
export const emotionDailyLetterAttempts = mysqlTable(
  "emotion_daily_letter_attempts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    letterDate: varchar("letterDate", { length: 10 }).notNull(),
    actionId: varchar("actionId", { length: 191 }).notNull(),
    state: mysqlEnum("state", [
      "in_flight",
      "committed",
      "failed",
      "rejected_stale",
    ])
      .default("in_flight")
      .notNull(),
    inputCutoffAt: timestamp("inputCutoffAt").notNull(),
    privacyEpoch: int("privacyEpoch").notNull(),
    committedVersionId: int("committedVersionId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    actionUnique: uniqueIndex("emotion_daily_letter_attempts_action_unique").on(
      table.userId,
      table.letterDate,
      table.actionId
    ),
    versionFk: foreignKey({
      columns: [table.committedVersionId, table.userId],
      foreignColumns: [
        emotionDailyLetterVersions.id,
        emotionDailyLetterVersions.userId,
      ],
      name: "emotion_daily_letter_attempts_version_fk",
    }),
  })
);

export type EmotionDailyLetterAttempt =
  typeof emotionDailyLetterAttempts.$inferSelect;
export type InsertEmotionDailyLetterAttempt =
  typeof emotionDailyLetterAttempts.$inferInsert;
