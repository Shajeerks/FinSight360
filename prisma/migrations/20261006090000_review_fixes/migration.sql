-- Loan payments split over two instalments share a group.
ALTER TABLE "loan_payments" ADD COLUMN "groupId" TEXT;
CREATE INDEX "loan_payments_groupId_idx" ON "loan_payments"("groupId");

-- Prices a user entered/imported are private to that user ("" = public, e.g. AMFI NAVs).
ALTER TABLE "investment_prices" ADD COLUMN "ownerKey" TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS "investment_prices_instrumentKey_priceDate_source_key";
CREATE UNIQUE INDEX "investment_prices_instrumentKey_priceDate_source_ownerKey_key" ON "investment_prices"("instrumentKey", "priceDate", "source", "ownerKey");

-- Attribute existing private prices to the only user holding that instrument; drop the rest.
UPDATE "investment_prices" p
SET "ownerKey" = o."userId"
FROM (
  SELECT "instrumentKey", MIN("userId") AS "userId"
  FROM "investment_holdings"
  GROUP BY "instrumentKey"
  HAVING COUNT(DISTINCT "userId") = 1
) o
WHERE p."instrumentKey" = o."instrumentKey" AND p."source" <> 'AMFI';
DELETE FROM "investment_prices" WHERE "source" <> 'AMFI' AND "ownerKey" = '';
