import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
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
    expect(source).toContain(
      "curl -fsS --connect-timeout 5 --max-time 15"
    );
    expect(source).toContain(
      "curl -fsSL --connect-timeout 10 --max-time 120 https://deb.nodesource.com/setup_22.x | bash -"
    );
    expect(source).toContain(
      "curl -fsSL --connect-timeout 10 --max-time 120 https://rpm.nodesource.com/setup_22.x | bash -"
    );
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

    const source = readFileSync(switchScript, "utf8");
    expect(source.match(/--connect-timeout 5 --max-time 15/g)).toHaveLength(4);
  });

  it("restores and revalidates the prior nginx config when reload fails", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "drinking-time-nginx-"));
    try {
      const fakeBin = path.join(root, "bin");
      const appDir = path.join(root, "app");
      const certDir = path.join(root, "cert");
      const nginxConf = path.join(root, "nginx", "drinking-time.conf");
      const nginxLog = path.join(root, "nginx.log");
      const systemctlLog = path.join(root, "systemctl.log");
      const systemctlCount = path.join(root, "systemctl.count");
      mkdirSync(fakeBin, { recursive: true });
      mkdirSync(appDir, { recursive: true });
      mkdirSync(certDir, { recursive: true });
      mkdirSync(path.dirname(nginxConf), { recursive: true });
      writeFileSync(path.join(appDir, ".env"), "test-only\n");
      writeFileSync(path.join(certDir, "fullchain.pem"), "test-only\n");
      writeFileSync(path.join(certDir, "privkey.pem"), "test-only\n");
      const previousConfig = "# known-good previous config\n";
      writeFileSync(nginxConf, previousConfig);

      const fakeCommands: Record<string, string> = {
        id: '#!/usr/bin/env bash\necho 0\n',
        node: '#!/usr/bin/env bash\nexit 0\n',
        curl: '#!/usr/bin/env bash\nexit 0\n',
        nginx:
          '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$FAKE_NGINX_LOG"\nexit 0\n',
        systemctl:
          '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$FAKE_SYSTEMCTL_LOG"\nif [ ! -f "$FAKE_SYSTEMCTL_COUNT" ]; then touch "$FAKE_SYSTEMCTL_COUNT"; exit 1; fi\nexit 0\n',
      };
      for (const [name, source] of Object.entries(fakeCommands)) {
        const target = path.join(fakeBin, name);
        writeFileSync(target, source);
        chmodSync(target, 0o755);
      }

      const result = spawnSync("bash", [switchScript], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          APP_DIR: appDir,
          CERT_DIR: certDir,
          NGINX_CONF: nginxConf,
          DOMAIN: "www.drinkingtime.top",
          DRY_RUN: "0",
          FAKE_NGINX_LOG: nginxLog,
          FAKE_SYSTEMCTL_LOG: systemctlLog,
          FAKE_SYSTEMCTL_COUNT: systemctlCount,
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "已恢复、验证并重新加载发布前配置，HTTPS 切换已中止"
      );
      expect(readFileSync(nginxConf, "utf8")).toBe(previousConfig);
      expect(readFileSync(nginxLog, "utf8").trim().split("\n")).toEqual([
        "-t",
        "-t",
      ]);
      expect(readFileSync(systemctlLog, "utf8").trim().split("\n")).toEqual([
        "reload nginx",
        "reload nginx",
      ]);

      const source = readFileSync(switchScript, "utf8");
      expect(source).toContain('rm -f "$NGINX_CONF"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
