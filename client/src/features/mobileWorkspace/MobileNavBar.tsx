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
  const back = current === "me";
  const Icon = back ? ArrowLeft : UserRound;
  return (
    <nav aria-label="手机工作区">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 rounded-xl"
        onClick={() => onNavigate(back ? "stories" : "me")}
      >
        <Icon aria-hidden="true" />
        {back ? "返回故事" : "我"}
      </Button>
    </nav>
  );
}
