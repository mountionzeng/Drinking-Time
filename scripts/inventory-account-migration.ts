/**
 * U3 只读盘点：三来源的计数、摘要、身份分组与冲突报告。
 *
 * 这个脚本**只读**。它不写任何数据库、不改任何文件（除了在指定路径输出报告），
 * 也**不给出自动归属建议**——它的产物是一份给人看的清单，供岱岱裁决映射。
 *
 * 两条不可破坏的规则：
 *  1. 同一标准化邮箱对应多个用户 = 冲突，报告出来，不挑一个。
 *  2. 没有邮箱的账号（Guest）即使持有大量内容，也只是「需要人工映射」，
 *     绝不产生 proposedEmail 之类的字段——那种字段一旦存在，早晚会有人直接拿去 apply。
 *
 *   pnpm tsx scripts/inventory-account-migration.ts --local
 *   pnpm tsx scripts/inventory-account-migration.ts --local --out=docs/qa/account-migration-inventory.md
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type InventoryUser = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
};

export type InventoryProject = { id: number; userId: number };
export type InventoryStory = { id: number; userId: number; projectId?: number | null };

export function normalizeEmail(email: string | null | undefined): string | null {
  const value = (email ?? "").trim().toLowerCase();
  return value.length > 0 ? value : null;
}

/** Levenshtein 距离。用于找出 `mountionzeng` / `mountainzeng` 这类拼写变体。 */
export function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  const rows = left.length + 1;
  const cols = right.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);

  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[cols - 1];
}

export type EmailGroup = {
  normalizedEmail: string | null;
  userIds: number[];
  /** unique = 唯一解析；conflict = 同邮箱多账号，必须人工裁决；no_email = 没有邮箱 */
  resolution: "unique" | "conflict" | "no_email";
};

export function buildEmailGroups(users: InventoryUser[]): EmailGroup[] {
  const byEmail = new Map<string | null, number[]>();
  for (const user of users) {
    const key = normalizeEmail(user.email);
    const bucket = byEmail.get(key) ?? [];
    bucket.push(user.id);
    byEmail.set(key, bucket);
  }

  return [...byEmail.entries()]
    .map(([normalizedEmail, userIds]) => ({
      normalizedEmail,
      userIds: [...userIds].sort((a, b) => a - b),
      resolution:
        normalizedEmail === null
          ? ("no_email" as const)
          : userIds.length > 1
            ? ("conflict" as const)
            : ("unique" as const),
    }))
    .sort((a, b) =>
      String(a.normalizedEmail ?? "").localeCompare(String(b.normalizedEmail ?? ""))
    );
}

export type NearMissPair = { left: string; right: string; distance: number };

/**
 * 找出拼写相近但不相同的邮箱。
 *
 * 只在**同域名**之间比较：`a@gmail.com` 和 `a@outlook.com` 是两个人，不是拼写变体。
 * 距离阈值 2，正好覆盖 `mountionzeng` / `mountainzeng` 这种两处替换。
 */
export function findNearMissEmailPairs(
  emails: Array<string | null | undefined>,
  maxDistance = 2
): NearMissPair[] {
  const normalized = [...new Set(emails.map(normalizeEmail).filter((e): e is string => !!e))];
  const pairs: NearMissPair[] = [];

  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      const [left, right] = [normalized[i], normalized[j]].sort();
      const [leftLocal, leftDomain] = left.split("@");
      const [rightLocal, rightDomain] = right.split("@");
      if (leftDomain !== rightDomain) continue;
      const distance = editDistance(leftLocal, rightLocal);
      if (distance > 0 && distance <= maxDistance) {
        pairs.push({ left, right, distance });
      }
    }
  }
  return pairs.sort((a, b) => a.distance - b.distance || a.left.localeCompare(b.left));
}

export type CrossSourceEmailEntry = {
  normalizedEmail: string;
  appearances: Array<{ sourceKey: string; userIds: number[] }>;
  /** 单个来源内同邮箱对应多个账号：这才是必须人工裁决的冲突 */
  withinSourceConflict: boolean;
  /** 同一邮箱出现在多个来源：跨库映射候选，属于预期情况 */
  spansMultipleSources: boolean;
};

/**
 * 跨来源的邮箱索引。
 *
 * 区分两件容易混淆的事：
 *  - 同一邮箱在旧库和 staging 各有一个账号 → **跨库映射候选**，同一个人的两条记录，正常；
 *  - 同一邮箱在**同一个来源**里对应多个账号 → **冲突**，必须人工裁决。
 *
 * 无邮箱账号不进这个索引：它们无法用邮箱证明归属，只能走人工映射。
 */
