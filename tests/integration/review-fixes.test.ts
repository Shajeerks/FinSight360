import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBankAccount } from "@/services/account.service";
import { createCreditCard } from "@/services/credit-card.service";
import { createTransaction, deleteTransaction } from "@/services/transaction.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { applyMapping, commitImport, createImport, setAllIncluded, undoImport, updateImportRow } from "@/services/import.service";
import { listDuplicateCandidates, resolveDuplicate, scanForDuplicates } from "@/services/duplicate.service";
import { createLoan, deleteLoan, deleteLoanPayment, recordLoanPayment } from "@/services/loan.service";
import { toDecimal } from "@/lib/money";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { meta, resetDatabase } from "./helpers";

/** Regression tests for the Phase 1–4 review (second pass). */

async function seedCategories() {
  for (const c of DEFAULT_CATEGORIES) {
    const cat = await prisma.category.create({ data: { name: c.name, kind: c.kind, color: c.color, isFixed: c.isFixed ?? false, isSystem: true } });
    if (c.subCategories.length) await prisma.subCategory.createMany({ data: c.subCategories.map((name) => ({ categoryId: cat.id, name, isSystem: true })) });
  }
}

const csv = (lines: string[]) => ({ name: "s.csv", type: "text/csv", buffer: Buffer.from(lines.join("\n")) });
const CARD_CSV = csv(["Date,Details,Debit,Credit", "10/10/2026,PAYMENT RECEIVED - THANK YOU,,24500.00"]);
const BANK_CSV = csv(["Date,Narration,Debit,Credit", "10/10/2026,HDFC CREDIT CARD PAYMENT XX1043,24500.00,"]);

async function importFile(userId: string, file: ReturnType<typeof csv>, account: string, extra: Record<string, unknown> = {}) {
  const up = await createImport(userId, { file, account }, meta);
  const imp = await prisma.transactionImport.findUniqueOrThrow({ where: { id: up.id } });
  const m = imp.columnMapping as { fields: Record<string, number>; positiveIs: string };
  await applyMapping(userId, up.id, { headerRowIndex: imp.headerRowIndex, dateFormat: imp.dateFormat ?? "dd/MM/yyyy", amountMode: imp.amountMode, positiveIs: m.positiveIs, ...m.fields, ...extra }, meta);
  return up.id;
}

