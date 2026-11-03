import type { Plugin, PluginOption } from "vite";

/**
 * vite-plugin-manus-runtime 会在 index.html <body> 里注入一段 inline
 * <script id="manus-runtime">。生产 CSP 是 `script-src 'self'`，这段脚本
 * 在线上必被拦截并刷控制台错误；生产也不依赖 window.__MANUS_*（只有
 * useAuth 往 localStorage 写 manus-runtime-user-info，属于单向输出）。
 * 所以只在 dev server 里启用。
 */
export function shouldInjectManusRuntime(command: "serve" | "build"): boolean {
  return command === "serve";
}

export function manusRuntimePlugins(
  command: "serve" | "build",
  create: () => Plugin | PluginOption
): PluginOption[] {
  return shouldInjectManusRuntime(command) ? [create()] : [];
}
