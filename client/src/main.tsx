import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    console.error("[API Mutation Error]", error);
  }
});

const httpLinkOptions = {
  url: "/api/trpc",
  transformer: superjson,
  fetch(input: URL | RequestInfo, init?: RequestInit) {
    return globalThis.fetch(input, {
      ...(init ?? {}),
      credentials: "include",
    });
  },
};

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: op => op.type === "mutation",
      // 变更请求单发，不合批。服务端 101 个 mutation 覆盖了全部 LLM 调用
      // （chat / riff / transcribe / generate* / analyze* …），单次几十秒是常态。
      // 合批的话整批要等最慢的那个一起返回，一个慢生成会把同批里的轻量操作全拖住，
      // 界面表现就是"点哪都在转圈"。
      true: httpLink(httpLinkOptions),
      // 读取请求继续合批：27 个 query 多在进页面时同时发出，合批能明显少几轮往返。
      false: httpBatchLink(httpLinkOptions),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
