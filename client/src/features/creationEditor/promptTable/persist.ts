import type { PromptOverride } from './types';

function bodyObject(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>) }
    : {};
}

function shotNoOf(raw: unknown, fallback: number): number {
  if (!raw || typeof raw !== 'object') return fallback;
  const value = (raw as Record<string, unknown>).shotNo;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = /(\d+)/.exec(value);
    if (match) return Number(match[1]);
  }
  return fallback;
}

function shotArray(body: Record<string, unknown>) {
  const shots = body.shots;
  return Array.isArray(shots) ? shots : [];
}

function updateShot(
  body: unknown,
  shotNo: number,
  updater: (shot: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const nextBody = bodyObject(body);
  const shots = shotArray(nextBody);
  let found = false;
  const nextShots = shots.map((raw, index) => {
    const shot = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : { shotNo: index + 1 };
    if (shotNoOf(shot, index + 1) !== shotNo) return shot;
    found = true;
    return updater(shot);
  });

  if (!found) {
    nextShots.push(updater({ shotNo }));
  }

  return {
    ...nextBody,
    shots: nextShots,
  };
}

export function writeShotDuration(
  body: unknown,
  shotNo: number,
  durationMs: number,
): Record<string, unknown> {
  return updateShot(body, shotNo, (shot) => ({
    ...shot,
    durationMs,
  }));
}

export function writePromptOverride(
  body: unknown,
  shotNo: number,
  dimension: string,
  override: PromptOverride,
): Record<string, unknown> {
  return updateShot(body, shotNo, (shot) => {
    const existing = shot.promptOverrides && typeof shot.promptOverrides === 'object' && !Array.isArray(shot.promptOverrides)
      ? { ...(shot.promptOverrides as Record<string, unknown>) }
      : {};
    existing[dimension] = {
      ...(existing[dimension] && typeof existing[dimension] === 'object' && !Array.isArray(existing[dimension])
        ? existing[dimension] as Record<string, unknown>
        : {}),
      ...override,
    };
    return {
      ...shot,
      promptOverrides: existing,
    };
  });
}
