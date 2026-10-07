-- Loans: payments made before the loan was tracked in FinSight360.
ALTER TABLE "loan_payments" ADD COLUMN "isOpening" BOOLEAN NOT NULL DEFAULT false;
-- Existing "mark past EMIs as paid" rows are exactly that.
UPDATE "loan_payments" SET "isOpening" = true
WHERE "transactionId" IS NULL AND "notes" = 'Marked as paid when the loan was added';

-- Credit cards: amount already paid on the current bill outside FinSight360.
ALTER TABLE "credit_cards" ADD COLUMN "paidOnBill" DECIMAL(18,2) NOT NULL DEFAULT 0;