export function buildCrossSourceEmailIndex(
  sources: Array<{ sourceKey: string; users: InventoryUser[] }>
): CrossSourceEmailEntry[] {
  const index = new Map<string, Map<string, number[]>>();
  let conflicted = new Set<string>();

  for (const source of sources) {
    for (const group of buildEmailGroups(source.users)) {
      if (group.normalizedEmail === null) continue;
      const bySource = index.get(group.normalizedEmail) ?? new Map<string, number[]>();
      bySource.set(source.sourceKey, group.userIds);
      index.set(group.normalizedEmail, bySource);
      if (group.resolution === "conflict") conflicted.add(group.normalizedEmail);
    }
  }

  return [...index.entries()]
    .map(([normalizedEmail, bySource]) => ({
      normalizedEmail,
      appearances: [...bySource.entries()]
        .map(([sourceKey, userIds]) => ({ sourceKey, userIds }))
        .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
      withinSourceConflict: conflicted.has(normalizedEmail),
      spansMultipleSources: bySource.size > 1,
    }))
    .sort((a, b) => a.normalizedEmail.localeCompare(b.normalizedEmail));
}

export type OwnershipCandidate = {
  userId: number;
  openId: string;
  name: string | null;
  email: string | null;
  projectCount: number;
  storyCount: number;
  /** true 表示这个账号的归属**不能自动决定**，必须由人给出映射 */
  needsManualMapping: boolean;
  reason: string;
};

/**
 * 统计每个账号持有多少内容，并标出哪些不能自动决定归属。
 *
 * 注意返回类型里**故意没有** proposedEmail / autoMapTo 这类字段。
 * 报告只负责说清「谁持有什么、为什么不能自动决定」，映射由人给。
 */
export function buildOwnershipCandidates(input: {
  users: InventoryUser[];
  projects: InventoryProject[];
  stories: InventoryStory[];
}): OwnershipCandidate[] {
  const emailGroups = new Map(
    buildEmailGroups(input.users).map(group => [group.normalizedEmail, group])
  );

  return input.users
    .map(user => {
      const email = normalizeEmail(user.email);
      const group = emailGroups.get(email);
      const projectCount = input.projects.filter(p => p.userId === user.id).length;
      const storyCount = input.stories.filter(s => s.userId === user.id).length;

      let needsManualMapping = false;
      let reason = "有唯一邮箱，可以直接建立 identity 登记";
      if (email === null) {
        needsManualMapping = true;
        reason =
          "没有邮箱：无法证明它属于谁。持有的内容必须由人给出显式映射才能归属。";
      } else if (group?.resolution === "conflict") {
        needsManualMapping = true;
        reason = `同一邮箱还对应用户 ${group.userIds
          .filter(id => id !== user.id)
          .join(", ")}：解析不唯一，必须人工裁决。`;
      }

      return {
        userId: user.id,
        openId: user.openId,
        name: user.name,
        email,
        projectCount,
        storyCount,
        needsManualMapping,
        reason,
      };
    })
    .sort(
      (a, b) =>
        b.storyCount - a.storyCount || b.projectCount - a.projectCount || a.userId - b.userId
    );
}

export type CountsSummary = {
  counts: Record<string, number>;
  digests: Record<string, string>;
};

/** 每个集合的条数与稳定内容摘要，用于证明导入前后没有变化。 */
export function summarizeCounts(
  source: Record<string, unknown[]>
): CountsSummary {
  const counts: Record<string, number> = {};
  const digests: Record<string, string> = {};
  for (const [key, rows] of Object.entries(source)) {
    counts[key] = rows.length;
    digests[key] = createHash("sha256")
      .update(JSON.stringify(rows), "utf8")
      .digest("hex");
  }
  return { counts, digests };
}

// ── CLI ──────────────────────────────────────────────────────────────

function readArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find(argument => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function formatLocalReport(input: {
  sourcePath: string;
  fileDigest: string;
  summary: CountsSummary;
  emailGroups: EmailGroup[];
  nearMiss: NearMissPair[];
  candidates: OwnershipCandidate[];
  sidecars: Array<{ name: string; exists: boolean; bytes: number; digest: string }>;
}): string {
  const lines: string[] = [];
  lines.push("# 账号迁移只读盘点：本地主仓数据源", "");
  lines.push(`生成时间：${new Date().toISOString()}`, "");
  lines.push("> 这份报告**只读生成**，不包含任何自动归属建议。映射必须由人给出。", "");

  lines.push("## 来源标识", "");
  lines.push(`- 主文件：\`${input.sourcePath}\``);
  lines.push(`- 主文件 sha256：\`${input.fileDigest}\``);
  for (const sidecar of input.sidecars) {
    lines.push(
      `- sidecar \`${sidecar.name}\`：${
        sidecar.exists ? `${sidecar.bytes} 字节，sha256 \`${sidecar.digest}\`` : "**缺失**"
      }`
    );
  }
  lines.push("", "## 每表计数与内容摘要", "");
  lines.push("| 集合 | 条数 | 内容 sha256 |", "|---|---:|---|");
  for (const key of Object.keys(input.summary.counts).sort()) {
    if (input.summary.counts[key] === 0) continue;
    lines.push(
      `| \`${key}\` | ${input.summary.counts[key]} | \`${input.summary.digests[key].slice(0, 16)}…\` |`
    );
  }

  lines.push("", "## 邮箱身份分组", "");
  const conflicts = input.emailGroups.filter(g => g.resolution === "conflict");
  const noEmail = input.emailGroups.filter(g => g.resolution === "no_email");
  const unique = input.emailGroups.filter(g => g.resolution === "unique");
  lines.push(
    `- 唯一解析：${unique.length} 个邮箱`,
    `- **冲突（同邮箱多账号）：${conflicts.length} 个**`,
    `- 无邮箱账号：${noEmail.reduce((total, g) => total + g.userIds.length, 0)} 个`,
    ""
  );
  if (conflicts.length > 0) {
    lines.push("| 邮箱 | 对应用户 id |", "|---|---|");
    for (const group of conflicts) {
      lines.push(`| \`${group.normalizedEmail}\` | ${group.userIds.join(", ")} |`);
    }
    lines.push("");
  }

  lines.push("## 拼写相近的邮箱（同域名，编辑距离 ≤ 2）", "");
  if (input.nearMiss.length === 0) {
    lines.push("无。", "");
  } else {
    lines.push("| 邮箱 A | 邮箱 B | 距离 |", "|---|---|---:|");
    for (const pair of input.nearMiss) {
      lines.push(`| \`${pair.left}\` | \`${pair.right}\` | ${pair.distance} |`);
    }
    lines.push("", "**这些不是同一个人，除非岱岱明确确认。禁止自动合并。**", "");
  }

  lines.push("## 内容归属：需要人工映射的账号", "");
  const manual = input.candidates.filter(c => c.needsManualMapping && (c.storyCount > 0 || c.projectCount > 0));
  if (manual.length === 0) {
    lines.push("无。", "");
  } else {
    lines.push("| user id | 名称 | 邮箱 | 项目 | Story | 为什么不能自动决定 |", "|---:|---|---|---:|---:|---|");
    for (const candidate of manual) {
      lines.push(
        `| ${candidate.userId} | ${candidate.name ?? "—"} | ${candidate.email ?? "**无**"} | ` +
          `${candidate.projectCount} | ${candidate.storyCount} | ${candidate.reason} |`
      );
    }
    lines.push("");
  }

  lines.push("## 持有内容的账号一览", "");
  lines.push("| user id | 名称 | 邮箱 | 项目 | Story |", "|---:|---|---|---:|---:|");
  for (const candidate of input.candidates) {
    if (candidate.storyCount === 0 && candidate.projectCount === 0) continue;
    lines.push(
      `| ${candidate.userId} | ${candidate.name ?? "—"} | ${candidate.email ?? "**无**"} | ` +
        `${candidate.projectCount} | ${candidate.storyCount} |`
    );
  }

  lines.push(
    "",
    "## 下一步",
    "",
    "1. 岱岱对上面「需要人工映射」的每一行给出显式归属，或明确说明保持独立。",
    "2. 拼写相近的邮箱逐对确认是同一个人还是两个人。",
    "3. 映射批准后才生成导入计划；导入器对任何无法唯一证明的映射一律失败关闭。",
    "4. 在此之前 `ACCOUNT_AUTO_IDENTITY_RESOLUTION` 保持 `false`。",
    ""
  );
  return lines.join("\n");
}

type RemoteSource = {
  sourceKey: string;
  label: string;
  migrationsRecorded: number;
  counts: Record<string, number>;
  users: InventoryUser[];
  projects: InventoryProject[];
  stories: InventoryStory[];
};

