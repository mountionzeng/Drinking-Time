import { afterEach, expect, it, vi } from "vitest";
import {
  OPEN_MEMORY_WAREHOUSE,
  openMemoryWarehouse,
} from "./memoryWarehouseEvents";
afterEach(() => vi.unstubAllGlobals());
it.each(["story", "account"] as const)(
  "explicitly requests the %s scope",
  scope => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const received = vi.fn();
    target.addEventListener(OPEN_MEMORY_WAREHOUSE, event =>
      received((event as CustomEvent).detail)
    );
    openMemoryWarehouse(scope);
    expect(received).toHaveBeenCalledWith({ scope });
  }
);
