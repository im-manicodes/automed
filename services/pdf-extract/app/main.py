import os

from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from .extract import InvalidPdfError, extract_pdf

app = FastAPI(title="pdf-extract")

DEFAULT_MIN_CHARS = int(os.environ.get("PDF_TEXT_MIN_CHARS", "60"))
MAX_BYTES = int(os.environ.get("PDF_MAX_BYTES", str(50 * 1024 * 1024)))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/extract")
async def extract(request: Request, min_chars: int | None = None):
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="PDF demasiado grande")
    data = await request.body()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="PDF demasiado grande")
    if not data:
        raise HTTPException(status_code=400, detail="Cuerpo vacío")
    threshold = min_chars if min_chars is not None and min_chars >= 0 else DEFAULT_MIN_CHARS
    try:
        # def síncrono pesado: se ejecuta en el pool de hilos para no bloquear el loop.
        pages = await run_in_threadpool(extract_pdf, data, threshold)
    except InvalidPdfError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"pages": pages}
