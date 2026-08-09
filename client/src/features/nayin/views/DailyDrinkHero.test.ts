import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("DailyDrinkHero 登录品牌标识", () => {
  it("将放大后的中英文字标缩小四分之一，并在手机端校正视觉中心", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "client/src/features/nayin/views/DailyDrinkHero.tsx"
      ),
      "utf8"
    );

    expect(source).toContain('fontSize="69"');
    expect(source).toContain('fontSize="24"');
    expect(source).toContain('startOffset="25%"');
    expect(source).toContain('startOffset="78%"');
    expect(source).toContain(
      '"h-[19rem] w-[19rem] -mb-12 translate-y-6 sm:h-96 sm:w-96 sm:-mb-14 sm:translate-y-0"'
    );
    expect(source).toContain('translate-x-2 sm:translate-x-0');
    expect(source).toContain('translate-x-1 sm:translate-x-0');
  });
});
