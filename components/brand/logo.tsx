import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8", className)}>
      <defs>
        <linearGradient id="fs-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#fs-g)" />
      <path d="M16 44V30m10 14V22m10 22V34m10 10V16" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      {showText && (
        <span className="text-lg font-semibold tracking-tight">
          FinSight<span className="text-primary">360</span>
        </span>
      )}
    </span>
  );
}
