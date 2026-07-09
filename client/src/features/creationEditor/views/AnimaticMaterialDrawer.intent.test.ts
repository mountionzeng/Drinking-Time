import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("AnimaticMaterialDrawer intent", () => {
  it("does not load every video preview when the material drawer opens", () => {
    const source = readFileSync(
      resolve(
        root,
        "client/src/features/creationEditor/views/AnimaticMaterialDrawer.tsx"
      ),
      "utf8"
    );

    expect(source).toContain("loadedVideoTakeIds");
    expect(source).toContain("载入预览");
    expect(source).toContain('preload="none"');
    expect(source).not.toContain('preload="metadata"');
  });

  it("offers reusable takes from other shots without moving the source take", () => {
    const source = readFileSync(
      resolve(
        root,
        "client/src/features/creationEditor/views/AnimaticMaterialDrawer.tsx"
      ),
      "utf8"
    );

    expect(source).toContain("onReuseVideo");
    expect(source).toContain("selectedStableShotId !== shot.stableShotId");
    expect(source).toContain("复用到当前镜头");
  });
});
