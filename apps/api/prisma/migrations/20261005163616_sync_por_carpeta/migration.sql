/*
  Warnings:

  - You are about to drop the column `deltaLink` on the `MailAccount` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "isFromMe" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MailFolderSync" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "deltaLink" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailFolderSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailFolderSync_accountId_folder_key" ON "MailFolderSync"("accountId", "folder");

-- AddForeignKey
ALTER TABLE "MailFolderSync" ADD CONSTRAINT "MailFolderSync_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conserva el deltaLink existente como el de la carpeta inbox
INSERT INTO "MailFolderSync" ("id", "accountId", "folder", "deltaLink", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'inbox', "deltaLink", CURRENT_TIMESTAMP
FROM "MailAccount" WHERE "deltaLink" IS NOT NULL;

-- Rellena isFromMe de los mensajes ya guardados
UPDATE "Message" m SET "isFromMe" = true
FROM "Thread" t JOIN "MailAccount" a ON a."id" = t."accountId"
WHERE m."threadId" = t."id"
  AND (lower(m."from") = lower(a."email") OR lower(m."from") LIKE '%<' || lower(a."email") || '>');

-- AlterTable
ALTER TABLE "MailAccount" DROP COLUMN "deltaLink";
