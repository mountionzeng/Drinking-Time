import { ENV } from "../_core/env";

export type AlmanacProvider = "tianapi" | "jisu";
export type AlmanacStatus = "ok" | "partial" | "unconfigured" | "unavailable";

export interface AlmanacDirection {
  name: string;
  value: string;
}

export interface AlmanacHour {
  label: string;
  value: string;
}

export interface AlmanacMeta {
  lunarDate?: string | null;
  lunarMonth?: string | null;
  lunarDay?: string | null;
  ganzhiDay?: string | null;
  ganzhiMonth?: string | null;
  ganzhiYear?: string | null;
  zodiac?: string | null;
  solarTerm?: string | null;
  clash?: string | null;
  sha?: string | null;
  fetalGod?: string | null;
  pengzu?: string | null;
  fiveElements?: string | null;
  star?: string | null;
  dayOfficer?: string | null;
  festival?: string | null;
}

export interface AlmanacDay {
  date: string;
  provider: AlmanacProvider;
  sourceLabel: string;
  status: AlmanacStatus;
  message: string | null;
  yi: string[];
  ji: string[];
  luckyHours: AlmanacHour[];
  directions: AlmanacDirection[];
  meta: AlmanacMeta;
  fetchedAt: string | null;
}

interface AlmanacConfig {
  provider?: string;
  apiKey?: string;
  tianapiKey?: string;
  jisuapiAppKey?: string;
  baseUrl?: string;
  timeoutMs?: number | string;
  cacheTtlMs?: number;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

interface GetAlmanacOptions {
  config?: AlmanacConfig;
  fetcher?: Fetcher;
  now?: Date;
}

interface CacheEntry {
  expiresAt: number;
  value: AlmanacDay;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;

const PROVIDER_LABELS: Record<AlmanacProvider, string> = {
  tianapi: "天行数据老黄历",
  jisu: "极速数据黄历",
};

export function clearAlmanacCache() {
  cache.clear();
}

export async function getAlmanacDay(
  date: string,
  options: GetAlmanacOptions = {},
): Promise<AlmanacDay> {
  if (!isDateString(date)) {
    return unavailableDay(date, resolveProvider(options.config), "日期格式无效");
  }

  const config = resolveConfig(options.config);
  const cacheKey = `${config.provider}:${date}:${config.apiKey ? "configured" : "empty"}`;
  const now = options.now ?? new Date();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now.getTime()) return cached.value;

