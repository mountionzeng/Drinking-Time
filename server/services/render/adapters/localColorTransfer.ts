/**
 * image.local-color-transfer 的执行器：本机 Lab 调色。
 * 不读环境变量、不调用供应商、不发任何网络请求；出错就把原因交回，不改走其他档位。
 */
import { transferImageColor } from "../../colorTransfer";
import type { LocalColorTransferRenderInput, LocalColorTransferResult } from "../types";

export async function runLocalColorTransfer(input: LocalColorTransferRenderInput): Promise<LocalColorTransferResult> {
  try {
    const result = await transferImageColor(input.referenceBytes, input.targetBytes);
    return { status: "ok", ...result };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "本地调色失败" };
  }
}
