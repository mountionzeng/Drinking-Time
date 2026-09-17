/** Persistence operations for analysis. Local and MySQL behavior share this boundary. */
import { eq, desc } from "drizzle-orm";
import {
  InsertAnalysisResult,
  analysisResults,
  AnalysisResult,
} from "../../drizzle/schema";
import {
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

// ─── Analysis Result ─────────────────────────────────────────────────────

export async function createAnalysisResult(data: InsertAnalysisResult) {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: AnalysisResult = {
      id: nextMemoryId("analysisResult"),
      projectId: data.projectId,
      userId: data.userId,
      mood: data.mood ?? null,
      lighting: data.lighting ?? null,
      spatialStructure: data.spatialStructure ?? null,
      cameraLanguage: data.cameraLanguage ?? null,
      colorPalette: data.colorPalette ?? null,
      atmosphereKeywords: data.atmosphereKeywords ?? null,
      promptDraft: data.promptDraft ?? null,
      negativePrompt: data.negativePrompt ?? null,
      parameterSuggestions: data.parameterSuggestions ?? null,
      summary: data.summary ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.analysisResults.push(row);
    await persistMemoryState();
    return { id: row.id };
  }
  const result = await db.insert(analysisResults).values(data);
  return { id: result[0].insertId };
}

export async function getProjectAnalysis(projectId: number) {
  const db = await getDb();
  if (!db) {
    const rows = memoryState.analysisResults
      .filter(item => item.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ?? null;
  }
  const result = await db
    .select()
    .from(analysisResults)
    .where(eq(analysisResults.projectId, projectId))
    .orderBy(desc(analysisResults.createdAt))
    .limit(1);
  return result[0] ?? null;
}
