/**
 * 微信小程序运行时的最小类型声明。
 *
 * 刻意不引 `miniprogram-api-typings` npm 包：本轮不允许改根 package.json，
 * 也不需要全量 API。这里只声明本工程真正调用的窄接口；身份与网络 API
 * （login/request/uploadFile/downloadFile/connectSocket）虽然声明了，
 * 但 U1–U3 的应用代码一次都不调用，由 tests/noRealWechatCalls.test.ts 断言。
 */

declare namespace WechatMini {
  type StorageValue = string | number | boolean | object | null;

  interface StorageInfo {
    keys: string[];
    currentSize: number;
    limitSize: number;
  }

  interface AccountInfo {
    miniProgram: {
      appId: string;
      envVersion?: "develop" | "trial" | "release";
      version?: string;
    };
  }

  interface WindowInfo {
    windowWidth: number;
    windowHeight: number;
    safeArea?: {
      top: number;
      bottom: number;
      left: number;
      right: number;
      height: number;
      width: number;
    };
  }

  interface ToastOptions {
    title: string;
    icon?: "success" | "error" | "loading" | "none";
    duration?: number;
  }

  interface ModalOptions {
    title?: string;
    content?: string;
    showCancel?: boolean;
    cancelText?: string;
    confirmText?: string;
    success?: (result: { confirm: boolean; cancel: boolean }) => void;
  }

  interface NavigateOptions {
    url: string;
    success?: () => void;
    fail?: (error: { errMsg: string }) => void;
  }

  interface ClipboardOptions {
    data: string;
    success?: () => void;
    fail?: (error: { errMsg: string }) => void;
  }

  interface Wx {
    getStorageSync(key: string): StorageValue;
    setStorageSync(key: string, data: StorageValue): void;
    removeStorageSync(key: string): void;
    getStorageInfoSync(): StorageInfo;
    getAccountInfoSync(): AccountInfo;
    getWindowInfo(): WindowInfo;
    showToast(options: ToastOptions): void;
    showModal(options: ModalOptions): void;
    navigateTo(options: NavigateOptions): void;
    redirectTo(options: NavigateOptions): void;
    navigateBack(options?: { delta?: number }): void;
    setClipboardData(options: ClipboardOptions): void;
    nextTick(callback: () => void): void;
    // ↓ 身份与网络能力：U1–U3 只声明不调用。
    login(options: unknown): void;
    request(options: unknown): void;
    uploadFile(options: unknown): void;
    downloadFile(options: unknown): void;
    connectSocket(options: unknown): void;
  }

  interface PageInstance<TData> {
    data: TData;
    setData(patch: Partial<TData> | Record<string, unknown>): void;
    route?: string;
  }

  type PageOptions<TData, TCustom> = {
    data?: TData;
    onLoad?(query: Record<string, string | undefined>): void;
    onShow?(): void;
    onHide?(): void;
    onUnload?(): void;
    onReady?(): void;
  } & TCustom &
    ThisType<PageInstance<TData> & TCustom>;

  type AppOptions<TCustom> = {
    onLaunch?(): void;
    onShow?(): void;
    onHide?(): void;
  } & TCustom &
    ThisType<TCustom>;
}

declare const wx: WechatMini.Wx;

declare function App<TCustom extends Record<string, unknown>>(
  options: WechatMini.AppOptions<TCustom>,
): void;

declare function Page<
  TData extends Record<string, unknown>,
  TCustom extends Record<string, unknown>,
>(options: WechatMini.PageOptions<TData, TCustom>): void;

declare function getApp<TCustom = Record<string, unknown>>(): TCustom;

declare function getCurrentPages(): Array<WechatMini.PageInstance<never>>;
