import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBankAccount } from "@/services/account.service";
import { createTransaction } from "@/services/transaction.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { commitImport, createImport, getImport, undoImport } from "@/services/import.service";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { meta, resetDatabase } from "./helpers";

/**
 * Sample statement in Kotak 811's layout (made-up data): serial-number column,
 * two look-alike ₹60 UPI payments, a card bill paid to a card not tracked in the
 * app, an overdraft printed WITHOUT a minus sign, and a sweep-in from an FD.
 * Opening ₹500.00 → closing ₹1,400.00.
 */
const PDF = readFileSync(path.join(__dirname, "..", "fixtures", "kotak-style-statement.pdf"));
const upload = (userId: string, bankId: string) => createImport(userId, { file: { name: "kotak.pdf", type: "application/pdf", buffer: PDF }, account: `bank:${bankId}` }, meta);

describe("Kotak-style PDF statement (integration)", () => {
  let userId: string;
  let bankId: string;

  beforeEach(async () => {
    await resetDatabase();
    for (const c of DEFAULT_CATEGORIES) {
      const cat = await prisma.category.create({ data: { name: c.name, kind: c.kind, color: c.color, isFixed: c.isFixed ?? false, isSystem: true } });
      if (c.subCategories.length) await prisma.subCategory.createMany({ data: c.subCategories.map((name) => ({ categoryId: cat.id, name, isSystem: true })) });
    }
    userId = (await prisma.user.create({ data: { email: "kotak@example.com" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    // Like the user did: account created with TODAY's balance (= the statement's closing balance).
    bankId = (await createBankAccount(userId, { bankName: "Kotak Mahindra Bank", nickname: "Kotak 811", accountType: "SAVINGS", currentBalance: "1400" }, meta)).id;
  });
  afterAll(() => prisma.$disconnect());

  const bank = () => prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } });

  it("reads every row (unsigned overdraft balances, serial column) and the balance ends where the statement does", async () => {
    const up = await upload(userId, bankId);
    const d = await getImport(userId, up.id);
    expect(Number(d.imp.parseConfidence)).toBe(100);
    expect(d.rows.map((r) => [r.amount?.toFixed(2), r.direction])).toEqual([
      ["60.00", "DEBIT"],
      ["60.00", "DEBIT"],
      ["5000.00", "DEBIT"],
      ["1000.00", "DEBIT"],
      ["20.00", "CREDIT"],
      ["6000.00", "CREDIT"],
      ["1000.00", "CREDIT"],
    ]);

    const s = await commitImport(userId, up.id, meta);
    // Both look-alike ₹60 payments are imported (neither "already imported"),
    // the card bill to an untracked card isn't held for review.
    expect(s).toMatchObject({ created: 7, skipped: 0, pendingReview: 0, openingBalanceSet: "500.00" });
    const b = await bank();
    expect(b.openingBalance.toFixed(2)).toBe("500.00");
    expect(b.currentBalance.toFixed(2)).toBe("1400.00");
    const cardPayment = await prisma.transaction.findFirstOrThrow({ where: { userId, transactionType: "CARD_PAYMENT" } });
    expect(cardPayment.status).toBe("CONFIRMED");
    expect(cardPayment.creditCardId).toBeNull();

    // Undo puts the account back exactly as it was.
    await undoImport(userId, up.id, meta);
    const after = await bank();
    expect(after.openingBalance.toFixed(2)).toBe("1400.00");
    expect(after.currentBalance.toFixed(2)).toBe("1400.00");
  });

  it("re-importing the same statement adds nothing", async () => {
    await commitImport(userId, (await upload(userId, bankId)).id, meta);
    const again = await createImport(userId, { file: { name: "kotak-copy.pdf", type: "application/pdf", buffer: Buffer.concat([PDF, Buffer.from("\n")]) }, account: `bank:${bankId}` }, meta);
    const s = await commitImport(userId, again.id, meta);
    expect(s).toMatchObject({ created: 0, skipped: 7 });
    expect((await bank()).currentBalance.toFixed(2)).toBe("1400.00");
  });

  it("keeps the account's opening balance when the account already has older transactions", async () => {
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-15", amount: "100", account: `bank:${bankId}`, description: "Older manual entry" }, meta);
    const s = await commitImport(userId, (await upload(userId, bankId)).id, meta);
    expect(s.openingBalanceSet).toBeUndefined();
    expect((await bank()).openingBalance.toFixed(2)).toBe("1400.00");
  });
});
