export function normalizeShotNo(value: string | number | null | undefined): string {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";

  const numeric = /^0*(\d+)$/.exec(raw);
  if (numeric) return `SH${numeric[1].padStart(2, "0")}`;

  const prefixed = /^SH0*(\d+)$/.exec(raw);
  if (prefixed) return `SH${prefixed[1].padStart(2, "0")}`;

  return raw;
}

export function isSameShotNo(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): boolean {
  const normalizedLeft = normalizeShotNo(left);
  const normalizedRight = normalizeShotNo(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}
