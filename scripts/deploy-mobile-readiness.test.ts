import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const initialScript = path.join(repoRoot, "scripts/deploy-initial-aliyun.sh");
const switchScript = path.join(
  repoRoot,
  "scripts/switch-www-drinkingtime-after-icp.sh"
);

describe("mobile production deployment gate", () => {
  it("does not ship an auth-disabled HTTP production template", () => {
    const source = readFileSync(initialScript, "utf8");
    expect(source).toContain("DISABLE_AUTH=false");
    expect(source).not.toContain("DISABLE_AUTH=true");
    expect(source).toContain("APP_ORIGIN=https://");
    expect(source).toContain("CSP_MEDIA_ORIGINS=");
    expect(source).toContain("/readyz");
  });

  it("prints an auditable HTTPS switch dry-run without mutating", () => {
    const output = execFileSync("bash", [switchScript], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DRY_RUN: "1",
        APP_DIR: "/opt/Drinking-Time",
        DOMAIN: "www.drinkingtime.top",
      },
    });

    expect(output).toContain("[DRY_RUN]");
    expect(output).toContain("HTTP → HTTPS");
    expect(output).toContain("X-Forwarded-Proto");
    expect(output).toContain("nginx -t");
    expect(output).toContain("不会修改");
  });
});
