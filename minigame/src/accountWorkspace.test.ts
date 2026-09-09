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
