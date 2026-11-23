import { describe, expect, it } from "vitest";
import { decideStaleRelease } from "./computeStaleRelease";

describe("Shiguang stale holds", () => {
  for (const status of ["reserved", "submitted", "submission_unknown"]) {
    it(`preserves a ${status} hold without trusted provider evidence`, () => {
      const item = {
        status, operationType: "shiguang.organizeMemory",
        createdAt: new Date(0), now: new Date(31 * 60_000), holdActive: true,
        evidence: { storedOutput: false, outputUnstored: false, taskInFlight: false },
      };
      expect(decideStaleRelease(item).action).toBe("manual");
      expect(decideStaleRelease({ ...item, operationType: "text.generate" }).action).toBe("release");
    });
  }
});
