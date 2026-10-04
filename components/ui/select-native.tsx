import * as React from "react";
import { cn } from "@/lib/utils";

/** Native <select> — best UX on iPhone (system picker) and fully accessible. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-11 w-full rounded-lg border border-input bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 md:h-10 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
