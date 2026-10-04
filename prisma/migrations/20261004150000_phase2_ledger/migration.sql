-- DropIndex
DROP INDEX "sub_categories_categoryId_name_key";

-- AlterTable
ALTER TABLE "credit_cards" ADD COLUMN     "openingOutstanding" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sub_categories" ADD COLUMN     "ownerKey" TEXT NOT NULL DEFAULT 'system';

-- Backfill: user-owned sub-categories are keyed by their owner
UPDATE "sub_categories" SET "ownerKey" = "userId" WHERE "userId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "sub_categories_userId_idx" ON "sub_categories"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "sub_categories_categoryId_ownerKey_name_key" ON "sub_categories"("categoryId", "ownerKey", "name");

-- CreateIndex
CREATE INDEX "transactions_userId_cashAccountId_transactionDate_idx" ON "transactions"("userId", "cashAccountId", "transactionDate");

-- CreateIndex
CREATE INDEX "transactions_transferGroupId_idx" ON "transactions"("transferGroupId");

