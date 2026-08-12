/**
 * check-image-pipeline — 花钱之前先问一句：出图链路现在通不通？
 *
 * 2026-08-12 的教训：一整天的「生成失败」里没有一次是出图代码的错，全部是本机
 * 代理把 302 的域名劫持成 fake-IP 后隧道不稳。但每次都要等任务失败、翻日志、
 * 对时间线才能确认，而每次确认都可能已经扣过费。
 *
 * 这个脚本只做只读探测：解析域名、量 TCP 连接耗时、发一个不产生图片的请求。
 * 不提交任务、不花钱、不写数据。
 */
import { lookup } from "node:dns/promises";
import net from "node:net";
import { ENV } from "../server/_core/env";

/** RFC 2544 基准测试保留段，也是 Shadowrocket / Clash fake-IP 模式的取值区间。 */
const FAKE_IP_PREFIX = /^198\.1[89]\./;
const HOSTS = ["api.302.ai", "file.302.ai"] as const;
const CONNECT_TIMEOUT_MS = 8_000;
/** 空请求超过这个耗时，几 MB 的图生图提交基本没有活路。 */
const SLOW_REQUEST_MS = 2_000;

type HostReport = {
  host: string;
  addresses: string[];
  fakeIp: boolean;
  connectMs: number | null;
  connectError: string | null;
};

async function timedConnect(
  host: string,
  port = 443
): Promise<{ ms: number | null; error: string | null }> {
  const startedAt = Date.now();
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = (error: string | null) => {
      socket.destroy();
      resolve({ ms: error ? null : Date.now() - startedAt, error });
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () =>
      done(`连接超时（${CONNECT_TIMEOUT_MS}ms）`)
    );
    socket.once("connect", () => done(null));
    socket.once("error", err => done(err.message));
  });
}

async function inspectHost(host: string): Promise<HostReport> {
  let addresses: string[] = [];
  try {
    addresses = (await lookup(host, { all: true, family: 4 })).map(a => a.address);
  } catch (error) {
    return {
      host,
      addresses: [],
      fakeIp: false,
      connectMs: null,
      connectError: `域名解析失败：${error instanceof Error ? error.message : error}`,
    };
  }
  const { ms, error } = await timedConnect(host);
  return {
    host,
    addresses,
    fakeIp: addresses.some(a => FAKE_IP_PREFIX.test(a)),
    connectMs: ms,
    connectError: error,
  };
}

async function probeApi(): Promise<{ ms: number; status: number } | string> {
  if (!ENV.api302Key?.trim()) return "未配置 302 API Key，跳过接口探测";
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    // 只打根路径：不带任务参数，不会产生任何出图费用。
    const response = await fetch("https://api.302.ai/", {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { ms: Date.now() - startedAt, status: response.status };
  } catch (error) {
    const cause =
      error instanceof Error && error.cause ? `（${String(error.cause)}）` : "";
    return `请求失败：${error instanceof Error ? error.message : error}${cause}`;
  }
}

async function main() {
  console.log("出图链路体检（只读，不提交任务、不扣费）\n");
  const reports = await Promise.all(HOSTS.map(inspectHost));
  const problems: string[] = [];

  for (const r of reports) {
    const addr = r.addresses.length ? r.addresses.join(", ") : "（无）";
    console.log(`${r.host}`);
    console.log(`   解析 → ${addr}${r.fakeIp ? "   ← fake-IP 段" : ""}`);
    if (r.connectError) {
      console.log(`   连接 → ${r.connectError}`);
      problems.push(`${r.host} 无法建立连接：${r.connectError}`);
    } else {
      console.log(`   连接 → ${r.connectMs}ms`);
    }
    if (r.fakeIp) {
      problems.push(
        `${r.host} 被解析到 ${addr}，属于保留网段：本机代理正在劫持它，隧道不稳会导致提交中断`
      );
    }
  }

  const api = await probeApi();
  console.log("\napi.302.ai 空请求");
  if (typeof api === "string") {
    console.log(`   ${api}`);
    if (!api.startsWith("未配置")) problems.push(`302 接口不可达：${api}`);
  } else {
    console.log(`   HTTP ${api.status} · ${api.ms}ms`);
    if (api.ms > SLOW_REQUEST_MS) {
      problems.push(
        `302 空请求耗时 ${api.ms}ms：图生图要上传数 MB，这个速度下断流概率很高`
      );
    }
  }

  console.log("");
  if (problems.length === 0) {
    console.log("✅ 链路正常，可以放心出图。");
    return;
  }
  console.log("⚠️  发现以下问题，出图失败很可能与代码无关：");
  for (const p of problems) console.log(`   · ${p}`);
  console.log(
    "\n如果看到 fake-IP：在代理规则里给 302.ai 加直连，例如 DOMAIN-SUFFIX,302.ai,DIRECT"
  );
  process.exitCode = 1;
}

void main();
