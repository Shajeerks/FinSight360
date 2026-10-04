import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";

/**
 * Honest placeholder for modules scheduled in a later build phase.
 * It never shows fake data.
 */
export function ComingSoon({
  title,
  description,
  phase,
  icon: Icon = Construction,
  features,
}: {
  title: string;
  description: string;
  phase: number;
  icon?: LucideIcon;
  features: string[];
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-start gap-5 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-5" />
            </span>
            <Badge variant="secondary">Arrives in build phase {phase}</Badge>
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">What this section will do</h2>
            <ul className="grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
              {features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-muted-foreground">
            The database tables for this module already exist, so nothing will need to be re-entered when it ships.
          </p>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
