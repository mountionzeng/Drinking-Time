import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  REAL_APPID_PATTERN,
  scanForRealAppId,
  scanForSecrets,
} from "./support/secretScan";

const MINIPROGRAM_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(MINIPROGRAM_ROOT, "..");

/** 公开占位 AppID：微信开发者工具的「游客/无 AppID」模式。 */
const PLACEHOLDER_APPID = "touristappid";

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * 提交候选集合 = 已跟踪 + 未跟踪但未被 ignore 的文件。
 * 这正是「下一次 git add 可能带进去」的那批文件。
 */
function commitCandidates(): string[] {
  return git([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "miniprogram",
  ])
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

function isIgnored(relativePath: string): boolean {
  try {
    git(["check-ignore", "-q", "--no-index", relativePath]);
    return true;
  } catch {
    return false;
  }
}

function readCandidate(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".mp3",
  ".mp4",
  ".ttf",
  ".woff",
  ".woff2",
]);

function textCandidates(): string[] {
  return commitCandidates().filter(
    file => !BINARY_EXTENSIONS.has(path.extname(file).toLowerCase()),
  );
}

describe("小程序提交候选的 Secret 边界", () => {
  it("候选集合非空，否则扫描是假通过", () => {
    expect(textCandidates().length).toBeGreaterThan(0);
  });

  it("没有任何候选文件包含 Secret 赋值、私钥、高熵凭据或微信服务端接口", () => {
    const findings = textCandidates().flatMap(file =>
      scanForSecrets(file, readCandidate(file)),
    );
    expect(findings).toEqual([]);
  });

  it("真实 AppID 只允许出现在公开的 project.config.json 里", () => {
    const findings = textCandidates()
      .filter(file => path.basename(file) !== "project.config.json")
      .flatMap(file => scanForRealAppId(file, readCandidate(file)));
    expect(findings).toEqual([]);
  });

  it("开发者工具生成的私有配置与构建产物确实被 ignore", () => {
    const mustBeIgnored = [
      "miniprogram/project.private.config.json",
      "miniprogram/node_modules/anything.js",
      "miniprogram/src/miniprogram_npm/pkg/index.js",
      "miniprogram/dist/app.js",
      "miniprogram/.env",
      "miniprogram/wechat-devtools.log",
    ];
    for (const candidate of mustBeIgnored) {
      expect(isIgnored(candidate), `${candidate} 必须被 ignore`).toBe(true);
    }
  });

  it("私有配置即使存在也不会进入提交候选集合", () => {
    const candidates = commitCandidates();
    expect(
      candidates.filter(file => file.includes("project.private.config.json")),
    ).toEqual([]);
    expect(candidates.filter(file => file.includes("node_modules"))).toEqual([]);
  });
});

describe("Secret 扫描器本身", () => {
  it("命中真实赋值、私钥头、微信服务端接口和高熵凭据", () => {
    const leaked = [
      'const appSecret = "8f3b2c1d9e0a7b6c5d4e3f2a1b0c9d8e";', // fixture：扫描器负例输入，均为构造的假值
      "-----BEGIN RSA PRIVATE KEY-----", // fixture：扫描器负例输入，均为构造的假值
      "https://api.weixin.qq.com/sns/jscode2session?appid=1", // fixture：扫描器负例输入，均为构造的假值
      'const token = "Ab3Kd9Xz7Qw2Er5Ty8Ui1Op4As6Df0Gh3Jk5Lz9Mn2Bv";', // fixture：扫描器负例输入，均为构造的假值
    ].join("\n");
    const findings = scanForSecrets("fixture.ts", leaked);
    expect(findings.map(finding => finding.rule).sort()).toEqual([
      "high-entropy-credential",
      "private-key-header",
      "secret-assignment",
      "wechat-server-api",
    ]);
  });

  it("不因安全术语本身或明确标注的假值误报", () => {
    const safe = [
      "README 里提一句 api.weixin.qq.com 只是文档引用，不是客户端直连。",
      "// AppSecret 与 session_key 只写在服务端秘密配置，永不进入本目录。",
      "对应的环境变量名是 WECHAT_MINIPROGRAM_APP_SECRET，值由用户本人配置。",
      'const appSecret = "PLACEHOLDER_NEVER_A_REAL_VALUE";',
      'const sessionKey = "<your-server-side-only-value>";',
    ].join("\n");
    expect(scanForSecrets("fixture.md", safe)).toEqual([]);
  });

  it("未标注的真实形态 AppID 会被拦下，标注为 fixture 的假值放行", () => {
    // 下一行本身带 fixture 标注，所以自扫描放行；传给扫描器的字符串内容不带标注。
    const unmarked = 'const appid = "wx0f1e2d3c4b5a6978";'; // fixture
    expect(scanForRealAppId("fixture.ts", unmarked)).toHaveLength(1);
    const marked = unmarked + " // fixture：构造的假值";
    expect(scanForRealAppId("fixture.ts", marked)).toEqual([]);
  });

  it("小写 hash 指纹不会被当成高熵凭据", () => {
    const fingerprint = 'const requestHash = "sct1-1a2b3c4d5e6f708192a3b4c5d6e7f809";';
    expect(scanForSecrets("fixture.ts", fingerprint)).toEqual([]);
  });
});

