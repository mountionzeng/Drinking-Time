/**
 * 提交候选文件的 Secret 扫描器。
 *
 * 设计要点（见 002 计划 U1 与交接文档第六节）：
 * - 只对「key/value 赋值、私钥头、高熵凭据、真实微信服务端接口」报警；
 * - 安全术语本身（README 里写 `AppSecret` 只留在服务端）不算命中，
 *   否则文档和测试会把扫描器变成噪音；
 * - 明确标注为假值的 fixture 允许通过，标注词见 PLACEHOLDER_HINT。
 */

export type SecretFinding = {
  file: string;
  line: number;
  rule: string;
  excerpt: string;
};

/** 明确的占位/假值标记：命中这些词的那一行不算泄漏。 */
const PLACEHOLDER_HINT =
  /(placeholder|example|sample|fixture|示例|占位|your[-_ ]?|xxxx|fake|mock|dummy|demo|redacted|test-only|仅测试|<[^>]+>|\$\{)/i;

/** 形如 `appSecret: "..."` 的真实赋值。 */
const SECRET_ASSIGNMENT =
  /\b(app_?secret|session_?key|secret_?key|client_?secret|private_?key|access_?token|refresh_?token|api_?key|bearer|authorization)\b\s*[:=]\s*(["'`])([^"'`\n]{8,})\2/i;

/** PEM 私钥头。 */
const PRIVATE_KEY_HEADER = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/**
 * 微信服务端接口：客户端永远不该直接拼它（code2Session 只能在自家后端调）。
 * 只拦真实 URL 用法，不拦文档里对这个域名的引用 —— 否则 README 提一句就变成假告警。
 */
const WECHAT_SERVER_API = /https?:\/\/[^\s"'`]*api\.weixin\.qq\.com/i;

/** 高熵凭据：同时含大小写与数字、长度 >= 40 的连续串。纯小写 hash（如 turn fingerprint）不命中。 */
const HIGH_ENTROPY =
  /(?=[A-Za-z0-9+/_=-]*[A-Z])(?=[A-Za-z0-9+/_=-]*[a-z])(?=[A-Za-z0-9+/_=-]*[0-9])[A-Za-z0-9+/_=-]{40,}/;

/** 真实小程序 AppID 形态。只允许出现在公开的 project.config.json 里。 */
export const REAL_APPID_PATTERN = /\bwx[0-9a-f]{16}\b/;

const RULES: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  { rule: "secret-assignment", pattern: SECRET_ASSIGNMENT },
  { rule: "private-key-header", pattern: PRIVATE_KEY_HEADER },
  { rule: "wechat-server-api", pattern: WECHAT_SERVER_API },
  { rule: "high-entropy-credential", pattern: HIGH_ENTROPY },
];

function excerpt(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

export function scanForSecrets(file: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    if (PLACEHOLDER_HINT.test(line)) return;
    for (const { rule, pattern } of RULES) {
      if (pattern.test(line)) {
        findings.push({
          file,
          line: index + 1,
          rule,
          excerpt: excerpt(line),
        });
      }
    }
  });
  return findings;
}

export function scanForRealAppId(
  file: string,
  content: string,
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    // 测试 fixture 里明确标注的假 AppID 允许存在。
    if (PLACEHOLDER_HINT.test(line)) return;
    if (REAL_APPID_PATTERN.test(line)) {
      findings.push({
        file,
        line: index + 1,
        rule: "real-appid-outside-project-config",
        excerpt: excerpt(line),
      });
    }
  });
  return findings;
}
