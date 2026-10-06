-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generando',
    "storageKey" TEXT,
    "fileName" TEXT,
    "templateVersion" INTEGER,
    "columnas" JSONB NOT NULL DEFAULT '[]',
    "totalHospitalizados" INTEGER NOT NULL DEFAULT 0,
    "totalConNovedad" INTEGER NOT NULL DEFAULT 0,
    "totalAltas" INTEGER NOT NULL DEFAULT 0,
    "totalSinAnalizar" INTEGER NOT NULL DEFAULT 0,
    "procesados" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRow" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "synthesisId" TEXT,
    "estado" TEXT NOT NULL,
    "novedad" BOOLEAN NOT NULL DEFAULT false,
    "novedadTexto" TEXT,
    "desactualizado" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL DEFAULT '{}',
    "extraccionOk" BOOLEAN NOT NULL DEFAULT true,
    "actualizadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadReportData" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "synthesisId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "estado" TEXT NOT NULL,
    "novedadTexto" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreadReportData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_fecha_idx" ON "Report"("fecha");

-- CreateIndex
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");

-- CreateIndex
CREATE INDEX "ReportRow_reportId_idx" ON "ReportRow"("reportId");

-- CreateIndex
CREATE INDEX "ReportRow_threadId_createdAt_idx" ON "ReportRow"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadReportData_threadId_synthesisId_templateVersion_key" ON "ThreadReportData"("threadId", "synthesisId", "templateVersion");

-- AddForeignKey
ALTER TABLE "ReportRow" ADD CONSTRAINT "ReportRow_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRow" ADD CONSTRAINT "ReportRow_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadReportData" ADD CONSTRAINT "ThreadReportData_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