  const result = await fetchAlmanacDay(date, config, options.fetcher);
  cache.set(cacheKey, {
    value: result,
    expiresAt: now.getTime() + config.cacheTtlMs,
  });
  return result;
}

function resolveConfig(config: AlmanacConfig = {}) {
  const provider = resolveProvider(config);
  const timeoutMs = Number(config.timeoutMs ?? ENV.huangliTimeoutMs) || DEFAULT_TIMEOUT_MS;
  const apiKey =
    config.apiKey ??
    (provider === "jisu"
      ? config.jisuapiAppKey ?? ENV.jisuapiAppKey ?? ENV.huangliApiKey
      : config.tianapiKey ?? ENV.tianapiKey ?? ENV.huangliApiKey);

  return {
    provider,
    apiKey: apiKey.trim(),
    baseUrl: config.baseUrl?.trim() || ENV.huangliApiBaseUrl.trim(),
    timeoutMs,
    cacheTtlMs: config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
  };
}

function resolveProvider(config: AlmanacConfig = {}): AlmanacProvider {
  const raw = (config.provider || ENV.huangliProvider || "").trim().toLowerCase();
  if (raw === "jisu" || raw === "jisuapi") return "jisu";
  if (raw === "tianapi" || raw === "tian") return "tianapi";
  if ((config.jisuapiAppKey ?? ENV.jisuapiAppKey).trim()) return "jisu";
  return "tianapi";
}

async function fetchAlmanacDay(
  date: string,
  config: ReturnType<typeof resolveConfig>,
  fetcher: Fetcher = globalThis.fetch as Fetcher,
) {
  if (!config.apiKey) {
    return unavailableDay(date, config.provider, "老黄历 API key 未配置", "unconfigured");
  }

  try {
    const url = buildProviderUrl(date, config);
    const json = await fetchJson(url, fetcher, config.timeoutMs);
    return normalizeProviderResponse(date, config.provider, json);
  } catch (error) {
    return unavailableDay(
      date,
      config.provider,
      error instanceof Error ? error.message : "老黄历 API 请求失败",
    );
  }
}

function buildProviderUrl(date: string, config: ReturnType<typeof resolveConfig>) {
  if (config.provider === "jisu") {
    const [year, month, day] = date.split("-");
    const url = new URL(config.baseUrl || "https://api.jisuapi.com/huangli/date");
    url.searchParams.set("appkey", config.apiKey);
    url.searchParams.set("year", String(Number(year)));
    url.searchParams.set("month", String(Number(month)));
    url.searchParams.set("day", String(Number(day)));
    return url.toString();
  }

  const url = new URL(config.baseUrl || "https://apis.tianapi.com/lunar/index");
  url.searchParams.set("key", config.apiKey);
  url.searchParams.set("date", date);
  url.searchParams.set("type", "0");
  return url.toString();
}

async function fetchJson(url: string, fetcher: Fetcher, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`老黄历 API HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("老黄历 API 请求超时");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeProviderResponse(
  date: string,
  provider: AlmanacProvider,
  payload: unknown,
): AlmanacDay {
  if (!isRecord(payload)) {
    return unavailableDay(date, provider, "老黄历 API 返回格式无效");
  }

  const code = payload.code ?? payload.status;
  const ok =
    provider === "tianapi"
      ? code === 200 || code === "200"
      : code === 0 || code === "0";

  if (!ok) {
    const message = stringValue(payload.msg) || stringValue(payload.message) || "老黄历 API 返回失败";
    return unavailableDay(date, provider, message);
  }

  const result = isRecord(payload.result) ? payload.result : null;
  if (!result) return unavailableDay(date, provider, "老黄历 API 缺少 result");

  return provider === "jisu"
    ? normalizeJisuResult(date, result)
    : normalizeTianapiResult(date, result);
}

function normalizeTianapiResult(date: string, result: Record<string, unknown>): AlmanacDay {
  const yi = splitList(result.fitness);
  const ji = splitList(result.taboo);
  const directions = parseDirections(result.shenwei);
  const luckyHours = parseLuckyHours(result.jishi ?? result.jishichen ?? result.shichen);
  const meta: AlmanacMeta = compactMeta({
    lunarDate: stringValue(result.lunardate),
    lunarMonth: stringValue(result.lubarmonth) || stringValue(result.lmonthname),
    lunarDay: stringValue(result.lunarday),
    ganzhiDay: stringValue(result.tiangandizhiday),
    ganzhiMonth: stringValue(result.tiangandizhimonth),
    ganzhiYear: stringValue(result.tiangandizhiyear),
    zodiac: stringValue(result.shengxiao),
    solarTerm: stringValue(result.jieqi),
    clash: stringValue(result.chongsha),
    sha: stringValue(result.suisha),
    fetalGod: stringValue(result.taishen),
    pengzu: stringValue(result.pengzu),
    fiveElements: stringValue(result.wuxingjiazi),
    star: stringValue(result.xingsu),
    dayOfficer: stringValue(result.jianshen),
    festival: joinNonEmpty([stringValue(result.festival), stringValue(result.lunar_festival)]),
  });

  return availableDay(date, "tianapi", yi, ji, directions, luckyHours, meta);
}

function normalizeJisuResult(date: string, result: Record<string, unknown>): AlmanacDay {
  const yi = splitList(result.yi);
  const ji = splitList(result.ji);
  const directions = [
    direction("财神", result.caishen),
    direction("喜神", result.xishen),
    direction("福神", result.fushen),
  ].filter((value): value is AlmanacDirection => Boolean(value));
  const luckyHours = parseLuckyHours(result.jishi ?? result.shichen);
  const meta: AlmanacMeta = compactMeta({
    lunarDate: stringValue(result.nongli),
    ganzhiYear: Array.isArray(result.suici) ? stringValue(result.suici[0]) : stringValue(result.suici),
    zodiac: stringValue(result.shengxiao),
    clash: stringValue(result.chong),
    sha: stringValue(result.sha),
    fetalGod: stringValue(result.taishen),
    fiveElements: stringValue(result.wuxing),
    star: stringValue(result.star),
    dayOfficer: joinNonEmpty([stringValue(result.jiri), stringValue(result.zhiri)]),
    festival: stringValue(result.festival),
  });

  return availableDay(date, "jisu", yi, ji, directions, luckyHours, meta);
}

function availableDay(
  date: string,
  provider: AlmanacProvider,
  yi: string[],
  ji: string[],
  directions: AlmanacDirection[],
  luckyHours: AlmanacHour[],
  meta: AlmanacMeta,
): AlmanacDay {
  const hasCore = yi.length > 0 || ji.length > 0;
  const hasAny = hasCore || directions.length > 0 || luckyHours.length > 0 || Object.keys(meta).length > 0;
  return {
    date,
    provider,
    sourceLabel: PROVIDER_LABELS[provider],
    status: hasCore ? "ok" : hasAny ? "partial" : "unavailable",
    message: hasAny ? null : "老黄历 API 未返回可展示字段",
    yi,
    ji,
    luckyHours,
    directions,
    meta,
    fetchedAt: new Date().toISOString(),
  };
}

function unavailableDay(
  date: string,
  provider: AlmanacProvider,
  message: string,
  status: AlmanacStatus = "unavailable",
): AlmanacDay {
  return {
    date,
    provider,
    sourceLabel: PROVIDER_LABELS[provider],
    status,
    message,
    yi: [],
    ji: [],
    luckyHours: [],
    directions: [],
    meta: {},
    fetchedAt: null,
  };
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(splitList);
  }
  const raw = stringValue(value);
  if (!raw) return [];
  return raw
    .split(/[.。；;、,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDirections(value: unknown): AlmanacDirection[] {
  const raw = stringValue(value);
  if (!raw) return [];
  const directions: AlmanacDirection[] = [];
  const pattern = /(喜神|福神|财神|阳贵|阴贵)[:：]\s*([^\s,，、]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) {
    directions.push({ name: match[1], value: match[2] });
  }
  return directions;
}

function parseLuckyHours(value: unknown): AlmanacHour[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (isRecord(item)) {
          const label =
            stringValue(item.label) ||
            stringValue(item.name) ||
            stringValue(item.hour) ||
            stringValue(item.time);
          const detail =
            stringValue(item.value) ||
            stringValue(item.desc) ||
            stringValue(item.description) ||
            stringValue(item.luck);
          if (!label && !detail) return null;
          return { label: label || "吉时", value: detail || label };
        }
        const text = stringValue(item);
        return text ? parseLuckyHourText(text) : null;
      })
      .filter((item): item is AlmanacHour => Boolean(item));
  }
  const raw = stringValue(value);
  if (!raw) return [];
  return raw
    .split(/[;；、]+/)
    .map(parseLuckyHourText)
    .filter((item): item is AlmanacHour => Boolean(item));
}

function parseLuckyHourText(text: string): AlmanacHour | null {
  const raw = text.trim();
  if (!raw) return null;
  const [label, ...rest] = raw.split(/[:：]/);
  return {
    label: label.trim() || "吉时",
    value: rest.join("：").trim() || raw,
  };
}

function direction(name: string, value: unknown): AlmanacDirection | null {
  const text = stringValue(value);
  return text ? { name, value: text } : null;
}

function compactMeta(meta: AlmanacMeta): AlmanacMeta {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== null && value !== undefined && value !== ""),
  ) as AlmanacMeta;
}

function joinNonEmpty(values: Array<string | null>) {
  const joined = values.filter(Boolean).join(" · ");
  return joined || null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number") return String(value);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
