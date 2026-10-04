-- AlterTable
ALTER TABLE "transaction_imports" ADD COLUMN     "amountMode" "AmountMode",
ADD COLUMN     "columnMapping" JSONB,
ADD COLUMN     "dateFormat" TEXT,
ADD COLUMN     "headerRowIndex" INTEGER,
ADD COLUMN     "parseConfidence" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "transaction_import_rows" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "include" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "matchedFields" TEXT[],
ADD COLUMN     "matchedTransactionId" TEXT,
ADD COLUMN     "merchantName" TEXT,
ADD COLUMN     "suggestedCategoryId" TEXT,
ADD COLUMN     "suggestedSubCategoryId" TEXT,
ADD COLUMN     "transactionType" "TransactionType";