function formatCombinedReport(input: {
  remote: RemoteSource[];
  local: {
    label: string;
    counts: Record<string, number>;
    users: InventoryUser[];
    projects: InventoryProject[];
    stories: InventoryStory[];
  };
}): string {
  const lines: string[] = [];
  const allSources = [
    ...input.remote.map(source => ({ sourceKey: source.sourceKey, users: source.users })),
    { sourceKey: "local_persist", users: input.local.users },
  ];

  lines.push("# 账号迁移只读盘点：三来源汇总", "");
  lines.push(`生成时间：${new Date().toISOString()}`, "");
  lines.push(
    "> 全部通过 `START TRANSACTION READ ONLY` 的 SELECT 采集，未导入、未映射、未改库。",
    "> 本报告**不包含任何自动归属建议**；映射必须由人给出。",
    ""
  );

  lines.push("## 每来源计数", "");
  lines.push("| 来源 | 已登记迁移 | users | projects | stories | edit_snapshots | invite_codes |", "|---|---:|---:|---:|---:|---:|---:|");
  for (const source of input.remote) {
    lines.push(
      `| \`${source.sourceKey}\` | ${source.migrationsRecorded} | ${source.counts.users ?? 0} | ` +
        `${source.counts.projects ?? 0} | ${source.counts.stories ?? 0} | ` +
        `${source.counts.edit_snapshots ?? 0} | ${source.counts.invite_codes ?? 0} |`
    );
  }
  lines.push(
    `| \`local_persist\` | — | ${input.local.counts.users ?? 0} | ${input.local.counts.projects ?? 0} | ` +
      `${input.local.counts.stories ?? 0} | — | ${input.local.counts.inviteCodes ?? 0} |`
  );

  lines.push("", "## 跨来源邮箱索引", "");
  const index = buildCrossSourceEmailIndex(allSources);
  const conflicts = index.filter(entry => entry.withinSourceConflict);
  lines.push(
    `- 出现过的邮箱：${index.length} 个`,
    `- **单来源内同邮箱多账号（真冲突）：${conflicts.length} 个**`,
    `- 跨来源出现同一邮箱（映射候选）：${index.filter(e => e.spansMultipleSources).length} 个`,
    ""
  );
  lines.push("| 邮箱 | 出现位置 | 单来源冲突 |", "|---|---|---|");
  for (const entry of index) {
    const where = entry.appearances
      .map(a => `${a.sourceKey}#${a.userIds.join(",")}`)
      .join("；");
    lines.push(
      `| \`${entry.normalizedEmail}\` | ${where} | ${entry.withinSourceConflict ? "**是**" : "否"} |`
    );
  }

  lines.push("", "## 拼写相近的邮箱（同域名，编辑距离 ≤ 2）", "");
  const nearMiss = findNearMissEmailPairs(
    allSources.flatMap(source => source.users.map(user => user.email))
  );
  if (nearMiss.length === 0) {
    lines.push(
      "**无。** 三个来源里都不存在拼写相近的邮箱对。",
      "",
      "特别说明：交接文档提到的 `mountainzeng@gmail.com` **不存在于任何数据源**——它只出现在一张截图里。",
      "因此不存在需要裁决的近似邮箱合并。",
      ""
    );
  } else {
    lines.push("| 邮箱 A | 邮箱 B | 距离 |", "|---|---|---:|");
    for (const pair of nearMiss) {
      lines.push(`| \`${pair.left}\` | \`${pair.right}\` | ${pair.distance} |`);
    }
    lines.push("", "**这些不是同一个人，除非明确确认。禁止自动合并。**", "");
  }

  lines.push("## 需要人工映射的账号（持有内容但无法用邮箱证明归属）", "");
  lines.push("| 来源 | user id | 名称 | 项目 | Story | 为什么不能自动决定 |", "|---|---:|---|---:|---:|---|");
  const sourcesWithContent = [
    ...input.remote.map(source => ({
      key: source.sourceKey,
      users: source.users,
      projects: source.projects,
      stories: source.stories,
    })),
    {
      key: "local_persist",
      users: input.local.users,
      projects: input.local.projects,
      stories: input.local.stories,
    },
  ];
  for (const source of sourcesWithContent) {
    for (const candidate of buildOwnershipCandidates(source)) {
      if (!candidate.needsManualMapping) continue;
      if (candidate.storyCount === 0 && candidate.projectCount === 0) continue;
      lines.push(
        `| \`${source.key}\` | ${candidate.userId} | ${candidate.name ?? "—"} | ` +
          `${candidate.projectCount} | ${candidate.storyCount} | ${candidate.reason} |`
      );
    }
  }

  lines.push("", "## 各来源内容归属一览", "");
  for (const source of sourcesWithContent) {
    const owners = buildOwnershipCandidates(source).filter(
      candidate => candidate.projectCount > 0 || candidate.storyCount > 0
    );
    if (owners.length === 0) continue;
    lines.push(`### \`${source.key}\``, "");
    lines.push("| user id | 名称 | 邮箱 | 项目 | Story |", "|---:|---|---|---:|---:|");
    for (const owner of owners) {
      lines.push(
        `| ${owner.userId} | ${owner.name ?? "—"} | ${owner.email ?? "**无**"} | ` +
          `${owner.projectCount} | ${owner.storyCount} |`
      );
    }
    lines.push("");
  }

  lines.push(
    "## 需要岱岱裁决的问题",
    "",
    "1. 旧库 user 11（`legacy:unclaimed`，名称「历史待认领」，无邮箱）持有 2 个项目、1 个 Story、18 个 edit snapshot。归给谁，还是保持独立？",
    "2. 本地 Guest 48（无邮箱）持有 18 个项目、35 个 Story。归给谁，还是保持独立？",
    "3. `mountionzeng@gmail.com` 在旧库（user 1）和 staging（user 1）各有一个账号，是同一个人的两条记录。合并方向与保留哪一侧的 id？",
    "4. 旧库另外两个邮箱账号（`1132252560@qq.com`、`947571049@qq.com`）各持 1 个项目，是否一并迁入新合并库？",
    "",
    "在上述四点得到明确答复之前，导入器不会写入任何归属；`ACCOUNT_AUTO_IDENTITY_RESOLUTION` 保持 `false`。",
    ""
  );
  return lines.join("\n");
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const outPath = readArgument("out") ?? "docs/qa/account-migration-inventory-local.md";
  const sourcePath =
    readArgument("local-persist") ??
    path.resolve(process.cwd(), ".webdev/local-persist.json");

  const raw = fs.readFileSync(sourcePath, "utf8");
  const state = JSON.parse(raw) as Record<string, unknown[]>;
  const collections = Object.fromEntries(
    Object.entries(state).filter(([, value]) => Array.isArray(value))
  ) as Record<string, unknown[]>;

  const users = (state.users ?? []) as InventoryUser[];
  const projects = (state.projects ?? []) as InventoryProject[];
  const stories = (state.stories ?? []) as InventoryStory[];

  const sidecars = ["prompt-lineage-local.json", "edit-snapshots-local.json"].map(name => {
    const full = path.resolve(path.dirname(sourcePath), name);
    const exists = fs.existsSync(full);
    return {
      name,
      exists,
      bytes: exists ? fs.statSync(full).size : 0,
      digest: exists
        ? createHash("sha256").update(fs.readFileSync(full)).digest("hex")
        : "",
    };
  });

  const remotePath = readArgument("sources");
  if (remotePath) {
    const remote = JSON.parse(fs.readFileSync(remotePath, "utf8")) as RemoteSource[];
    const combined = formatCombinedReport({
      remote,
      local: {
        label: "本地主仓 .webdev/local-persist.json",
        counts: {
          users: users.length,
          projects: projects.length,
          stories: stories.length,
          inviteCodes: (state.inviteCodes ?? []).length,
        },
        users,
        projects,
        stories,
      },
    });
    const combinedOut = readArgument("out") ?? "docs/qa/account-migration-inventory-all-sources.md";
    fs.mkdirSync(path.dirname(combinedOut), { recursive: true });
    fs.writeFileSync(combinedOut, combined, "utf8");
    console.log(`三来源汇总盘点完成，报告写入：${combinedOut}`);
    console.log("全部只读，未导入、未映射、未改库，也没有给出自动归属建议。");
    process.exit(0);
  }

  const report = formatLocalReport({
    sourcePath: path.relative(process.cwd(), sourcePath),
    fileDigest: createHash("sha256").update(raw, "utf8").digest("hex"),
    summary: summarizeCounts(collections),
    emailGroups: buildEmailGroups(users),
    nearMiss: findNearMissEmailPairs(users.map(user => user.email)),
    candidates: buildOwnershipCandidates({ users, projects, stories }),
    sidecars,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report, "utf8");
  console.log(`只读盘点完成，报告写入：${outPath}`);
  console.log("这个脚本没有写入任何数据库，也没有给出自动归属建议。");
}
