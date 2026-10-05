-- Template: versión incremental (historial + una activa).
ALTER TABLE "Template" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Synthesis: modelo y plantilla usados.
ALTER TABLE "Synthesis" ADD COLUMN "model" TEXT;
ALTER TABLE "Synthesis" ADD COLUMN "templateId" TEXT;
ALTER TABLE "Synthesis" ADD COLUMN "templateVersion" INTEGER;
