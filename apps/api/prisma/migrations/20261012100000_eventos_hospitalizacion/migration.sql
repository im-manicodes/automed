-- CreateTable
CREATE TABLE "HospitalEvent" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "synthesisId" TEXT NOT NULL,
    "fechaEvento" TIMESTAMP(3) NOT NULL,
    "fecha" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "novedadTexto" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "columnas" JSONB NOT NULL DEFAULT '[]',
    "templateVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HospitalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HospitalEvent_threadId_fechaEvento_idx" ON "HospitalEvent"("threadId", "fechaEvento");

-- CreateIndex
CREATE INDEX "HospitalEvent_fecha_idx" ON "HospitalEvent"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalEvent_threadId_synthesisId_key" ON "HospitalEvent"("threadId", "synthesisId");

-- AddForeignKey
ALTER TABLE "HospitalEvent" ADD CONSTRAINT "HospitalEvent_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
