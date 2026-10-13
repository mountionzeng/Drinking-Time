import { useUiText } from "@/features/uiLanguage/UiLanguage";
/** Compact header navigation shared by all six mobile appearances. */
import React from "react";
import { ArrowLeft, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MobilePage } from "./liaoliaoForms";

export function MobileNavBar({
  current,
  onNavigate,
}: {
  current: MobilePage;
  onNavigate: (page: MobilePage) => void;
}) {
  const t = useUiText();

  const back = current === "me";
  const Icon = back ? ArrowLeft : UserRound;
  return (
    <nav aria-label={t("手机工作区")}>
      <Button
        type="button"
        variant="outline"
        size={back ? "default" : "icon"}
        aria-label={back ? t("返回故事") : t("我")}
        className={
          back
            ? "min-h-11 rounded-xl"
            : "size-12 rounded-full text-primary shadow-none active:scale-95 motion-reduce:transform-none"
        }
        style={
          back
            ? undefined
            : {
                backgroundColor:
                  "color-mix(in oklab, var(--primary) 10%, transparent)",
                borderColor:
                  "color-mix(in oklab, var(--primary) 24%, transparent)",
                color:
                  "color-mix(in oklab, var(--primary) 85%, var(--foreground))",
              }
        }
        onClick={() => onNavigate(back ? "stories" : "me")}
      >
        <Icon
          aria-hidden="true"
          className={back ? "size-4" : "size-[23px]"}
          strokeWidth={back ? 2 : 1.5}
        />
        {back ? t("返回故事") : null}
      </Button>
    </nav>
  );
}
