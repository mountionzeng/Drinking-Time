import { createHash, createHmac } from "node:crypto";

import { ENV } from "../_core/env";

/**
 * 把本地参考图放到一个「供应商能匿名拉取」的公网地址上。
 *
 * 为什么要单独一层：
 * Midjourney 的 --oref / --sref 是提示词参数，值必须是公网 http(s) URL，
 * 由 MJ 服务端自己去拉；data URI 和本地路径一律不作数。所以「锁人物长相 / 锁画风」
 * 这两件事天然需要一个公开可读的托管点。
 *
 * 原先复用的是 `storagePut`（BUILT_IN_FORGE_API_URL → api.302ai.cn 的存储代理），
 * 但那条路 2026-08-22 实测持续 503，而且返回的是「当前无可用模型」——一个存储端点
 * 回模型错误，说明该网关根本没路由 /v1/storage/*。整条「绑定资产 → 出图」于是全堵死。
 *
 * 这一层把「异地备份」和「给供应商用的公网参考」拆开：备份挂了不影响出图，
 * 出图用的托管点可以独立配置成自己的对象存储。
 */

export type PublicReferenceUploader = (input: {
  key: string;
  bytes: Buffer;
  contentType: string;
}) => Promise<string | undefined>;

type OssConfig = {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  publicBaseUrl?: string;
};

export function ossConfigFromEnv(): OssConfig | undefined {
  const region = ENV.ossRegion?.trim();
  const bucket = ENV.ossBucket?.trim();
  const accessKeyId = ENV.ossAccessKeyId?.trim();
  const accessKeySecret = ENV.ossAccessKeySecret?.trim();
  if (!region || !bucket || !accessKeyId || !accessKeySecret) return undefined;
  const publicBaseUrl = ENV.ossPublicBaseUrl?.trim();
  return {
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    ...(publicBaseUrl ? { publicBaseUrl: publicBaseUrl.replace(/\/+$/, "") } : {}),
  };
}

/** OSS 签名 V1：Authorization: OSS <id>:<base64(hmac-sha1(secret, StringToSign))> */
export function signOssRequest(input: {
  config: OssConfig;
  verb: string;
  key: string;
  contentType: string;
  contentMd5: string;
  date: string;
  ossHeaders: Record<string, string>;
}): string {
  // CanonicalizedOSSHeaders：所有 x-oss-* 头小写、按字典序、每条 "k:v\n"
  const canonicalHeaders = Object.entries(input.ossHeaders)
    .map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, value]) => `${name}:${value}\n`)
    .join("");
  const canonicalResource = `/${input.config.bucket}/${input.key}`;
  const stringToSign = [
    input.verb,
    input.contentMd5,
    input.contentType,
    input.date,
    `${canonicalHeaders}${canonicalResource}`,
  ].join("\n");
  const signature = createHmac("sha1", input.config.accessKeySecret)
    .update(stringToSign, "utf8")
    .digest("base64");
  return `OSS ${input.config.accessKeyId}:${signature}`;
}

function endpointFor(config: OssConfig, key: string): string {
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
  }
  return `https://${config.bucket}.${config.region}.aliyuncs.com/${key}`;
}

/**
 * 上传一份公开可读的参考图，返回公网 URL；未配置 OSS 时返回 undefined。
 *
 * 对象设为 public-read —— MJ 服务端是匿名来拉的，没法带鉴权。
 * 因此 key 里带内容哈希，避免可枚举：知道 storyId 也猜不出别人的图。
 */
export async function putPublicReference(input: {
  key: string;
  bytes: Buffer;
  contentType: string;
  config?: OssConfig;
  fetcher?: typeof fetch;
  now?: () => Date;
}): Promise<string | undefined> {
  const config = input.config ?? ossConfigFromEnv();
  if (!config) return undefined;
  const fetcher = input.fetcher ?? fetch;
  const date = (input.now?.() ?? new Date()).toUTCString();
  const contentMd5 = createHash("md5").update(input.bytes).digest("base64");
  const ossHeaders = { "x-oss-object-acl": "public-read" };
  const authorization = signOssRequest({
    config,
    verb: "PUT",
    key: input.key,
    contentType: input.contentType,
    contentMd5,
    date,
    ossHeaders,
  });
  const url = `https://${config.bucket}.${config.region}.aliyuncs.com/${input.key}`;
  const response = await fetcher(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": input.contentType,
      "Content-MD5": contentMd5,
      Date: date,
      ...ossHeaders,
    },
    body: new Uint8Array(input.bytes) as unknown as BodyInit,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(
      `OSS 上传失败 (${response.status}): ${detail.slice(0, 200).replace(/\s+/g, " ")}`
    );
  }
  return endpointFor(config, input.key);
}

/** 内容哈希前缀，让公开对象不可枚举。 */
export function publicReferenceKey(fileName: string, bytes: Buffer): string {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  // `.` 必须留着（扩展名），但连续的点要压掉：`..` 会在签名的 CanonicalizedResource
  // 里穿出 visual-asset-refs/ 前缀，等于允许往桶里任意位置写。
  const safeName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "");
  return `visual-asset-refs/${digest}-${safeName || "ref"}`;
}