describe("review fixes (integration)", () => {
  let userId: string;
  let bankId: string;
  let cardId: string;
  const bank = async () => (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2);
  const card = async () => (await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } })).currentOutstanding.toFixed(2);

  beforeEach(async () => {
    await resetDatabase();
    await seedCategories();
    userId = (await prisma.user.create({ data: { email: "fix@example.com" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    bankId = (await createBankAccount(userId, { bankName: "HDFC Bank", nickname: "Main", accountType: "SAVINGS", currentBalance: "50000" }, meta)).id;
    cardId = (await createCreditCard(userId, { bankName: "HDFC", cardName: "Regalia", last4: "1043", creditLimit: "300000", currentOutstanding: "30000" }, meta)).id;
  });
  afterAll(() => prisma.$disconnect());

  async function cardThenBankPair() {
    const cardImport = await importFile(userId, CARD_CSV, `card:${cardId}`);
    await commitImport(userId, cardImport, meta);
    const bankImport = await importFile(userId, BANK_CSV, `bank:${bankId}`);
    const s = await commitImport(userId, bankImport, meta);
    expect(s.possibleDuplicates).toBe(1);
    const [pair] = await listDuplicateCandidates(userId);
    return { cardImport, bankImport, pair };
  }

  it("CONFIRM_DUPLICATE on a card-payment pair keeps the bank debit; undo reverses it", async () => {
    const { bankImport, pair } = await cardThenBankPair();
    await resolveDuplicate(userId, pair.id, { action: "CONFIRM_DUPLICATE" }, meta);
    expect(await card()).toBe("5500.00");
    expect(await bank()).toBe("25500.00");
    await undoImport(userId, bankImport, meta);
    expect(await bank()).toBe("50000.00");
    expect(await card()).toBe("5500.00"); // the card statement's payment is still there
  });

  it("MERGE then undo of the merged import restores the bank", async () => {
    const { bankImport, pair } = await cardThenBankPair();
    await resolveDuplicate(userId, pair.id, { action: "MERGE" }, meta);
    expect(await bank()).toBe("25500.00");
    await undoImport(userId, bankImport, meta);
    expect(await bank()).toBe("50000.00");
    expect(await card()).toBe("5500.00");
    expect(await prisma.transaction.count({ where: { userId, deletedAt: null, duplicateOfId: null } })).toBe(1);
  });

  it("undoing both imports of an auto-linked pair leaves nothing behind", async () => {
    const withRef = (f: string, row: string) => csv([f, row]);
    const c = await importFile(userId, withRef("Date,Details,Ref,Debit,Credit", "10/10/2026,PAYMENT RECEIVED NEFT,N274262099999999,,24500.00"), `card:${cardId}`);
    await commitImport(userId, c, meta);
    const b = await importFile(userId, withRef("Date,Narration,Ref,Debit,Credit", "10/10/2026,HDFC CREDIT CARD PAYMENT XX1043,N274262099999999,24500.00,"), `bank:${bankId}`);
    expect((await commitImport(userId, b, meta)).linked).toBe(1);
    expect([await bank(), await card()]).toEqual(["25500.00", "5500.00"]);
    await undoImport(userId, c, meta);
    expect([await bank(), await card()]).toEqual(["25500.00", "5500.00"]); // still confirmed by the bank statement
    await undoImport(userId, b, meta);
    expect([await bank(), await card()]).toEqual(["50000.00", "30000.00"]);
    expect(await prisma.transaction.count({ where: { userId, deletedAt: null } })).toBe(0);
  });

  it("removing an original promotes its hidden duplicate, so the purchase is still counted once", async () => {
    const imp = await importFile(userId, csv(["Date,Narration,Debit,Credit", "03/10/2026,UPI/SWIGGY/swiggy@icici,645.00,"]), `bank:${bankId}`);
    await commitImport(userId, imp, meta);
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-10-03", amount: "645", account: `bank:${bankId}`, description: "Swiggy dinner", merchantName: "SWIGGY" }, meta);
    await prisma.transactionSource.updateMany({ where: { userId, sourceType: "MANUAL" }, data: { sourceType: "GMAIL" } });
    expect((await scanForDuplicates(userId, 3650, meta)).flagged).toBe(1);
    const [pair] = await listDuplicateCandidates(userId);
    await resolveDuplicate(userId, pair.id, { action: "CONFIRM_DUPLICATE" }, meta);
    expect(await bank()).toBe("49355.00");
    await undoImport(userId, imp, meta);
    expect(await bank()).toBe("49355.00");

    // Same through a plain delete.
    const visible = await prisma.transaction.findFirstOrThrow({ where: { userId, deletedAt: null, duplicateOfId: null } });
    const t2 = await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-10-04", amount: "100", account: `bank:${bankId}`, description: "Tea" }, meta);
    await prisma.transaction.update({ where: { id: t2.id }, data: { duplicateOfId: visible.id, duplicateStatus: "DUPLICATE" } });
    await deleteTransaction(userId, visible.id, meta);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t2.id } })).duplicateOfId).toBeNull();
  });

  it("a removed loan's EMI rows become ordinary transactions again", async () => {
    const loan = await createLoan(userId, { name: "Bike loan", lender: "HDFC", loanType: "PERSONAL", principal: "120000", interestRate: "12", tenureMonths: 12, startDate: "2026-01-01", firstEmiDate: "2026-02-05" }, meta);
    await recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: "2026-02-05", amount: "10661.85", account: `bank:${bankId}` }, meta);
    const p = await prisma.loanPayment.findFirstOrThrow({ where: { loanId: loan.id } });
    await expect(deleteTransaction(userId, p.transactionId!, meta)).rejects.toMatchObject({ code: "LOAN_PAYMENT_LOCKED" });
    await deleteLoan(userId, loan.id, meta);
    await deleteTransaction(userId, p.transactionId!, meta);
    expect(await bank()).toBe("50000.00");
  });

  it("undoing an earlier EMI keeps that instalment (overdue) instead of dropping it", async () => {
    const loan = await createLoan(userId, { name: "Bike loan", lender: "HDFC", loanType: "PERSONAL", principal: "120000", interestRate: "12", tenureMonths: 12, startDate: "2026-01-01", firstEmiDate: "2026-02-05" }, meta);
    await recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: "2026-02-05", amount: "10661.85", recordInLedger: false }, meta);
    await recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: "2026-03-05", amount: "10661.85", recordInLedger: false }, meta);
    const first = await prisma.loanPayment.findFirstOrThrow({ where: { loanId: loan.id }, orderBy: { paymentDate: "asc" } });
    await deleteLoanPayment(userId, loan.id, first.id, meta);
    const rows = await prisma.loanAmortizationSchedule.findMany({ where: { loanId: loan.id }, orderBy: { installmentNumber: "asc" }, include: { payments: { where: { deletedAt: null } } } });
    expect(rows[0].installmentNumber).toBe(1);
    expect(rows[0].payments).toHaveLength(0);
    expect(rows[1].status).toBe("PAID");
    expect(rows.length).toBe(12);
    const l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    const unpaidPrincipal = rows.filter((r) => r.payments.length === 0).reduce((s, r) => s.plus(r.principalComponent), toDecimal(0));
    expect(unpaidPrincipal.toFixed(2)).toBe(l.outstandingPrincipal.toFixed(2));
  });

  it("rejects non-string ids (Prisma filter objects) in import services", async () => {
    const imp = await importFile(userId, BANK_CSV, `bank:${bankId}`);
    const evil = { not: "x" } as unknown as string;
    await expect(setAllIncluded(userId, evil, false)).rejects.toMatchObject({ code: "INVALID_ID" });
    await expect(updateImportRow(userId, imp, evil, { include: false })).rejects.toMatchObject({ code: "INVALID_ID" });
    await expect(updateImportRow(userId, evil, evil, { include: false })).rejects.toMatchObject({ code: "INVALID_ID" });
  });
});
