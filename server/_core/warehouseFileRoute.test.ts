import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ owner: vi.fn(), read: vi.fn() }));
vi.mock("./mediaRouteAuth", () => ({ resolveMediaRouteUserId: m.owner }));
vi.mock("../services/warehouseFiles", () => ({
  readWarehouseOriginal: m.read,
}));
import { downloadWarehouseFile } from "./warehouseFileRoute";
function response() {
  return {
    setHeader: vi.fn(),
    type: vi.fn(),
    send: vi.fn(),
    sendStatus: vi.fn(),
  };
}
it("requires authentication and positive IDs before reading files", async () => {
  const res = response();
  m.owner.mockResolvedValue(null);
  await downloadWarehouseFile(
    { params: { storyId: "1", fileId: "2" } } as any,
    res as any
  );
  expect(res.sendStatus).toHaveBeenCalledWith(401);
  m.owner.mockResolvedValue(4);
  await downloadWarehouseFile(
    { params: { storyId: "../1", fileId: "2" } } as any,
    res as any
  );
  expect(res.sendStatus).toHaveBeenCalledWith(404);
  expect(m.read).not.toHaveBeenCalled();
});
it("serves an authenticated attachment, never inline executable HTML", async () => {
  m.owner.mockResolvedValue(4);
  m.read.mockResolvedValue({
    file: { name: "点彩.html" },
    bytes: Buffer.from("<script>bad()</script>"),
  });
  const res = response();
  await downloadWarehouseFile(
    { params: { storyId: "1", fileId: "2" } } as any,
    res as any
  );
  expect(m.read).toHaveBeenCalledWith({ storyId: 1, fileId: 2, userId: 4 });
  expect(res.type).toHaveBeenCalledWith("application/octet-stream");
  expect(res.setHeader).toHaveBeenCalledWith(
    "X-Content-Type-Options",
    "nosniff"
  );
  expect(res.setHeader).toHaveBeenCalledWith(
    "Content-Disposition",
    expect.stringContaining("attachment;")
  );
});
