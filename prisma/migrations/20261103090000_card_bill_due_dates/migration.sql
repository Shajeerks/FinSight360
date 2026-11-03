-- Card bill details from statements (due date, totals, charges) and due dates in the debt tracker.
-- Additive only: no existing rows are changed.
ALTER TABLE "statements" ADD COLUMN "previousBalance" DECIMAL(18,2);
ALTER TABLE "statements" ADD COLUMN "purchases" DECIMAL(18,2);
ALTER TABLE "statements" ADD COLUMN "paymentsCredits" DECIMAL(18,2);
ALTER TABLE "statements" ADD COLUMN "financeCharges" DECIMAL(18,2);
ALTER TABLE "transaction_imports" ADD COLUMN "previousCardBill" JSONB;
ALTER TABLE "debt_month_entries" ADD COLUMN "dueDate" DATE;