describe("原生工程配置", () => {
  const projectConfigPath = path.join(MINIPROGRAM_ROOT, "project.config.json");
  const appJsonPath = path.join(MINIPROGRAM_ROOT, "src", "app.json");

  it("project.config.json 声明原生源码根、TypeScript 编译，且不关闭合法域名校验", () => {
    const config = JSON.parse(readFileSync(projectConfigPath, "utf8"));
    expect(config.miniprogramRoot).toBe("src/");
    expect(config.compileType).toBe("miniprogram");
    expect(config.setting.useCompilerPlugins).toContain("typescript");
    // urlCheck 关掉只会让开发者工具「看起来能联网」，那是 U7 真机验收的伪证据。
    expect(config.setting.urlCheck).toBe(true);
  });

  it("tracked AppID 是公开占位值或经确认的测试 AppID", () => {
    const config = JSON.parse(readFileSync(projectConfigPath, "utf8"));
    const appid: string = config.appid;
    const isPlaceholder = appid === PLACEHOLDER_APPID;
    const isWechatAppId = REAL_APPID_PATTERN.test(appid);
    expect(
      isPlaceholder || isWechatAppId,
      `appid 必须是 ${PLACEHOLDER_APPID} 或 wx 开头的 18 位 AppID，当前是 ${appid}`,
    ).toBe(true);
  });

  it("app.json 的页面全部真实存在，且不含 web-view 页面", () => {
    const appJson = JSON.parse(readFileSync(appJsonPath, "utf8"));
    expect(appJson.pages).toEqual([
      "pages/start/index",
      "pages/privacy/index",
      "pages/workspace/index",
    ]);
    for (const page of appJson.pages as string[]) {
      for (const extension of [".ts", ".json", ".wxml", ".wxss"]) {
        const file = path.join(MINIPROGRAM_ROOT, "src", `${page}${extension}`);
        expect(existsSync(file), `${page}${extension} 必须存在`).toBe(true);
      }
    }
  });

  it("整个 src/ 不使用 web-view、Taro 或 uni-app", () => {
    const sources = textCandidates().filter(file =>
      file.startsWith("miniprogram/src/"),
    );
    const forbidden = sources.flatMap(file => {
      const content = readCandidate(file);
      return /<web-view|from "@tarojs|from "@dcloudio|uni-app/.test(content)
        ? [file]
        : [];
    });
    expect(forbidden).toEqual([]);
  });

  it("sitemap 禁止被索引：测试壳层不进入微信搜索", () => {
    const sitemap = JSON.parse(
      readFileSync(path.join(MINIPROGRAM_ROOT, "src", "sitemap.json"), "utf8"),
    );
    expect(sitemap.rules).toEqual([{ action: "disallow", page: "*" }]);
  });
});
