export type ChatImageLocalEditIntent = {
  rotate180: boolean;
  extractText: boolean;
};

export function parseChatImageLocalEditInstruction(
  instruction: string
): ChatImageLocalEditIntent | null {
  const normalized = instruction.trim().toLowerCase();
  if (!normalized) return null;
  const rotate180 =
    /倒过来|倒置|上下颠倒|旋转\s*180|转\s*180|rotate\s*180/.test(normalized);
  const extractText =
    /提取.{0,6}(文字|文本)|识别.{0,6}(文字|文本)|读出.{0,6}(文字|文本)|\bocr\b/.test(
      normalized
    );
  return rotate180 || extractText ? { rotate180, extractText } : null;
}

export function rotateTimelineImage180(currentRotationDeg: number): number {
  const next = ((currentRotationDeg + 180) % 360 + 360) % 360;
  return next > 180 ? next - 360 : next;
}
