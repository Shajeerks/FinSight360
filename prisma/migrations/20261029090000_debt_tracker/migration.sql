-- Debt tracker: other lenders, monthly figures, and loan payments linked to existing transactions.
-- Additive only: no existing rows are changed.

CREATE TYPE "DebtLenderKind" AS ENUM ('PERSON', 'OTHER');
CREATE TYPE "DebtEntrySource" AS ENUM ('MANUAL', 'EXCEL');

ALTER TABLE "loan_payments" ADD COLUMN "linkedExisting" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "debt_lenders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DebtLenderKind" NOT NULL DEFAULT 'PERSON',
    "matchText" TEXT,
    "openingOutstanding" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openingDate" DATE,
    "monthlyRatePct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "closedAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "debt_lenders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "debt_lenders_userId_idx" ON "debt_lenders"("userId");
ALTER TABLE "debt_lenders" ADD CONSTRAINT "debt_lenders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "debt_month_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "lenderKey" VARCHAR(80) NOT NULL,
    "lenderName" TEXT NOT NULL,
    "openingOutstanding" DECIMAL(18,2),
    "newBorrowing" DECIMAL(18,2),
    "payment" DECIMAL(18,2),
    "paidToDate" DECIMAL(18,2),
    "interest" DECIMAL(18,2),
    "closingOutstanding" DECIMAL(18,2),
    "remainingEmis" INTEGER,
    "source" "DebtEntrySource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "debt_month_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "debt_month_entries_userId_month_lenderKey_key" ON "debt_month_entries"("userId", "month", "lenderKey");
CREATE INDEX "debt_month_entries_userId_lenderKey_idx" ON "debt_month_entries"("userId", "lenderKey");
ALTER TABLE "debt_month_entries" ADD CONSTRAINT "debt_month_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
