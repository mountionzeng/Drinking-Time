import {
  assertRuntimeTransportCompatibility,
  describeRuntimeMode,
  type RuntimeMode,
} from "../core/runtimeMode";
import { createMockTransport } from "./mockTransport";
import {
  createBlockedWorkspaceTransport,
  type WorkspaceTransport,
} from "./transport";

/** 运行模式与 transport 的唯一装配点，禁止 live 失败后静默落回 mock。 */
export function selectWorkspaceTransport(mode: RuntimeMode): WorkspaceTransport {
  let transport: WorkspaceTransport;
  if (mode === "mock") {
    transport = createMockTransport();
  } else if (mode === "configuration-error") {
    transport = createBlockedWorkspaceTransport(describeRuntimeMode(mode).detail);
  } else {
    throw new Error("小程序 live transport 尚未实现，禁止使用 mock 代替。");
  }
  assertRuntimeTransportCompatibility(mode, transport.kind);
  return transport;
}
