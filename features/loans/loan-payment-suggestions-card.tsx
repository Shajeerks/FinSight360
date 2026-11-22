import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findLoanPaymentCandidates, getLoanLinkOptions } from "@/services/loan-match.service";
import { LoanPaymentSuggestions, type CandidateView } from "@/features/loans/link-loan-payment";

/** "EMI payments found in your bank statements" — debits that look like loan payments, to link. */
export async function LoanPaymentSuggestionsCard({ userId, loanId }: { userId: string; loanId?: string }) {
  const [candidates, loans] = await Promise.all([findLoanPaymentCandidates(userId, { loanId, limit: 50 }), getLoanLinkOptions(userId)]);
  if (!candidates.length || !loans.length) return null;
  const items: CandidateView[] = candidates.map((c) => ({
    id: c.transactionId,
    date: c.date.toISOString().slice(0, 10),
    amount: c.amount.toFixed(2),
    description: c.description,
    account: c.account,
    loanId: c.loanId,
    loanLabel: c.loanLabel,
    confident: c.confident,
    reasons: c.reasons,
    scheduleId: c.suggestedScheduleId,
  }));
  return (
    <Card id="emi-payments" className="border-primary/30">
      <CardHeader>
        <CardTitle>EMI payments found in your bank statements ({items.length})</CardTitle>
        <CardDescription>
          These bank debits look like payments of {loanId ? "this loan" : "your loans"} but aren&apos;t linked yet. Link them so the loan&apos;s instalments, principal and interest update. Any other bank payment can be linked from Transactions with the <span className="font-medium">link</span> button.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoanPaymentSuggestions items={items} loans={loans} />
      </CardContent>
    </Card>
  );
}
