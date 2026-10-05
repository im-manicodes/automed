"""Servicio OCR local (solo desarrollo / pruebas sin Textract).

POST /ocr   cuerpo = bytes de la imagen (PNG/JPEG)  ->  {width, height, words[], lines[]}
            cada item: {text, confidence 0..1, x, y, w, h} con la caja normalizada 0..1.
GET  /health
"""
from fastapi import FastAPI, HTTPException, Request

from .engines import get_engine, load_image

app = FastAPI(title="auto-med ocr-local")


@app.get("/health")
def health():
    return {"ok": True, "engine": get_engine().name}


@app.post("/ocr")
async def ocr(request: Request):
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="Cuerpo vacío")
    try:
        img = load_image(data)
    except Exception:
        raise HTTPException(status_code=400, detail="Imagen inválida")
    return get_engine().recognize(img)
