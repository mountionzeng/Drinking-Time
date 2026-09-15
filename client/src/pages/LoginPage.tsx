import { useState } from "react";
import AuthEntryPanel from "@/features/auth/views/AuthEntryPanel";
import { readMobileReturnPath } from "@/features/auth/mobileReturnPath";
import { useNayin } from "@/features/nayin/NayinContext";
import { formatTodayIdentity } from "@/features/nayin/dailyPresentation";
import DailyDrinkHero from "@/features/nayin/views/DailyDrinkHero";
import BeverageAmbience from "@/features/nayin/views/BeverageAmbience";
import WuxingParticles from "@/features/nayin/views/WuxingParticles";
import { WuxingPourContent } from "@/features/nayin/views/WuxingPourReveal";

export default function LoginPage() {
  const [method, setMethod] = useState<"email" | "wechat">("email");
  const [aboutOpen, setAboutOpen] = useState(false);
  const { today, visualTheme } = useNayin();
  const returnPath =
    typeof window === "undefined"
      ? null
      : readMobileReturnPath(window.location.search);

  if (visualTheme === "nayin") {
    return (
      <div className="relative min-h-dvh bg-background text-foreground">
        <BeverageAmbience />
        <WuxingParticles />
        <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center gap-7 px-4 py-6 sm:px-6 sm:py-8 lg:gap-10 lg:px-8">
          <header className="flex w-full justify-center" aria-label="今日标识">
            <DailyDrinkHero
              today={today}
              compact
              brandName="拾光"
              pour={{
                open: aboutOpen,
                onToggle: () => setAboutOpen(open => !open),
                contentId: "about-shiguang",
              }}
            />
          </header>
          <WuxingPourContent
            element={today.element}
            open={aboutOpen}
            contentId="about-shiguang"
          >
            <div className="space-y-2.5 text-left">
              <p className="text-sm leading-relaxed text-foreground">
                在拾光，和聊聊说起一段经历。
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                那些舍不得忘记的回忆，会慢慢变成可以看见的故事和画面。
              </p>
            </div>
          </WuxingPourContent>
          <div className="flex w-full max-w-5xl items-center gap-4">
            <span
              className="h-px flex-1"
              style={{ background: "var(--nayin-border)" }}
            />
            <p className="text-center font-mono text-[11px] text-muted-foreground/80">
              {formatTodayIdentity(today)}
            </p>
            <span
              className="h-px flex-1"
              style={{ background: "var(--nayin-border)" }}
            />
          </div>
          <div className="w-full max-w-sm pb-8">
            <LoginMethodTabs method={method} onChange={setMethod} />
            {method === "email" ? (
              <AuthEntryPanel returnPath={returnPath} variant="email" />
            ) : (
              <AuthEntryPanel returnPath={returnPath} variant="pairing" />
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="shiguang-login-page relative min-h-dvh bg-background text-foreground">
      <main className="shiguang-login-shell relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header
          className="shiguang-login-hero flex w-full justify-center"
          aria-label="拾光家忆"
        >
          <div className="shiguang-login-brand text-center">
            <h1 className="shiguang-login-title">拾光</h1>
          </div>
        </header>

        <section
          className="shiguang-login-card relative mt-8 w-full max-w-md px-5 pb-7 pt-5 sm:mt-10 sm:px-8 sm:pb-9 sm:pt-6"
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

function LoginMethodTabs({
  method,
  onChange,
}: {
  method: "email" | "wechat";
  onChange: (method: "email" | "wechat") => void;
}) {
  return (
    <nav
      aria-label="登录方式"
      className="mb-8 grid grid-cols-2 border-b border-border"
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
          onClick={() => onChange(value)}
          className={`border-b-2 px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${method === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
