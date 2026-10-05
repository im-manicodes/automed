-- OcrPage: sha256 denormalizado (dedupe por contenido), motor usado.
ALTER TABLE "OcrPage" ADD COLUMN "sha256" TEXT;
ALTER TABLE "OcrPage" ADD COLUMN "engine" TEXT;
UPDATE "OcrPage" p SET "sha256" = a."sha256" FROM "Attachment" a WHERE a."id" = p."attachmentId";
ALTER TABLE "OcrPage" ALTER COLUMN "sha256" SET NOT NULL;
CREATE UNIQUE INDEX "OcrPage_sha256_pageNumber_key" ON "OcrPage"("sha256", "pageNumber");

-- OcrRegion: origen del texto vigente.
ALTER TABLE "OcrRegion" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'ocr';
