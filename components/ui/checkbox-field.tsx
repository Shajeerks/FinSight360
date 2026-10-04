import * as React from "react";
import { cn } from "@/lib/utils";

/** Large, touch-friendly native checkbox with label + hint. */
export const CheckboxField = React.forwardRef<HTMLInputElement, React.ComponentProps<"input"> & { label: string; hint?: string }>(
  function CheckboxField({ label, hint, className, id, ...props }, ref) {
    return (
      <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm", className)}>
        <input ref={ref} id={id} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" {...props} />
        <span>
          <span className="font-medium">{label}</span>
          {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
        </span>
      </label>
    );
  },
);
