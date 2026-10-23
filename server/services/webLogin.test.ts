import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: number; lookupHash: string; verifierHash: string; codeHash: string; status: string; mode: "login" | "bind";
  bindUserId: number | null; userId: number | null; clientHint: string; expiresAt: Date; confirmedAt: Date | null; consumedAt: Date | null;
};
const store = vi.hoisted(() => ({ rows: [] as Row[], limited: new Set<string>() }));
const bind = vi.hoisted(() => ({ result: "bound" as "bound" | "merge_required" }));

vi.mock("../_core/env", () => ({ ENV: { otpDigestSecret: "test-otp-digest-secret", otpDigestSecretVersion: "1" } }));
vi.mock("../repositories/accounts", () => ({
  consumePersistentRateLimit: vi.fn(async (input: { scope: string }) =>
    store.limited.has(input.scope) ? { allowed: false, attemptCount: 99, retryAfterMs: 1000 } : { allowed: true, attemptCount: 1, retryAfterMs: 0 }),
}));
vi.mock("./accountIdentity", () => ({
  resolveWechatAccount: vi.fn(async () => 77),
  bindWechatAccount: vi.fn(async () => bind.result),
}));
vi.mock("../repositories/webLoginRequests", () => ({
  insertWebLoginRequest: vi.fn(async (row: Omit<Row, "id" | "status" | "userId" | "confirmedAt" | "consumedAt">) => {
    if (store.rows.some(item => item.codeHash === row.codeHash)) return false;
    store.rows.push({ ...row, id: store.rows.length + 1, status: "pending", userId: null, confirmedAt: null, consumedAt: null });
    return true;
  }),
  findWebLoginByLookup: vi.fn(async (hash: string) => store.rows.find(row => row.lookupHash === hash) ?? null),
  findOpenWebLoginByCode: vi.fn(async (hash: string, now: Date) =>
    store.rows.find(row => row.codeHash === hash && ["pending", "scanned"].includes(row.status) && row.expiresAt > now) ?? null),
  markWebLoginScanned: vi.fn(async (id: number) => { const row = store.rows.find(item => item.id === id); if (row?.status === "pending") row.status = "scanned"; }),
  decideWebLogin: vi.fn(async (input: { id: number; status: string; userId: number | null; now: Date }) => {
    const row = store.rows.find(item => item.id === input.id);
    if (!row || !["pending", "scanned"].includes(row.status) || row.expiresAt <= input.now) return false;
    Object.assign(row, { status: input.status, userId: input.userId, confirmedAt: input.now });
    return true;
  }),
  consumeConfirmedWebLogin: vi.fn(async (input: { lookupHash: string; verifierHash: string; now: Date }) => {
    const row = store.rows.find(item => item.lookupHash === input.lookupHash && item.verifierHash === input.verifierHash && item.status === "confirmed" && !item.consumedAt);
    if (!row || row.userId === null) return null;
    row.status = "consumed"; row.consumedAt = input.now;
    return { userId: row.userId, mode: row.mode };
  }),
}));

import { coarseClientHint, confirmWebLoginBySubject, createWebLoginRequest, pollWebLoginRequest } from "./webLogin";

const subject = `shiguang:${"b".repeat(64)}`;
const now = new Date("2026-10-23T10:00:00.000Z");
const later = (ms: number) => new Date(now.getTime() + ms);

