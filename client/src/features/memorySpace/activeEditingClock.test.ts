import { describe, expect, it } from "vitest";
import { ActiveEditingClock } from "./activeEditingClock";
describe("活跃编辑计时", () => {
  it("does not count passive reading and stops after thirty seconds idle", () => {
    const c = new ActiveEditingClock(0);
    expect(c.sample(100_000, true)).toBe(0);
    c.interact(100_000);
    expect(c.sample(110_000, true)).toBe(10_000);
    expect(c.sample(500_000, true)).toBe(30_000);
    c.interact(500_000);
    expect(c.sample(510_000, true)).toBe(40_000);
  });
  it("drops background intervals and requires a new interaction on return", () => {
    const c = new ActiveEditingClock(0);
    c.interact(1000);
    expect(c.sample(6000, true)).toBe(5000);
    c.sample(7000, false);
    expect(c.sample(100_000, true)).toBe(5000);
    c.interact(100_000);
    expect(c.sample(105_000, true)).toBe(10_000);
  });
});
