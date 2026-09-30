/**
 * 「找不到的路径该不该回 index.html」这一个判断。
 *
 * 单页应用需要把 /editing、/stories/12 这类前端路由都回同一份 HTML。但这个兜底
 * 不能盖到**资源请求**上：浏览器按 `<script type="module">` 去取一个已经不存在的
 * JS，如果服务端回一份 HTML，浏览器按 HTML 规范拒绝执行（MIME 不符），整个应用
 * 就停在空白页上，控制台里只留一句看不出因果的 MIME 报错。
 *
 * 这不是假设：Vite 重新预构建（装包、改依赖、重启 dev server）之后，
 * 早就打开着的标签页手里还攥着旧的 `/node_modules/.vite/deps/xxx.js?v=<旧哈希>`
 * 地址。那个文件已经没了，兜底把它变成 HTML，页面就白了。
 * 回一个老实的 404，浏览器才会报「加载失败」，配合 index.html 里的自愈脚本
 * 能自己刷回来。
 */

/** 明确属于「资源」的扩展名。前端路由里不会出现这些后缀。 */
const ASSET_EXTENSION =
  /\.(?:[cm]?[jt]sx?|css|json|map|wasm|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp[34]|m4a|wav|ogg|webm|mov|pdf|txt|xml|zip)$/i;

/** 浏览器明说这次是去取资源而不是跳页面。 */
const ASSET_FETCH_DEST = new Set([
  "script",
  "style",
  "font",
  "image",
  "audio",
  "video",
  "track",
  "worker",
  "sharedworker",
  "serviceworker",
  "manifest",
  "json",
  "xslt",
  "embed",
  "object",
  "report",
]);

export type SpaFallbackRequest = {
  /** 只看路径部分即可，查询串（?v=…）不参与判断。 */
  path: string;
  headers?: {
    accept?: string;
    secFetchDest?: string;
    secFetchMode?: string;
  };
};

function pathnameOf(raw: string): string {
  const withoutHash = raw.split("#")[0] ?? "";
  return withoutHash.split("?")[0] ?? "";
}

/**
 * 用途：判断这条落到兜底的请求该回 HTML 外壳，还是该老实回 404。
 * 调用入口：server/_core/vite.ts 的 setupVite / serveStatic 兜底中间件。
 * 下游调用：无副作用的纯判断，不读文件不发响应。
 */
export function shouldServeSpaShell(request: SpaFallbackRequest): boolean {
  const pathname = pathnameOf(request.path);
  const dest = request.headers?.secFetchDest?.toLowerCase().trim();

  // 浏览器自己说了这是取资源，信它。
  if (dest && ASSET_FETCH_DEST.has(dest)) return false;
  // 明确是跳转页面，即使路径里带点也给 HTML。
  if (dest === "document" || dest === "iframe" || dest === "frame") return true;
  if (request.headers?.secFetchMode?.toLowerCase().trim() === "navigate") {
    return true;
  }

  // Vite 的内部地址一律不是页面。
  if (
    pathname.startsWith("/@vite/") ||
    pathname.startsWith("/@fs/") ||
    pathname.startsWith("/@id/") ||
    pathname.startsWith("/@react-refresh") ||
    pathname.startsWith("/node_modules/")
  ) {
    return false;
  }

  if (ASSET_EXTENSION.test(pathname)) return false;

  // 老浏览器没有 Sec-Fetch-*：只在客户端明确只要 HTML 或者什么都收时给外壳。
  const accept = request.headers?.accept?.toLowerCase() ?? "";
  if (accept && !accept.includes("text/html") && !accept.includes("*/*")) {
    return false;
  }

  return true;
}
