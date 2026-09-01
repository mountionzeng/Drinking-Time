import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";
import { clearMobileRecoveryForUser } from "@/features/mobileWorkspace/mobileRecoveryIdentity";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const resolvedRedirectPath = useMemo(() => {
    if (redirectPath) return redirectPath;
    if (!redirectOnUnauthenticated) return "";
    if (typeof window === "undefined") return "";
    return getLoginUrl();
  }, [redirectPath, redirectOnUnauthenticated]);
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  /**
   * 用途：身份发生变化（访客 → 正式账号）后，先清空整个 react-query 缓存再重取
   *   `auth.me`。清空是必须的：邀请码登录成功后走的是 wouter 的 SPA 跳转
   *   （AuthEntryPanel 里的 `navigate("/editing")`），JS 堆不会销毁，访客期间
   *   缓存的 story、镜头、情绪数据会原样留在缓存里被新身份读到。登出路径靠
   *   `window.location.href` 整页跳转天然不受影响，但登录路径不行。
   * 调用入口：client/src/features/auth/views/AuthEntryPanel.tsx 邀请码登录成功后。
   * 下游调用：queryClient.clear()；auth.me 的 refetch。
   */
  const refreshAfterIdentityChange = useCallback(async () => {
    queryClient.clear();
    return meQuery.refetch();
  }, [queryClient, meQuery]);

  const logout = useCallback(async () => {
    const currentUserId = meQuery.data?.id;
    if (typeof currentUserId === "number" && typeof window !== "undefined") {
      try {
        clearMobileRecoveryForUser(window.localStorage, currentUserId);
      } catch {
        // Storage denial must not block explicit logout.
      }
    }
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, meQuery.data?.id, utils]);

  const state = useMemo(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          "manus-runtime-user-info",
          JSON.stringify(meQuery.data)
        );
      } catch {
        // Authentication must remain usable when browser storage is denied.
      }
    }
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (!resolvedRedirectPath) return;
    if (window.location.pathname === resolvedRedirectPath) return;

    window.location.href = resolvedRedirectPath
  }, [
    redirectOnUnauthenticated,
    resolvedRedirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: refreshAfterIdentityChange,
    logout,
  };
}
