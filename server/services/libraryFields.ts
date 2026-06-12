/**
 * 库条目 schema 的共享 zod 字段助手
 *
 * styleLibrary / literatureLibrary 等库的条目都要把「YAML 空标量(null) / 缺字段」
 * 收敛到安全默认（"" / [] / {}），并把 status 收敛到 draft。把这些助手收成一处，
 * 避免每加一个库就复制一份、日久漂移。
 */
import { z } from "zod";

/** null/undefined → ""（空标量也算空字符串） */
export const strField = z.preprocess((v) => (v == null ? "" : v), z.string());

/** null/undefined → []（缺字段当空列表） */
export const strArrField = z.preprocess(
  (v) => (v == null ? [] : v),
  z.array(z.string()),
);

/** null/undefined → {}；字符串→数字 的权重表 */
export const numRecField = z.preprocess(
  (v) => (v == null ? {} : v),
  z.record(z.string(), z.number()),
);

/** 人群亲和权重：age/profession/wuxing 三张权重表，整体或子表缺失都收敛到 {} */
export const affinityField = z.preprocess(
  (v) => (v == null ? {} : v),
  z.object({
    age: numRecField,
    profession: numRecField,
    wuxing: numRecField,
  }),
);

/** 任何非 draft/active 的值或缺失都收敛为 draft（宁可不上线，别误上线） */
export const statusField = z.enum(["draft", "active"]).catch("draft");
