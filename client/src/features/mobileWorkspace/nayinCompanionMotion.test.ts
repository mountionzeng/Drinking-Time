import { describe, expect, it } from "vitest";
import {
  NAYIN_COMPANION_MOTION,
  nayinCompanionTravel,
} from "./nayinCompanionMotion";
import type { NayinElement } from "@/features/nayin/nayin";

describe("five companion journeys", () => {
  for (const element of Object.keys(NAYIN_COMPANION_MOTION) as NayinElement[]) {
    it(`${element} lands exactly at the chat and dock, with no residual tilt`, () => {
      const opening = nayinCompanionTravel(element, true, 416, false);
      const closing = nayinCompanionTravel(element, false, 416, false);
      expect((opening.y as number[]).at(-1)).toBe(-416);
      expect((closing.y as number[]).at(-1)).toBe(0);
      for (const motion of [opening, closing]) {
        expect((motion.x as number[]).at(-1)).toBe(0);
        expect((motion.rotate as number[]).at(-1)).toBe(0);
        expect((motion.scale as number[]).at(-1)).toBe(1);
      }
    });
    it(`${element} respects reduced motion while preserving the open position`, () => {
      expect(nayinCompanionTravel(element, true, 416, true)).toMatchObject({
        y: -416,
        rotate: 0,
        transition: { duration: 0 },
      });
      expect(nayinCompanionTravel(element, false, 416, true).y).toBe(0);
    });
  }
});
