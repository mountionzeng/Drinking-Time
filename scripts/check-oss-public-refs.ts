/**
 * 检查「给供应商用的公网参考图」托管是否真的可用。
 *
 * 为什么需要单独一个检查：
 * MJ 的 --oref / --sref 要 MJ 服务端**自己去匿名拉**那个 URL。所以"上传成功"不算通过，
 * 必须再用**不带任何鉴权**的请求把它读回来，才等于 MJ 读得到。
 * 2026-08-22 之前用的 storagePut（api.302ai.cn）就是上传这一步就 503，
 * 而且返回的是「当前无可用模型」——存储端点回模型错误。
 *
 * 用法：pnpm exec tsx scripts/check-oss-public-refs.ts
 * 不会打印任何密钥。探测对象会留在桶里（几十字节），可以手动删。
 */
import "dotenv/config";

import {
  ossConfigFromEnv,
  publicReferenceKey,
  putPublicReference,
} from "../server/services/publicReferenceHost";

function mask(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}（长度 ${value.length}）`;
}

async function main(): Promise<void> {
  const config = ossConfigFromEnv();
  if (!config) {
    console.log("未配置 OSS —— toPublicImageUrl 会回落到旧的 storagePut。");
    console.log("需要这几个环境变量（写进 .env，不要贴进对话）：");
    console.log("  OSS_REGION            例：oss-cn-hangzhou");
    console.log("  OSS_BUCKET");
    console.log("  OSS_ACCESS_KEY_ID");
    console.log("  OSS_ACCESS_KEY_SECRET");
    console.log("  OSS_PUBLIC_BASE_URL   可选，自定义域名");
    process.exitCode = 1;
    return;
  }

  console.log("配置已读到：");
  console.log(`  region  ${config.region}`);
  console.log(`  bucket  ${config.bucket}`);
  console.log(`  keyId   ${mask(config.accessKeyId)}`);
  console.log(`  域名    ${config.publicBaseUrl ?? "（用默认 bucket 域名）"}`);

  const bytes = Buffer.from(`probe ${new Date().toISOString()}`);
  const key = publicReferenceKey("probe.txt", bytes);

  let url: string | undefined;
  try {
    url = await putPublicReference({ key, bytes, contentType: "text/plain" });
  } catch (error) {
    console.log("");
    console.log("✗ 上传失败：", error instanceof Error ? error.message : error);
    console.log("  常见原因：AK 没有该桶的 PutObject 权限；region 和桶不匹配；");
    console.log("  桶开了「阻止公共访问」导致 x-oss-object-acl: public-read 被拒。");
    process.exitCode = 1;
    return;
  }
  if (!url) {
    console.log("✗ putPublicReference 返回空，配置读取异常。");
    process.exitCode = 1;
    return;
  }
  console.log("");
  console.log("✓ 上传成功：", url);

  // 关键一步：不带任何鉴权地读回来。MJ 就是这么拉的。
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      console.log(`✗ 匿名读取失败：HTTP ${response.status}`);
      console.log("  上传通了但读不到 = MJ 也读不到，--oref/--sref 会被跳过。");
      console.log("  多半是桶的「阻止公共访问」开着，或 Bucket ACL 是私有。");
      process.exitCode = 1;
      return;
    }
    const text = await response.text();
    if (text !== bytes.toString()) {
      console.log("✗ 匿名读回的内容和上传的不一致。");
      process.exitCode = 1;
      return;
    }
    console.log("✓ 匿名读取成功 —— MJ 服务端能拉到这个地址。");
    console.log("");
    console.log("可以跑「绑定资产 → 出图」验收了。");
    console.log(`探测对象留在桶里，可手动删：${key}`);
  } catch (error) {
    console.log("✗ 匿名读取异常：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

void main();
