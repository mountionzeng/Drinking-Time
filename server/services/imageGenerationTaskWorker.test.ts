import { describe, expect, it } from "vitest";
import { imageTaskWorkerEnabled, startImageTaskWorker } from "./imageGenerationTaskWorker";

describe("image task worker switch", () => {
  it("is off unless IMAGE_TASK_WORKER_ENABLED=1", () => {
    expect(imageTaskWorkerEnabled({})).toBe(false);
    expect(imageTaskWorkerEnabled({ IMAGE_TASK_WORKER_ENABLED: "true" })).toBe(false);
    expect(imageTaskWorkerEnabled({ IMAGE_TASK_WORKER_ENABLED: "1" })).toBe(true);
  });
  it("start is a no-op by default", () => {
    const prev = process.env.IMAGE_TASK_WORKER_ENABLED;
    delete process.env.IMAGE_TASK_WORKER_ENABLED;
    const stop = startImageTaskWorker(10);
    expect(typeof stop).toBe("function");
    stop();
    if (prev !== undefined) process.env.IMAGE_TASK_WORKER_ENABLED = prev;
  });
});
