import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, float, boolean as mysqlBoolean, json } from "drizzle-orm/mysql-core";

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

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
  sourceType: mysqlEnum("sourceType", ["image", "video", "script", "storyboard", "brief", "note", "pdf"]).notNull(),
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
  userId: int("userId").notNull(),
  sceneNo: varchar("sceneNo", { length: 32 }).notNull(),
  shotNo: varchar("shotNo", { length: 32 }).notNull(),
  sourceSummary: text("sourceSummary"),
  intentType: mysqlEnum("intentType", ["idea", "client_requirement", "director_note"]).default("idea").notNull(),
  status: mysqlEnum("status", [
    "idea_pool",
    "requirement_pool",
    "structured",
    "production_ready",
    "queued",
    "rendered",
    "blocked",
  ]).default("idea_pool").notNull(),
  readinessScore: float("readinessScore").default(0).notNull(),
  deadline: varchar("deadline", { length: 32 }),
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"]).default("medium").notNull(),
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
    shotNo: number;
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
    emotionCharge?: string;
    emotionDelta?: string;
    visualAnchorText?: string;
    promptDraft?: string;
    negativePrompt?: string;
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
  // 未来扩展点：连接镜的 connectorPolicy、风格全局参数等都可以塞进来
  [key: string]: unknown;
};

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
  imageKey: varchar("imageKey", { length: 512 }),  // 桌面端存储 key
  imageUrl: text("imageUrl").notNull(),
  prompt: text("prompt"),
  generationType: mysqlEnum("generationType", ["generate", "initial", "inpaint"]).default("generate").notNull(),
  parentImageId: int("parentImageId"),
  isCurrent: mysqlBoolean("isCurrent").default(true).notNull(),
  maskKey: varchar("maskKey", { length: 512 }),  // 桌面端 inpaint 蒙版
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GeneratedImage = typeof generatedImages.$inferSelect;
export type InsertGeneratedImage = typeof generatedImages.$inferInsert;

/**
 * ImageSignals — 用户对图片的交互信号（左划/右划/编辑等），时序事件流。
 */
export const imageSignals = mysqlTable("image_signals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  storyId: int("storyId").notNull(),
  imageId: int("imageId"),
  action: mysqlEnum("action", ["swipe_left", "swipe_right", "edit_start", "edit_complete"]).notNull(),
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
  status: mysqlEnum("status", ["pending", "active", "archived"]).default("active").notNull(),
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
