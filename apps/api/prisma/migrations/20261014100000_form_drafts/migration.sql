-- CreateTable
CREATE TABLE "FormDraft" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "synthesisId" TEXT NOT NULL,
    "catalogHash" TEXT NOT NULL,
    "valoresIA" JSONB NOT NULL,
    "valores" JSONB NOT NULL,
    "modelo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FormDraft_threadId_formato_key" ON "FormDraft"("threadId", "formato");

-- AddForeignKey
ALTER TABLE "FormDraft" ADD CONSTRAINT "FormDraft_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
