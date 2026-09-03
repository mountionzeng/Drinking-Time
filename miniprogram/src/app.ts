import {
  describeRuntimeMode,
  LIVE_API_ORIGIN,
  LIVE_BACKEND_CONFIGURED,
  REQUESTED_RUNTIME_MODE,
  readMiniProgramAppId,
  resolveRuntimeMode,
  type RuntimeMode,
  type RuntimeModeDescription,
} from "./core/runtimeMode";
import { createWorkspaceStore, type WorkspaceStore } from "./core/workspaceState";
import { DEMO_RECOVERY_SCOPE } from "./services/mockTransport";
import { selectWorkspaceTransport } from "./services/runtimeTransport";
import { createWxStorage, type MiniProgramStorage } from "./services/storage";
import type { WorkspaceTransport } from "./services/transport";

export type WorkspaceGlobalData = {
  runtimeMode: RuntimeMode;
  runtimeDescription: RuntimeModeDescription;
  storage: MiniProgramStorage;
  transport: WorkspaceTransport;
  store: WorkspaceStore;
};

export type WorkspaceApp = {
  globalData: WorkspaceGlobalData;
};

const runtimeMode = resolveRuntimeMode({
  appId: readMiniProgramAppId(() => wx.getAccountInfoSync()),
  requestedMode: REQUESTED_RUNTIME_MODE,
  liveBackendConfigured: LIVE_BACKEND_CONFIGURED,
  apiOrigin: LIVE_API_ORIGIN,
});

const storage = createWxStorage();
// U1 只有显式 mock 与零数据 blocked transport。真正 live transport 属于 U6；
// 在它实现前，任何 live 构建都会响亮失败，绝不拿演示数据代替。
const transport = selectWorkspaceTransport(runtimeMode);

App<WorkspaceApp>({
  globalData: {
    runtimeMode,
    runtimeDescription: describeRuntimeMode(runtimeMode),
    storage,
    transport,
    store: createWorkspaceStore({
      scope: DEMO_RECOVERY_SCOPE,
      runtimeMode,
      transport,
      storage,
    }),
  },
});

export function workspaceApp(): WorkspaceApp {
  return getApp<WorkspaceApp>();
}
