-- Loans / borrowed money received and lending / repaying a person:
-- moves money but is never income or expense.
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'BORROWING' BEFORE 'OTHER';
