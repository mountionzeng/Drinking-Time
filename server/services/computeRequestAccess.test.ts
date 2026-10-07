import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import {
  assertComputeRequestAccess,
  guardComputeFetch,
  noteComputeReservation,
  withComputeUser,
} from "./computeRequestAccess";
import type { TrpcContext } from "../_core/context";

const db = vi.hoisted(() => ({
  getDb: vi.fn(),
  getCreditAccountSummary: vi.fn(),
  findActiveCreditHold: vi.fn(),
  findBillingOperation: vi.fn(),
}));
vi.mock("../db", () => db);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.resetAllMocks();
  db.getDb.mockResolvedValue({});
  db.getCreditAccountSummary.mockResolvedValue({ availableMinor: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe("production provider admission", () => {
  it.each([0, -1, NaN, Infinity, undefined])(
    "blocks invalid or exhausted balance %s before sending",
    async availableMinor => {
      db.getCreditAccountSummary.mockResolvedValue({ availableMinor });
      const send = vi.fn(async () => new Response("ok"));
      await expect(
        withComputeUser(12, () =>
          guardComputeFetch(send)("https://provider.test", { method: "POST" })
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(send).not.toHaveBeenCalled();
    }
  );
  it("requires server identity and ignores a body userId or administrator flag", async () => {
    const send = vi.fn(async () => new Response("ok"));
    await expect(
      guardComputeFetch(send)("https://provider.test", {
        method: "POST",
        body: '{"userId":12,"role":"admin"}',
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(send).not.toHaveBeenCalled();
    expect(db.getCreditAccountSummary).not.toHaveBeenCalled();
  });
  it("fails closed when the ledger is unavailable", async () => {
    db.getCreditAccountSummary.mockRejectedValue(new Error("db unavailable"));
    await expect(
      withComputeUser(12, assertComputeRequestAccess)
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
  it("checks every submission, including retries after the balance is exhausted", async () => {
    db.getCreditAccountSummary
      .mockResolvedValueOnce({ availableMinor: 100 })
      .mockResolvedValue({ availableMinor: 0 });
    const send = vi.fn(async () => new Response("ok"));
    await withComputeUser(12, async () => {
      await guardComputeFetch(send)("https://provider.test", {
        method: "POST",
      });
      await expect(
        guardComputeFetch(send)("https://provider.test", { method: "POST" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("allows funded requests and already-reserved money owned by this request", async () => {
    db.findActiveCreditHold.mockResolvedValue({ amountMinor: 100 });
    db.findBillingOperation.mockResolvedValue({ userId: 12 });
    await withComputeUser(12, async () => {
      noteComputeReservation(12, "op-12");
      await assertComputeRequestAccess();
    });
    await expect(
      withComputeUser(13, async () => {
        noteComputeReservation(12, "op-12");
        await assertComputeRequestAccess();
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not reuse a released hold", async () => {
    db.findActiveCreditHold.mockResolvedValue(null);
    db.findBillingOperation.mockResolvedValue({ userId: 12 });
    await expect(
      withComputeUser(12, async () => {
        noteComputeReservation(12, "released");
        await assertComputeRequestAccess();
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("isolates concurrent accounts and denies every zero-balance call", async () => {
    db.getCreditAccountSummary.mockImplementation(async (id: number) => ({
      availableMinor: id === 12 ? 10 : 0,
    }));
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) =>
        withComputeUser(i % 2 ? 12 : 13, assertComputeRequestAccess)
      )
    );
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(20);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(20);
  });
  it("allows downloading existing media and polling existing tasks with no balance", async () => {
    const send = vi.fn(async () => new Response("ok"));
    await guardComputeFetch(send)("https://provider.test/result", {
      method: "GET",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.getCreditAccountSummary).not.toHaveBeenCalled();
  });
  it("checks a POST encoded in Request, not only RequestInit", async () => {
    const send = vi.fn(async () => new Response("ok"));
    await expect(
      withComputeUser(12, () =>
        guardComputeFetch(send)(
          new Request("https://provider.test", { method: "POST" })
        )
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(send).not.toHaveBeenCalled();
  });
  it("cannot enable the development exception on production", async () => {
    vi.stubEnv("LOCAL_COMPUTE_UNLIMITED", "true");
    await expect(
      withComputeUser(12, assertComputeRequestAccess)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.stubEnv("NODE_ENV", "development");
    await withComputeUser(12, assertComputeRequestAccess);
  });
  it("preserves normal tRPC login/read/save and carries identity into paid work", async () => {
    const app = router({
      me: publicProcedure.query(({ ctx }) => ctx.user?.id ?? null),
      read: protectedProcedure.query(() => "saved story"),
      save: protectedProcedure.mutation(() => "saved"),
      paid: protectedProcedure.mutation(assertComputeRequestAccess),
    });
    const ctx = { user: { id: 12 }, req: {}, res: {} } as TrpcContext;
    const caller = app.createCaller(ctx);
    expect(await caller.me()).toBe(12);
    expect(await caller.read()).toBe("saved story");
    expect(await caller.save()).toBe("saved");
    await expect(caller.paid()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.getCreditAccountSummary).toHaveBeenCalledWith(12);
  });
});
