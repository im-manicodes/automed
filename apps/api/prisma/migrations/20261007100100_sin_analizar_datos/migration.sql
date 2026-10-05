-- Campos nuevos de Thread.
ALTER TABLE "Thread" ADD COLUMN "seguimiento" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Thread" ADD COLUMN "tieneMensajesNuevos" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Thread" ALTER COLUMN "status" SET DEFAULT 'sin_analizar';

-- Hilos en 'pendiente' que nunca tuvieron síntesis pasan a 'sin_analizar'.
UPDATE "Thread" t
SET "status" = 'sin_analizar'
WHERE t."status" = 'pendiente'
  AND NOT EXISTS (SELECT 1 FROM "Synthesis" s WHERE s."threadId" = t."id");

-- Cancela trabajos aún no iniciados de esos hilos (para que no lleguen a OCR/LLM).
UPDATE "Job" j
SET "status" = 'error', "lastError" = 'cancelado: el análisis es bajo petición del usuario'
WHERE j."status" = 'pendiente'
  AND (
    (j."type" IN ('process_thread', 'synthesize_thread')
      AND (j."payload"->>'threadId') IN (SELECT "id" FROM "Thread" WHERE "status" = 'sin_analizar'))
    OR
    (j."type" = 'process_attachment'
      AND (j."payload"->>'attachmentId') IN (
        SELECT a."id" FROM "Attachment" a
        JOIN "Message" m ON m."id" = a."messageId"
        JOIN "Thread" t ON t."id" = m."threadId"
        WHERE t."status" = 'sin_analizar'))
  );
