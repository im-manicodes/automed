-- Síntesis incremental: qué cubrió cada versión, modo y estimación de entrada.
ALTER TABLE "Synthesis" ADD COLUMN "coveredMessageIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Synthesis" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'full';
ALTER TABLE "Synthesis" ADD COLUMN "baseSynthesisId" TEXT;
ALTER TABLE "Synthesis" ADD COLUMN "inputTokensEstimados" INTEGER;