async function create(extra: { bindUserId?: number } = {}) {
  const created = await createWebLoginRequest({ requestIp: "1.2.3.4", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36", now, ...extra });
  if (created.outcome !== "created") throw new Error("not created");
  return created;
}

beforeEach(() => { store.rows = []; store.limited.clear(); bind.result = "bound"; });

describe("网页登录请求", () => {
  it("只存摘要：库里没有明文的码、L 或验证值", async () => {
    const c = await create();
    const row = store.rows[0];
    const dump = JSON.stringify(row);
    for (const secretValue of [c.code, c.l, c.v]) expect(dump).not.toContain(secretValue);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.v.length).toBeGreaterThanOrEqual(43);
    expect(c.expiresAt.getTime() - now.getTime()).toBe(120_000);
    expect(c.clientHint).toBe("Mac · Chrome");
  });

  it("确认后登录到 resolveWechatAccount 返回的 userId，且只能取一次", async () => {
    const c = await create();
    expect(await confirmWebLoginBySubject({ subject, code: c.code, decision: "confirm", now: later(5_000) })).toEqual({ outcome: "confirmed" });
    const first = await pollWebLoginRequest({ l: c.l, v: c.v, requestIp: "1.2.3.4", now: later(6_000) });
    expect(first).toEqual({ status: "confirmed", userId: 77, mode: "login" });
    const second = await pollWebLoginRequest({ l: c.l, v: c.v, requestIp: "1.2.3.4", now: later(7_000) });
    expect(second).toEqual({ status: "expired" });
  });

  it("浏览器验证值不对不能登录，也不会消耗请求", async () => {
    const c = await create();
    await confirmWebLoginBySubject({ subject, code: c.code, decision: "confirm", now: later(5_000) });
    const other = await create();
    expect(await pollWebLoginRequest({ l: c.l, v: other.v, requestIp: "9.9.9.9", now: later(6_000) })).toEqual({ status: "expired" });
    expect(await pollWebLoginRequest({ l: c.l, v: c.v, requestIp: "1.2.3.4", now: later(6_500) })).toMatchObject({ status: "confirmed" });
  });

  it("过期后码无效，轮询只返回 expired", async () => {
    const c = await create();
    expect(await confirmWebLoginBySubject({ subject, code: c.code, decision: "confirm", now: later(121_000) })).toEqual({ outcome: "invalid" });
    expect(await pollWebLoginRequest({ l: c.l, v: c.v, requestIp: "1.2.3.4", now: later(121_000) })).toEqual({ status: "expired" });
  });

  it("码输错、已用过、不存在都只有一种失败", async () => {
    const c = await create();
    await confirmWebLoginBySubject({ subject, code: c.code, decision: "confirm", now: later(1_000) });
    const used = await confirmWebLoginBySubject({ subject, code: c.code, decision: "confirm", now: later(2_000) });
    const missing = await confirmWebLoginBySubject({ subject, code: "ZZZZZZ", decision: "confirm", now: later(2_000) });
    const malformed = await confirmWebLoginBySubject({ subject, code: "12", decision: "confirm", now: later(2_000) });
    expect(used).toEqual({ outcome: "invalid" });
    expect(missing).toEqual(used);
    expect(malformed).toEqual(used);
  });

  it("轮询结果永远不带码", async () => {
    const c = await create();
    const polled = await pollWebLoginRequest({ l: c.l, v: c.v, requestIp: "1.2.3.4", now: later(1_000) });
    expect(JSON.stringify(polled)).not.toContain(c.code);
  });

  it("三层限流：确认按 subject 与全局，轮询按 L+IP，创建按 IP", async () => {
    const c = await create();
    store.limited.add("weblogin:confirm:minute");
    expect(await confirmWebLoginBySubject({ subject, code: c.code, decision: "confirm", now: later(1_000) })).toEqual({ outcome: "rate_limited" });
    store.limited.clear(); store.limited.add("weblogin:confirm:global");
    expect(await confirmWebLoginBySubject({ subject, code: c.code, decision: "confirm", now: later(1_000) })).toEqual({ outcome: "rate_limited" });
    store.limited.clear(); store.limited.add("weblogin:poll");
    expect(await pollWebLoginRequest({ l: c.l, v: c.v, requestIp: "1.2.3.4", now: later(1_000) })).toMatchObject({ status: "rate_limited" });
    store.limited.clear(); store.limited.add("weblogin:create");
    expect(await createWebLoginRequest({ requestIp: "1.2.3.4", now })).toMatchObject({ outcome: "rate_limited" });
  });

  it("拒绝：网页看到 denied，且不能再确认", async () => {
    const c = await create();
    expect(await confirmWebLoginBySubject({ subject, code: c.code, decision: "deny", now: later(1_000) })).toEqual({ outcome: "denied" });
    expect(await pollWebLoginRequest({ l: c.l, v: c.v, requestIp: "1.2.3.4", now: later(2_000) })).toEqual({ status: "denied" });
    expect(await confirmWebLoginBySubject({ subject, code: c.code, decision: "confirm", now: later(3_000) })).toEqual({ outcome: "invalid" });
  });

  it("预览返回电脑提示并标为已扫码", async () => {
    const c = await create();
    expect(await confirmWebLoginBySubject({ subject, code: c.code, decision: "preview", now: later(1_000) })).toEqual({ outcome: "preview", clientHint: "Mac · Chrome", mode: "login" });
    expect(await pollWebLoginRequest({ l: c.l, v: c.v, requestIp: "1.2.3.4", now: later(2_000) })).toEqual({ status: "scanned" });
  });

  it("绑定模式：已登录用户的 userId 取自会话，merge_required 如实返回且不建会话", async () => {
    bind.result = "merge_required";
    const c = await create({ bindUserId: 5 });
    expect(await confirmWebLoginBySubject({ subject, code: c.code, decision: "confirm", now: later(1_000) })).toEqual({ outcome: "merge_required" });
    expect(await pollWebLoginRequest({ l: c.l, v: c.v, requestIp: "1.2.3.4", now: later(2_000) })).toEqual({ status: "merge_required" });
    bind.result = "bound";
    const d = await create({ bindUserId: 5 });
    await confirmWebLoginBySubject({ subject, code: d.code, decision: "confirm", now: later(1_000) });
    expect(await pollWebLoginRequest({ l: d.l, v: d.v, requestIp: "1.2.3.4", now: later(2_000) })).toEqual({ status: "confirmed", userId: 5, mode: "bind" });
  });

  it("只记粗粒度的系统和浏览器", () => {
    expect(coarseClientHint("Mozilla/5.0 (Windows NT 10.0) Edg/120 Chrome/120")).toBe("Windows · Edge");
    expect(coarseClientHint(undefined)).toBe("电脑 · 浏览器");
  });
});
