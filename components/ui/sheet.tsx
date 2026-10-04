"use client";
import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = D.Root;
const SheetTrigger = D.Trigger;
const SheetClose = D.Close;

function SheetContent({
  className,
  children,
  side = "bottom",
  title,
  ...props
}: React.ComponentProps<typeof D.Content> & { side?: "bottom" | "left" | "right"; title: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-card p-5 shadow-xl outline-none",
          side === "bottom" && "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]",
          side === "left" && "inset-y-0 left-0 h-full w-80 max-w-[85vw] border-r",
          side === "right" && "inset-y-0 right-0 h-full w-80 max-w-[85vw] border-l",
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-between">
          <D.Title className="text-base font-semibold">{title}</D.Title>
          <D.Close className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <D.Description className="sr-only">{title}</D.Description>
        {children}
      </D.Content>
    </D.Portal>
  );
}

export { Sheet, SheetTrigger, SheetContent, SheetClose };
