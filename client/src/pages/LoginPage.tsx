import { useState } from "react";
import AuthEntryPanel from "@/features/auth/views/AuthEntryPanel";
import { readMobileReturnPath } from "@/features/auth/mobileReturnPath";
import { useNayin } from "@/features/nayin/NayinContext";
import { formatTodayIdentity } from "@/features/nayin/dailyPresentation";

export default function LoginPage() {
  const [method, setMethod] = useState<"email" | "wechat">("email");
  const { today } = useNayin();
  const returnPath =
    typeof window === "undefined"
      ? null
      : readMobileReturnPath(window.location.search);

  return (
    <div className="shiguang-login-page relative min-h-dvh bg-background text-foreground">
      <main className="shiguang-login-shell relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header
          className="shiguang-login-hero flex w-full justify-center"
          aria-label="拾光家忆"
        >
          <div className="shiguang-login-brand text-center">
            <img
              src="/shiguang/mobile-avatar.png"
              alt=""
              aria-hidden="true"
              className="shiguang-login-mark"
            />
            <p className="shiguang-login-brand-en" aria-hidden="true">
              SHIGUANG JIAYI
            </p>
            <h1 className="shiguang-login-title">拾光</h1>
            <p className="shiguang-login-subtitle">
              让珍藏的故事，在这里继续生长
            </p>
          </div>
        </header>

        <div className="shiguang-login-date mt-6 flex w-full items-center gap-4 sm:mt-8">
          <span className="h-px flex-1 bg-border" />
          <p className="text-center font-mono text-[10px] tracking-[0.08em] text-muted-foreground/75">
            {formatTodayIdentity(today)}
          </p>
          <span className="h-px flex-1 bg-border" />
        </div>

        <section
          className="shiguang-login-card relative mt-6 w-full max-w-md px-5 pb-7 pt-5 sm:mt-8 sm:px-8 sm:pb-9 sm:pt-6"
          aria-label="登录拾光"
        >
          <p className="mb-3 text-center text-[10px] tracking-[0.28em] text-muted-foreground">
            把故事带回这一页
          </p>
          <nav
            aria-label="登录方式"
            className="shiguang-login-tabs mb-7 grid grid-cols-2"
          >
            {(
              [
                ["email", "邮箱登录"],
                ["wechat", "微信登录"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-current={method === value ? "page" : undefined}
                onClick={() => setMethod(value)}
                className={`shiguang-login-tab px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${method === value ? "is-active text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </nav>

          {method === "email" ? (
            <AuthEntryPanel returnPath={returnPath} variant="email" />
          ) : (
            <AuthEntryPanel returnPath={returnPath} variant="pairing" />
          )}
        </section>
      </main>
    </div>
  );
}
