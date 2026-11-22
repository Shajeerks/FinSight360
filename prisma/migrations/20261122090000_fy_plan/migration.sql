-- One-page payment plan: monthly commitments, due days, amount due per month, and monthly income.

-- AlterEnum
ALTER TYPE "DebtLenderKind" ADD VALUE 'COMMITMENT';

-- AlterTable
ALTER TABLE "debt_lenders" ADD COLUMN "dueDay" INTEGER;

-- AlterTable
ALTER TABLE "debt_month_entries" ADD COLUMN "amountDue" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "month_incomes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "salary" DECIMAL(18,2),
    "otherIncome" DECIMAL(18,2),
    "source" "DebtEntrySource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "month_incomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "month_incomes_userId_month_key" ON "month_incomes"("userId", "month");

-- AddForeignKey
ALTER TABLE "month_incomes" ADD CONSTRAINT "month_incomes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
