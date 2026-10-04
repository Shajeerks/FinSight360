"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, CheckCheck, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteNotificationAction, markNotificationsReadAction, savePreferencesAction } from "@/features/reminders/actions";
import { cn } from "@/lib/utils";

export type NotificationView = { id: string; title: string; body: string; link: string | null; createdAt: string; read: boolean; type: string };

export function NotificationList({ items }: { items: NotificationView[] }) {
  const [pending, start] = React.useTransition();
  const router = useRouter();
  const unread = items.filter((i) => !i.read).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{unread ? `${unread} unread` : "All caught up"}</p>
        <Button size="sm" variant="ghost" disabled={!unread || pending} onClick={() => start(async () => { await markNotificationsReadAction({ all: true }); router.refresh(); })}>
          {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Mark all read
        </Button>
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {items.map((n) => (
          <li key={n.id} className={cn("flex items-start gap-3 px-4 py-3", !n.read && "bg-primary/5")}>
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} aria-hidden />
            <div className="min-w-0 flex-1">
              {n.link ? (
                <Link
                  href={n.link}
                  className="font-medium hover:underline"
                  onClick={() => { if (!n.read) void markNotificationsReadAction({ ids: [n.id] }); }}
                >
                  {n.title}
                </Link>
              ) : (
                <p className="font-medium">{n.title}</p>
              )}
              <p className="text-sm text-muted-foreground">{n.body}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              {!n.read && (
                <Button size="icon" variant="ghost" className="size-8" aria-label="Mark as read" onClick={() => start(async () => { await markNotificationsReadAction({ ids: [n.id] }); router.refresh(); })}>
                  <CheckCheck />
                </Button>
              )}
              <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" aria-label="Delete notification" onClick={() => start(async () => { await deleteNotificationAction(n.id); router.refresh(); })}>
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Pref = { enabled: boolean; leadDays: number };
type Prefs = Record<string, Record<"IN_APP" | "BROWSER" | "EMAIL", Pref>>;

export function PreferencesForm({ prefs, labels, emailConfigured }: { prefs: Prefs; labels: Record<string, string>; emailConfigured: boolean }) {
  const [state, setState] = React.useState(prefs);
  const [pending, start] = React.useTransition();
  const [permission, setPermission] = React.useState<string>("default");
  React.useEffect(() => {
    // Reading a browser-only API after mount (not available during server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  const toggle = (type: string, ch: "IN_APP" | "BROWSER" | "EMAIL") => setState((s) => ({ ...s, [type]: { ...s[type], [ch]: { ...s[type][ch], enabled: !s[type][ch].enabled } } }));
  const setLead = (type: string, v: string) => setState((s) => ({ ...s, [type]: { ...s[type], IN_APP: { ...s[type].IN_APP, leadDays: Math.max(0, Math.min(30, Number(v) || 0)) } } }));
  const save = () =>
    start(async () => {
      const preferences = Object.entries(state).flatMap(([type, chans]) =>
        (["IN_APP", "BROWSER", "EMAIL"] as const).map((channel) => ({ type, channel, enabled: chans[channel].enabled, leadDays: chans.IN_APP.leadDays })),
      );
      const res = await savePreferencesAction({ preferences });
      if (res.ok) toast.success(res.message ?? "Saved");
      else toast.error(res.error);
    });
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          <strong>Browser notifications:</strong>{" "}
          {permission === "granted" ? "allowed on this device ✓" : permission === "denied" ? "blocked — allow them in your browser's site settings" : permission === "unsupported" ? "not supported by this browser (on iPhone, add FinSight360 to the Home Screen first)" : "not enabled on this device"}
        </p>
        {permission === "default" && (
          <Button size="sm" variant="outline" onClick={async () => {
            const p = await Notification.requestPermission();
            setPermission(p);
            if (p === "granted") new Notification("FinSight360", { body: "Notifications are on for this device.", icon: "/icons/icon-192.png" });
          }}>
            <BellRing /> Allow on this device
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Notify me about</th>
              <th className="px-2 py-2 text-center font-medium">In app</th>
              <th className="px-2 py-2 text-center font-medium">Browser</th>
              <th className="px-2 py-2 text-center font-medium">Email</th>
              <th className="px-2 py-2 text-center font-medium">Days before</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(state).map((type) => (
              <tr key={type} className="border-b last:border-0">
                <td className="py-2 pr-3">{labels[type]}</td>
                {(["IN_APP", "BROWSER", "EMAIL"] as const).map((ch) => (
                  <td key={ch} className="px-2 py-2 text-center">
                    <input type="checkbox" className="size-5 accent-[var(--primary)]" aria-label={`${labels[type]} — ${ch.toLowerCase().replace("_", "-")}`} checked={state[type][ch].enabled} disabled={ch === "EMAIL" && !emailConfigured && !state[type][ch].enabled} onChange={() => toggle(type, ch)} />
                  </td>
                ))}
                <td className="px-2 py-2 text-center">
                  {["CARD_DUE", "EMI_DUE"].includes(type) ? (
                    <input type="number" min={0} max={30} className="h-9 w-16 rounded-md border bg-card px-2 text-center" aria-label={`${labels[type]} — days before`} value={state[type].IN_APP.leadDays} onChange={(e) => setLead(type, e.target.value)} />
                  ) : (
                    <span className="text-xs text-muted-foreground">{type === "REMINDER" ? "per reminder" : "—"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!emailConfigured && <p className="text-xs text-muted-foreground">Email notifications need SMTP settings in .env (EMAIL_TRANSPORT=&quot;smtp&quot;, SMTP_HOST…). Until then emails are only printed in the terminal.</p>}
      <div className="flex justify-end">
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save settings</Button>
      </div>
    </div>
  );
}

/**
 * While the app is open: checks for new notifications every 2 minutes and shows
 * them as browser notifications when the user allowed it on this device.
 * (Push while the app is fully closed would need a push service — not used.)
 */
export function BrowserNotifier({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  React.useEffect(() => {
    if (!enabled || typeof Notification === "undefined") return;
    let stopped = false;
    const seenKey = "fs360.seenNotifications";
    const check = async () => {
      if (document.visibilityState === "hidden" && Notification.permission !== "granted") return;
      try {
        const res = await fetch("/api/notifications?unread=1&limit=10", { cache: "no-store" });
        if (!res.ok) return;
        const { data } = (await res.json()) as { data: { items: { id: string; title: string; body: string; link: string | null }[]; unread: number } };
        let seen: string[] = [];
        try {
          seen = JSON.parse(localStorage.getItem(seenKey) ?? "[]");
        } catch {
          seen = [];
        }
        const fresh = data.items.filter((n) => !seen.includes(n.id));
        if (fresh.length && Notification.permission === "granted") {
          const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => undefined);
          for (const n of fresh.slice(0, 3)) {
            const opts = { body: n.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: n.id, data: { link: n.link ?? "/notifications" } };
            if (reg) await reg.showNotification(n.title, opts);
            else new Notification(n.title, opts);
          }
          router.refresh();
        }
        try {
          localStorage.setItem(seenKey, JSON.stringify([...new Set([...data.items.map((n) => n.id), ...seen])].slice(0, 200)));
        } catch {
          /* storage unavailable */
        }
      } catch {
        /* offline */
      }
    };
    const first = setTimeout(() => !stopped && check(), 5_000);
    const t = setInterval(() => !stopped && check(), 120_000);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(t);
    };
  }, [enabled, router]);
  return null;
}
