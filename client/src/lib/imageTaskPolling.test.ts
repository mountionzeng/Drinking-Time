import { expect, it } from "vitest";
import { isGatewayTimeoutError, shouldKeepPolling } from "./imageTaskPolling";
it("recognises 504 and HTML replies but not ordinary errors", () => {
  expect(isGatewayTimeoutError(`Unexpected token '<', "<html>" is not valid JSON`)).toBe(true);
  expect(isGatewayTimeoutError("504 Gateway Time-out")).toBe(true);
  expect(isGatewayTimeoutError("余额不足")).toBe(false);
});
it("polls only running tasks and only within the limit", () => {
  expect(shouldKeepPolling("accepted", 0, 60_000)).toBe(true);
  expect(shouldKeepPolling("accepted", 0, 11 * 60_000)).toBe(false);
  expect(shouldKeepPolling("unknown", 0, 1)).toBe(false);
  expect(shouldKeepPolling("succeeded", null)).toBe(false);
});
