#!/bin/bash
# Arranque de la imagen única: OCR local en segundo plano, migraciones y API (Node).
# Si cualquiera de los procesos termina, el contenedor sale (la política de reinicio lo levanta).
set -e

# OCR local (PaddleOCR; los modelos se descargan en el primer uso a /models).
(cd /srv/ocr-local && /opt/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000) &

node_modules/.bin/prisma migrate deploy
node dist/main.js &

# Termina cuando el primero de los procesos sale y propaga su código.
wait -n
code=$?
kill 0 2>/dev/null || true
exit $code
