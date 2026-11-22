/**
 * "Focus on closing": how long each debt takes at its current monthly payment, and what an
 * extra amount each month changes (pure, unit-tested). Interest isn't modelled here — it is
 * a planning view on what you pay; the Debt Tracker keeps the exact figures.
 *
 * With an extra amount, the "snowball" order is used: the extra goes to the smallest balance
 * first; when a debt closes, its monthly payment rolls on to the next one.
 */
export type PlanDebt = { key: string; name: string; balance: number; monthly: number; emisLeft?: number | null };
export type PlanResult = { key: string; months: number | null };

export function monthsToClose(d: PlanDebt): number | null {
  if (d.balance <= 1) return 0;
  if (d.emisLeft && d.emisLeft > 0) return d.emisLeft;
  if (d.monthly <= 0) return null;
  return Math.ceil(d.balance / d.monthly);
}

export function snowball(debts: PlanDebt[], extra: number, maxMonths = 600): PlanResult[] {
  const live = debts.filter((d) => d.balance > 1).map((d) => ({ ...d, left: d.balance })).sort((a, b) => a.balance - b.balance);
  const done = new Map<string, number>();
  for (const d of debts) if (d.balance <= 1) done.set(d.key, 0);
  let freed = 0;
  for (let m = 1; m <= maxMonths && done.size < debts.length; m++) {
    let pool = Math.max(extra, 0) + freed;
    for (const d of live) {
      if (done.has(d.key)) continue;
      d.left -= d.monthly;
    }
    for (const d of live) {
      if (done.has(d.key) || pool <= 0) continue;
      const use = Math.min(pool, Math.max(d.left, 0));
      d.left -= use;
      pool -= use;
    }
    for (const d of live) {
      if (!done.has(d.key) && d.left <= 1) {
        done.set(d.key, m);
        freed += d.monthly;
      }
    }
    if (live.every((d) => d.monthly <= 0) && extra <= 0) break;
  }
  return debts.map((d) => ({ key: d.key, months: done.get(d.key) ?? null }));
}
