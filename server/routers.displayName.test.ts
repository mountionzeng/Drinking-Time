import { beforeEach, expect, it } from "vitest";
import { appRouter } from "./routers";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "./db";
import type { TrpcContext } from "./_core/context";

beforeEach(() => resetMemoryStateForTesting());
it("仅允许当前账号改名，拒绝空白、控制字符和伪造目标账号", async () => {
  const context = {
    user: null,
    req: { headers: {} },
    res: {},
  } as unknown as TrpcContext;
  await expect(
    appRouter.createCaller(context).auth.setDisplayName({ name: "笔名" })
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await upsertUser({ openId: "email:name-owner", name: "旧名字" });
  await upsertUser({ openId: "email:name-other", name: "另一个人" });
  const user = (await getUserByOpenId("email:name-owner"))!;
  const api = appRouter.createCaller({ ...context, user });
  for (const name of ["  ", "名字\n第二行", "字".repeat(81)]) {
    await expect(api.auth.setDisplayName({ name })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  }
  await expect(
    api.auth.setDisplayName({ name: "冒名", userId: 2 } as never)
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await api.auth.setDisplayName({ name: "  山间来信  " })).toEqual({
    name: "山间来信",
  });
  expect((await getUserByOpenId(user.openId))?.name).toBe("山间来信");
  expect((await getUserByOpenId("email:name-other"))?.name).toBe("另一个人");
});
