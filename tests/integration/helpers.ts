import { prisma } from "@/lib/db";
import { setMailer, type MailMessage } from "@/lib/mail/mailer";

export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

/** Captures outgoing emails instead of printing them. */
export function captureMail() {
  const sent: MailMessage[] = [];
  setMailer({ send: async (m) => void sent.push(m) });
  return {
    sent,
    lastLink(pathFragment: string) {
      const msg = [...sent].reverse().find((m) => m.text.includes(pathFragment));
      const match = msg?.text.match(/https?:\/\/\S+/);
      return match ? new URL(match[0]) : null;
    },
  };
}

export async function seedMinimalCategories() {
  const food = await prisma.category.create({ data: { name: "Food", kind: "EXPENSE", isSystem: true } });
  await prisma.subCategory.create({ data: { categoryId: food.id, name: "Food Delivery", isSystem: true } });
  await prisma.category.create({ data: { name: "Salary", kind: "INCOME", isSystem: true } });
}

export const meta = { ip: "127.0.0.1", userAgent: "vitest" };
