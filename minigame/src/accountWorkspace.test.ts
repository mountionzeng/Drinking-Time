import { it, expect, vi } from "vitest";
import { createAccountWorkspace } from "./accountWorkspace";
import { buildEmotionAnalysisProfile } from "../../client/src/features/analysis/emotionAnalysis";
import { getTodayNayin } from "../../client/src/features/nayin/nayin";
import type { WorkspaceCall } from "./workspaceClient";
const profile = buildEmotionAnalysisProfile(
  { birthDate: "1990-01-02" },
  getTodayNayin(),
  null
)!;
const letter = {
  id: 1,
  letterDate: getTodayNayin().cstDateStr,
  userMessage: "原话",
  dailyReference: profile.dailyReference,
  analysisSeed: profile.analysisSeed,
  revision: 3,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
function setup(
  extra: Record<string, (input: any) => Promise<any>> = {},
  data = new Map<string, string>()
) {
  const request = vi.fn(async (op: string, input: any) => {
    if (extra[op]) return extra[op](input);
    if (op === "profile.read") return profile;
    if (op === "letters.list") return [letter];
    throw new Error(op);
  });
  const client = createAccountWorkspace(
    request as WorkspaceCall,
    {
      getItem: k => data.get(k) ?? null,
      setItem: (k, v) => {
        data.set(k, v);
      },
      removeItem: k => {
        data.delete(k);
      },
    },
    () => {}
  );
  client.setScope("opaque");
  return { client, request, data };
}
it("saves birth fields through the original profile builder and preserves consent", async () => {
  const { client, request } = setup({
    "profile.save": async input => ({ ...profile, ...input }),
  });
  await client.load();
  client.setField("birthDate", "1991-03-04");
  client.setField("birthTime", "13:20");
  await client.saveProfile();
  expect(request).toHaveBeenCalledWith(
    "profile.save",
    expect.objectContaining({
      birthDate: "1991-03-04",
      consentAccepted: true,
      analysisSeed: expect.objectContaining({ birthTime: "13:20" }),
    })
  );
  expect(client.getState().error).toBe("");
});
it("retains original message revision and keeps edited words on conflict", async () => {
  const { client, request } = setup({
    "letters.rewrite": async () => {
      throw new Error("conflict");
    },
  });
  await client.load();
  client.beginMessage();
  client.setMessage("新原话");
  await client.saveMessage();
  expect(request).toHaveBeenCalledWith("letters.rewrite", {
    letterDate: letter.letterDate,
    expectedRevision: 3,
    userMessage: "新原话",
  });
  expect(client.getState().messageDraft).toBe("新原话");
  expect(client.getState().error).toBeTruthy();
});
it("reuses the exact reread request across restart after an uncertain response", async () => {
  const first = setup({
    "letters.reread": async () => {
      throw new Error("network");
    },
  });
  await first.client.load();
  await first.client.reread();
  const original = first.request.mock.calls.find(
    ([op]) => op === "letters.reread"
  )![1];
  const next = setup(
    { "letters.reread": async () => ({ ok: true }) },
    first.data
  );
  await next.client.load();
  await next.client.reread();
  expect(next.request).toHaveBeenCalledWith("letters.reread", original);
  expect(first.data.size).toBe(0);
});
it("does not fill the next account with a late profile response or request its letters", async () => {
  let resolve!: (value: unknown) => void;
  const { client, request } = setup({
    "profile.read": () =>
      new Promise(r => {
        resolve = r;
      }),
  });
  const loading = client.load();
  client.disconnect();
  resolve(profile);
  await loading;
  expect(client.getState().profile).toBeNull();
  expect(request.mock.calls.some(([op]) => op === "letters.list")).toBe(false);
});
it("loads a statement and does not disguise a failed request as an empty bill", async () => {
  const statement = {
    version: 1,
    currency: "CNY",
    balance: {
      postedMinor: 10_000_000,
      reservedMinor: 1_000_000,
      availableMinor: 9_000_000,
      lifetimeSpentMinor: 321,
    },
    attentionItems: [],
    attentionHasMore: false,
    attentionTruncated: false,
    historyItems: [
      {
        createdAt: "2026-09-13T10:00:00.000Z",
        label: "文字生成",
        amountMinor: -321,
        reservedMinor: 0,
        releasedMinor: 0,
        status: "posted",
        estimated: true,
      },
    ],
    historyHasMore: false,
    historyTruncated: false,
    coverageNote: "只显示已进入算力账本的调用。",
  } as const;
  const { client } = setup({
    "account.statement": async () => statement,
  });

  await client.statement();
  expect(client.getState().statement).toEqual(statement);
  expect(client.getState().statementError).toBe("");

  const failed = setup({
    "account.statement": async () => {
      throw new Error("network");
    },
  }).client;
  await failed.statement();
  expect(failed.getState().statement).toBeNull();
  expect(failed.getState().statementError).toBeTruthy();
});

it("clears the previous account statement when account scope changes", async () => {
  const { client } = setup({
    "account.statement": async () => ({
      version: 1,
      currency: "CNY",
      balance: {
        postedMinor: 1,
        reservedMinor: 0,
        availableMinor: 1,
        lifetimeSpentMinor: 0,
      },
      attentionItems: [],
      attentionHasMore: false,
      attentionTruncated: false,
      historyItems: [],
      historyHasMore: false,
      historyTruncated: false,
      coverageNote: "note",
    }),
  });
  await client.statement();
  expect(client.getState().statement).not.toBeNull();
  client.setScope("another-account");
  expect(client.getState().statement).toBeNull();
});

it("does not let a late statement response or failure cross into another account", async () => {
  let resolve!: (value: any) => void;
  const first = setup({
    "account.statement": () => new Promise(r => (resolve = r)),
  }).client;
  const loading = first.statement();
  first.setScope("next-account");
  resolve({
    version: 1,
    currency: "CNY",
    balance: {
      postedMinor: 99_000_000,
      reservedMinor: 0,
      availableMinor: 99_000_000,
      lifetimeSpentMinor: 0,
    },
    attentionItems: [],
    attentionHasMore: false,
    attentionTruncated: false,
    historyItems: [],
    historyHasMore: false,
    historyTruncated: false,
    coverageNote: "old account",
  });
  await loading;
  expect(first.getState()).toMatchObject({
    balance: null,
    statement: null,
    statementBusy: false,
    statementError: "",
  });

  let reject!: (error: Error) => void;
  const second = setup({
    "account.statement": () => new Promise((_resolve, fail) => (reject = fail)),
  }).client;
  const failing = second.statement();
  second.disconnect();
  reject(new Error("old failure"));
  await failing;
  expect(second.getState().statementError).toBe("");
});

it("rejects malformed or incompatible statement payloads before they reach canvas state", async () => {
  const { client } = setup({
    "account.statement": async () => ({
      version: 2,
      currency: "CNY",
      balance: {},
      attentionItems: [],
      attentionHasMore: false,
      attentionTruncated: false,
      historyItems: [],
      historyHasMore: false,
      historyTruncated: false,
      coverageNote: "new contract",
    }),
  });

  await client.statement();

  expect(client.getState().statement).toBeNull();
  expect(client.getState().statementError).toContain("版本不兼容");
});

it("loads more history with a bounded offset and appends it without duplicates", async () => {
  const billed = (label: string, createdAt: string) => ({
    createdAt,
    label,
    amountMinor: -321,
    reservedMinor: 0,
    releasedMinor: 0,
    status: "posted" as const,
    estimated: true,
  });
  const first = {
    version: 1 as const,
    currency: "CNY" as const,
    balance: {
      postedMinor: 10_000_000,
      reservedMinor: 0,
      availableMinor: 10_000_000,
      lifetimeSpentMinor: 642,
    },
    attentionItems: [],
    attentionHasMore: false,
    attentionTruncated: false,
    historyItems: [billed("较新记录", "2026-09-13T10:00:00.000Z")],
    historyHasMore: true,
    historyTruncated: false,
    coverageNote: "note",
  };
  const { client, request } = setup({
    "account.statement": async input =>
      input.historyOffset === 1
        ? {
            ...first,
            historyItems: [billed("较早记录", "2026-09-12T10:00:00.000Z")],
            historyHasMore: false,
          }
        : first,
  });

  await client.statement();
  await client.moreStatement("history");

  expect(request).toHaveBeenLastCalledWith(
    "account.statement",
    expect.objectContaining({ historyOffset: 1, historyLimit: 50 })
  );
  expect(
    client.getState().statement?.historyItems.map(item => item.label)
  ).toEqual(["较新记录", "较早记录"]);
  expect(client.getState().statement?.historyHasMore).toBe(false);
});

it("keeps two legitimate charges even when every public display field is identical", async () => {
  const item = {
    createdAt: "2026-09-13T10:00:00.000Z",
    label: "文字生成",
    amountMinor: -321,
    reservedMinor: 0,
    releasedMinor: 0,
    status: "posted" as const,
    estimated: true,
  };
  const base = {
    version: 1 as const,
    currency: "CNY" as const,
    balance: {
      postedMinor: 10_000_000,
      reservedMinor: 0,
      availableMinor: 10_000_000,
      lifetimeSpentMinor: 642,
    },
    attentionItems: [],
    attentionHasMore: false,
    attentionTruncated: false,
    historyItems: [item],
    historyHasMore: true,
    historyTruncated: false,
    coverageNote: "note",
  };
  const { client } = setup({
    "account.statement": async input =>
      input.historyOffset === 1 ? { ...base, historyHasMore: false } : base,
  });

  await client.statement();
  await client.moreStatement("history");

  expect(client.getState().statement?.historyItems).toHaveLength(2);
});
