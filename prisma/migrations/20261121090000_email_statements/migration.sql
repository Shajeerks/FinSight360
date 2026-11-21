-- Email statements: statement attachments found in connected mailboxes, and IMAP (app password) mailboxes.

-- AlterEnum
ALTER TYPE "EmailProvider" ADD VALUE 'IMAP';

-- CreateEnum
CREATE TYPE "EmailStatementStatus" AS ENUM ('PENDING', 'IMPORTED', 'DISMISSED');

-- AlterTable
ALTER TABLE "email_connections" ADD COLUMN "imapHost" TEXT;

-- CreateTable
CREATE TABLE "email_statements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "attachmentRef" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "suggestedAccount" TEXT,
    "needsPassword" BOOLEAN NOT NULL DEFAULT false,
    "status" "EmailStatementStatus" NOT NULL DEFAULT 'PENDING',
    "importId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_statements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_statements_connectionId_providerMessageId_fileName_key" ON "email_statements"("connectionId", "providerMessageId", "fileName");

-- CreateIndex
CREATE INDEX "email_statements_userId_status_idx" ON "email_statements"("userId", "status");

-- AddForeignKey
ALTER TABLE "email_statements" ADD CONSTRAINT "email_statements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_statements" ADD CONSTRAINT "email_statements_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "email_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
