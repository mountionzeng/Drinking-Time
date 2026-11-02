import { EventEmitter } from "node:events";
import { expect, it, vi, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), resolve4: vi.fn() }));
vi.mock("node:https", () => ({ default: { get: mocks.get } }));
vi.mock("node:dns", () => ({ default: { resolve4: mocks.resolve4 } }));
import { downloadLegnextImage } from "./legnextImageDownload";
afterEach(() => vi.resetAllMocks());
it("uses A records for the original TLS hostname and returns bytes", async () => {
  mocks.resolve4.mockImplementation((_host, cb) => cb(null, ["104.21.35.49"]));
  const request = new EventEmitter() as any;
  request.destroy = vi.fn();
  mocks.get.mockImplementation((url, options, callback) => {
    expect(url.hostname).toBe("images.sexapi.ai"); expect(options.family).toBe(4);
    const lookup = vi.fn(); options.lookup(url.hostname, {}, lookup); expect(lookup).toHaveBeenCalledWith(null, "104.21.35.49", 4);
    queueMicrotask(() => {
      const response = new EventEmitter() as any; response.statusCode = 200;
      callback(response); response.emit("data", Buffer.from([137,80,78,71])); response.emit("end"); request.emit("close");
    });
    return request;
  });
  expect(await downloadLegnextImage(new URL("https://images.sexapi.ai/test.png"))).toEqual(Buffer.from([137,80,78,71]));
});
it("rejects arbitrary URLs before DNS or network access", async () => {
  await expect(downloadLegnextImage(new URL("http://127.0.0.1/private"))).rejects.toThrow();
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.resolve4).not.toHaveBeenCalled();
});
