import { describe, expect, it } from "vitest";
import {
  TIMELINE_MEDIA_OPERATION_LEDGER_KEY,
  appendDurableTimelineMediaOperation,
  findDurableTimelineMediaOperation,
} from "./timelineMediaOperationLedger";

describe("timelineMediaOperationLedger", () => {
  it("round-trips a scoped operation without changing unrelated slices", () => {
    const extensions = appendDurableTimelineMediaOperation(
      { sentinel: { keep: true } },
      {
        editorSessionEpoch: "epoch-a",
        operationId: "move-a",
        commandDigest: "digest-a",
      }
    );
    expect(extensions.sentinel).toEqual({ keep: true });
    expect(
      findDurableTimelineMediaOperation(extensions, {
        editorSessionEpoch: "epoch-a",
        operationId: "move-a",
      })
    ).toMatchObject({ commandDigest: "digest-a" });
    expect(
      findDurableTimelineMediaOperation(extensions, {
        editorSessionEpoch: "epoch-b",
        operationId: "move-a",
      })
    ).toBeNull();
  });

  it("does not forget old operations after a long editing session", () => {
    let extensions: Record<string, unknown> = {};
    for (let index = 0; index < 205; index += 1) {
      extensions = appendDurableTimelineMediaOperation(extensions, {
        editorSessionEpoch: "epoch",
        operationId: `op-${index}`,
        commandDigest: `digest-${index}`,
      });
    }
    expect(
      (extensions[TIMELINE_MEDIA_OPERATION_LEDGER_KEY] as unknown[]).length
    ).toBe(205);
    expect(
      findDurableTimelineMediaOperation(extensions, {
        editorSessionEpoch: "epoch",
        operationId: "op-0",
      })
    ).toMatchObject({ commandDigest: "digest-0" });
    expect(
      findDurableTimelineMediaOperation(extensions, {
        editorSessionEpoch: "epoch",
        operationId: "op-204",
      })
    ).not.toBeNull();
  });
});
