import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { openMemoryWarehouse } from "@/features/memoryWarehouse/memoryWarehouseEvents";
import { MemorySpace } from "./MemorySpace";
export function DesktopMemorySpace({
  onOpenWriting,
  open,
  onOpenChange: setOpen,
}: {
  onOpenWriting: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        id="account-memories"
        className="max-h-[90dvh] w-[94vw] sm:max-w-5xl overflow-y-auto p-6 sm:p-9"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>回忆</DialogTitle>
          <DialogDescription>
            整理故事书架，查看参与创作的人与亲友关系。
          </DialogDescription>
        </DialogHeader>
        {open && (
          <MemorySpace
            onOpenNotes={() => {
              setOpen(false);
              openMemoryWarehouse("account");
            }}
            onOpenStory={storyId => {
              setOpen(false);
              onOpenWriting();
              window.dispatchEvent(
                new CustomEvent("dt:open-story", { detail: { storyId } })
              );
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
