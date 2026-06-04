import { describe, expect, it } from "vitest";
import { resolveActiveProjectId } from "./useProjectData";

describe("resolveActiveProjectId", () => {
  const projects = [{ id: 5 }, { id: 3 }];

  it("会话内显式切到较旧项目后不会被服务器默认项目拉回", () => {
    expect(resolveActiveProjectId(3, projects, 5)).toBe(3);
  });

  it("残留或失效项目 id 会回落到服务器最近项目", () => {
    expect(resolveActiveProjectId(99, projects, 5)).toBe(5);
  });

  it("没有会话内选择时使用服务器默认项目", () => {
    expect(resolveActiveProjectId(null, projects, 5)).toBe(5);
  });

  it("服务器默认项目暂不可用时退到列表第一项作为离线缓存兜底", () => {
    expect(resolveActiveProjectId(null, projects, null)).toBe(5);
  });
});
