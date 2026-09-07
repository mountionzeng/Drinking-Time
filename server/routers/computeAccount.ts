/**
 * 算力账户对外读接口。
 *
 * 账本（computeLedger）从 2026-09-03 就在记账了，但一直没有任何 procedure 把
 * 余额交给前端——用户看得到「这次要花 ¥0.42」，看不到「我还剩多少」。这个
 * router 只补那一层，不碰记账逻辑本身。
 *
 * 三条硬规矩：
 *
 * 1. **userId 只从 `ctx.user.id` 取**，input 里没有任何身份字段。余额是钱，
 *    一旦允许客户端声明「我是谁」，越权查账就是一个参数的事。
 * 2. **只读**。充值、赠送、人工调整都不在这里——那些要留痕、要幂等键、要
 *    操作者身份，属于运营侧接口，不该和用户自己的查询挤在一个 router 里。
 * 3. **微元原样出去，不在服务端转成元**。转换和取整是展示层的事；服务端一
 *    旦提前折成浮点的「元」，逐笔明细就再也对不上供应商账单了。
 */
import { protectedProcedure, router } from "../_core/trpc";
import { getAccountBalance } from "../services/computeLedger";

export const computeAccountRouter = router({
  /**
   * 当前用户的算力账户余额。
   *
   * 返回的四个数都是微元（1 元 = 1_000_000 微元）：
   * - postedMinor    已入账余额
   * - reservedMinor  正在进行的生成占住的钱
   * - availableMinor 可用 = 已入账 − 预占，**可能为负**，那是账务异常，
   *                  这里原样透出，不 clamp 成 0 把问题盖掉
   * - lifetimeSpentMinor 累计消费
   */
  balance: protectedProcedure.query(async ({ ctx }) => {
    const summary = await getAccountBalance(ctx.user.id);
    return {
      postedMinor: summary.balanceMinor,
      reservedMinor: summary.reservedMinor,
      availableMinor: summary.availableMinor,
      lifetimeSpentMinor: summary.lifetimeSpentMinor,
      accessEnabledAt: summary.accessEnabledAt,
    };
  }),
});
