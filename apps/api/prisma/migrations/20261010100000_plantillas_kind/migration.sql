-- Plantillas por tipo: 'resumen' (existentes) y 'whatsapp'. Segura para datos existentes:
-- las filas actuales quedan como 'resumen'.
ALTER TABLE "Template" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'resumen';

CREATE INDEX "Template_kind_isActive_idx" ON "Template"("kind", "isActive");
