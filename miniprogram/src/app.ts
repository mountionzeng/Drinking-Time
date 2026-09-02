import {
  describeRuntimeMode,
  LIVE_BACKEND_CONFIGURED,
  readMiniProgramAppId,
  resolveRuntimeMode,
  type RuntimeMode,
  type RuntimeModeDescription,
} from "./core/runtimeMode";
import { createWorkspaceStore, type WorkspaceStore } from "./core/workspaceState";
import {
  createMockTransport,
  DEMO_RECOVERY_SCOPE,
  type MockTransport,
} from "./services/mockTransport";
import { createWxStorage, type MiniProgramStorage } from "./services/storage";

export type WorkspaceGlobalData = {
  runtimeMode: RuntimeMode;
  runtimeDescription: RuntimeModeDescription;
  storage: MiniProgramStorage;
  transport: MockTransport;
  store: WorkspaceStore;
};

export type WorkspaceApp = {
  globalData: WorkspaceGlobalData;
};

const runtimeMode = resolveRuntimeMode({
  appId: readMiniProgramAppId(() => wx.getAccountInfoSync()),
  liveBackendConfigured: LIVE_BACKEND_CONFIGURED,
});

const storage = createWxStorage();
// U1–U3 只有 mock transport。live transport 属于 U4，仓库里还不存在，
// 因此这里不存在「悄悄回退到真实请求」的可能。
const transport = createMockTransport();

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
