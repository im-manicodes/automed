# --- Builder: instala las dependencias Python en un venv que luego se copia a la imagen final ---
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt \
    # paddlex[ocr-core]==3.0.3 resuelve opencv-contrib-python 4.10.0.84 (con GUI, pide libgl1);
    # se cambia por la variante headless de la MISMA versión (no necesita libgl1 ni X11).
    && pip uninstall -y opencv-contrib-python opencv-python opencv-python-headless opencv-contrib-python-headless \
    && pip install opencv-contrib-python-headless==4.10.0.84 \
    # Recorte de peso: solo bytecode (no se borran carpetas tests/test: algunos paquetes las importan en runtime).
    && find /opt/venv -type d -name __pycache__ -prune -exec rm -rf {} + \
    && find /opt/venv -name '*.pyc' -delete

# --- Final: solo runtime ---
FROM python:3.11-slim

# Tesseract (fallback / validación) + librerías de runtime de Paddle/OpenCV.
# No se instala libgl1: la variante headless de OpenCV no lo necesita.
# NO verificado sin construir la imagen: que ningún otro paquete (p. ej. paddlex/paddleocr) importe cv2 con
# dependencias GUI; si el arranque falla con «libGL.so.1», volver a añadir libgl1.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /srv
COPY app ./app

# Los modelos de PaddleOCR se descargan en el primer uso; el volumen los conserva.
ENV PADDLE_PDX_CACHE_HOME=/models \
    OCR_LOCAL_ENGINE=paddle \
    OCR_LANG=es \
    OCR_FALLBACK=true
VOLUME /models
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
