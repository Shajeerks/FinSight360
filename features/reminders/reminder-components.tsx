"use client";
import * as React from "react";
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { completeReminderAction, deleteReminderAction, saveReminderAction } from "@/features/reminders/actions";

export const REMINDER_TYPE_LABEL: Record<string, string> = {
  CREDIT_CARD_DUE: "Card bill",
  LOAN_EMI: "Loan EMI",
  INSURANCE: "Insurance",
  SIP: "SIP / investment",
  SUBSCRIPTION: "Subscription",
  BILL: "Bill",
  CUSTOM: "Custom",
};
const RECURRENCE_LABEL: Record<string, string> = { "": "Doesn't repeat", WEEKLY: "Every week", MONTHLY: "Every month", QUARTERLY: "Every 3 months", HALF_YEARLY: "Every 6 months", YEARLY: "Every year" };

type Values = { type: string; title: string; description: string; amount: string; dueDate: string; recurrence: string; leadDays: string };

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function ReminderDialog({ reminder, trigger }: { reminder?: Values & { id: string }; trigger?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState<Values>(reminder ?? { type: "INSURANCE", title: "", description: "", amount: "", dueDate: today(), recurrence: "YEARLY", leadDays: "3" });
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <span onClick={() => setOpen(true)}>{trigger}</span> : <Button onClick={() => setOpen(true)}><Plus /> Add reminder</Button>}
      <DialogContent title={reminder ? "Edit reminder" : "Add reminder"} description="Card dues and loan EMIs are reminded automatically — add insurance, bills, SIP dates and anything else here.">
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await saveReminderAction(reminder?.id ?? null, { ...v, amount: v.amount || null, recurrence: v.recurrence || null });
              if (!res.ok) {
                setErrors(res.fieldErrors ?? {});
                setError(res.fieldErrors ? null : res.error);
                return;
              }
              toast.success(res.message ?? "Saved");
              setOpen(false);
            });
          }}
        >
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="rm-type" label="Type" error={errors.type?.[0]}>
              <NativeSelect id="rm-type" value={v.type} onChange={set("type")}>
                {["INSURANCE", "BILL", "SUBSCRIPTION", "SIP", "CUSTOM"].map((t) => <option key={t} value={t}>{REMINDER_TYPE_LABEL[t]}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="rm-title" label="Title" error={errors.title?.[0]}><Input id="rm-title" placeholder="e.g. Health insurance premium" value={v.title} onChange={set("title")} /></FormField>
            <FormField id="rm-date" label="Due date" error={errors.dueDate?.[0]}><Input id="rm-date" type="date" value={v.dueDate} onChange={set("dueDate")} /></FormField>
            <FormField id="rm-amount" label="Amount (optional)" error={errors.amount?.[0]}><Input id="rm-amount" inputMode="decimal" value={v.amount} onChange={set("amount")} /></FormField>
            <FormField id="rm-rec" label="Repeats">
              <NativeSelect id="rm-rec" value={v.recurrence} onChange={set("recurrence")}>{Object.entries(RECURRENCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
            </FormField>
            <FormField id="rm-lead" label="Remind me (days before)" error={errors.leadDays?.[0]}><Input id="rm-lead" inputMode="numeric" value={v.leadDays} onChange={set("leadDays")} /></FormField>
          </div>
          <FormField id="rm-desc" label="Notes (optional)"><Textarea id="rm-desc" rows={2} value={v.description} onChange={set("description")} /></FormField>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{reminder ? "Save" : "Add reminder"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReminderItemActions({ itemKey, source, reminder }: { itemKey: string; source: string; reminder?: Values & { id: string } }) {
  const [pending, start] = React.useTransition();
  const canComplete = source === "REMINDER" || source === "RECURRING";
  return (
    <div className="flex shrink-0 items-center gap-1">
      {canComplete && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await completeReminderAction(itemKey);
              if (!res.ok) return void toast.error(res.error);
              toast.success(res.data?.next ? `Done — next one on ${res.data.next}.` : "Marked as done.");
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <Check />} {source === "RECURRING" ? "Paid" : "Done"}
        </Button>
      )}
      {reminder && (
        <>
          <ReminderDialog reminder={reminder} trigger={<Button size="icon" variant="ghost" className="size-8" aria-label="Edit reminder"><Pencil /></Button>} />
          <ConfirmButton size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label="Delete reminder" title="Delete this reminder?" description="Future repeats are removed too." confirmLabel="Delete" onConfirm={() => deleteReminderAction(reminder.id)}>
            <Trash2 />
          </ConfirmButton>
        </>
      )}
    </div>
  );
}
