import path from "node:path";
import { expect, it } from "vitest";
import { frameRegionRuntime } from "./localFrameRegions";
it("uses deployed Python and models in production, independently of development defaults", () => {
  expect(frameRegionRuntime({ NODE_ENV: "production" })).toEqual({
    python: path.resolve(".runtime/frame-regions/bin/python"),
    modelPath: path.resolve(".runtime/frame-regions/models/clipseg"),
    cloudModelPath: path.resolve(".runtime/frame-regions/models/sam2"),
  });
  expect(frameRegionRuntime({ NODE_ENV: "development" }).python).toBe("python3");
  expect(frameRegionRuntime({ NODE_ENV: "production", FRAME_REGION_PYTHON: "/custom/python", FRAME_REGION_MODEL_DIR: "/custom/trees", FRAME_REGION_CLOUD_MODEL_DIR: "/custom/clouds" })).toEqual({ python: "/custom/python", modelPath: "/custom/trees", cloudModelPath: "/custom/clouds" });
});
