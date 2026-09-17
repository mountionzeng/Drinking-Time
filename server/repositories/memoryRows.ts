/** Persistence operations for memoryRows. Local and MySQL behavior share this boundary. */
import { type PersonalMemoryInsightRecord } from "../../shared/personalMemory";

export function rowToPersonalMemoryInsight(row: {
  id: number;
  userId: number;
  lineageKey: string;
  revision: number;
  state: string;
  origin: string;
  category: string;
  text: string | null;
  scope: unknown;
  confidence: number;
  allowProactiveMention: boolean;
  supersededByInsightId: number | null;
  createdAt: Date;
  updatedAt: Date;
}): PersonalMemoryInsightRecord {
  return {
    id: row.id,
    userId: row.userId,
    lineageKey: row.lineageKey,
    revision: row.revision,
    state: row.state as PersonalMemoryInsightRecord["state"],
    origin: row.origin as PersonalMemoryInsightRecord["origin"],
    category: row.category as PersonalMemoryInsightRecord["category"],
    text: row.text,
    scope: (row.scope as Record<string, unknown> | null) ?? null,
    confidence: row.confidence,
    allowProactiveMention: row.allowProactiveMention,
    supersededByInsightId: row.supersededByInsightId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
