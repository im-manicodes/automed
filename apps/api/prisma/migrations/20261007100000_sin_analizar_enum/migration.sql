-- Nuevo estado: ningún hilo se envía a OCR/LLM hasta que el usuario lo pida.
-- El valor se añade en su propia migración: PostgreSQL no permite usarlo en la misma transacción.
ALTER TYPE "ProcessStatus" ADD VALUE IF NOT EXISTS 'sin_analizar' BEFORE 'pendiente';
