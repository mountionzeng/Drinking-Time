export const TIMELINE_MEDIA_OPERATION_LEDGER_KEY =
  "_timelineMediaOperationLedger";

export type TimelineMediaOperationLedgerEntry = {
  editorSessionEpoch: string;
  operationId: string;
  commandDigest: string;
};

function entries(value: unknown): TimelineMediaOperationLedgerEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return typeof record.editorSessionEpoch === "string" &&
      typeof record.operationId === "string" &&
      typeof record.commandDigest === "string"
      ? [
          {
            editorSessionEpoch: record.editorSessionEpoch,
            operationId: record.operationId,
            commandDigest: record.commandDigest,
          },
        ]
      : [];
  });
}

export function findDurableTimelineMediaOperation(
  extensions: Record<string, unknown>,
  operation: { editorSessionEpoch: string; operationId: string }
): TimelineMediaOperationLedgerEntry | null {
  return (
    entries(extensions[TIMELINE_MEDIA_OPERATION_LEDGER_KEY]).find(
      entry =>
        entry.editorSessionEpoch === operation.editorSessionEpoch &&
        entry.operationId === operation.operationId
    ) ?? null
  );
}

export function appendDurableTimelineMediaOperation(
  extensions: Record<string, unknown>,
  entry: TimelineMediaOperationLedgerEntry
): Record<string, unknown> {
  const prior = entries(extensions[TIMELINE_MEDIA_OPERATION_LEDGER_KEY]).filter(
    candidate =>
      candidate.editorSessionEpoch !== entry.editorSessionEpoch ||
      candidate.operationId !== entry.operationId
  );
  return {
    ...extensions,
    // Never silently forget an accepted operation. Relative commands can be
    // retried after a response is lost, and replaying one after an arbitrary
    // count-based eviction would apply the edit twice. The ledger is compact
    // (three bounded strings per changed command) and duplicate identities are
    // replaced above, so correctness takes precedence over a lossy window.
    [TIMELINE_MEDIA_OPERATION_LEDGER_KEY]: [...prior, entry],
  };
}
