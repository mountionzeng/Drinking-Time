import { ENV } from "../_core/env";
import { estimatedMaskedEditPtc } from "../../shared/imageRenderCost";

/** Optional free preflight. Some render keys cannot read the dashboard. */
export async function checkReviewedImageBalance(
  key = ENV.api302Key,
  base = ENV.api302BaseUrl,
  read: typeof fetch = fetch
): Promise<"sufficient" | "insufficient" | "unavailable"> {
  try {
    const url = new URL("/dashboard/balance", base);
    if (
      !key ||
      ![
        "https://api.302.ai",
        "https://api.302ai.cn",
        "https://api.302ai.com",
      ].includes(url.origin)
    )
      return "unavailable";
    const response = await read(url, {
      headers: { Authorization: "Bearer " + key },
      redirect: "error",
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!response.ok) return "unavailable";
    const raw = (await response.json())?.data?.balance;
    if (typeof raw !== "number" && !(typeof raw === "string" && raw.trim()))
      return "unavailable";
    const balance = Number(raw);
    if (!Number.isFinite(balance)) return "unavailable";
    return balance < estimatedMaskedEditPtc() ? "insufficient" : "sufficient";
  } catch {
    return "unavailable";
  }
}
