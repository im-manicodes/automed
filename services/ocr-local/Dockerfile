FROM python:3.11-slim

# Tesseract (fallback / validación) + librerías que necesitan OpenCV/Paddle.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Los modelos de PaddleOCR se descargan en el primer uso; el volumen los conserva.
ENV PADDLE_PDX_CACHE_HOME=/models \
    OCR_LOCAL_ENGINE=paddle \
    OCR_LANG=es \
    OCR_FALLBACK=true
VOLUME /models
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
