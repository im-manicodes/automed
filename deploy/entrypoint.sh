#!/bin/sh
# Arranque de la imagen única: pdf-extract (Python) en segundo plano + migraciones + API (Node).
set -e

# pdf-extract solo escucha en localhost. Si se cae se reinicia solo; la API degrada al OCR
# completo mientras no responde (PDF_TEXT_MODE=off lo desactiva del todo).
if [ "${PDF_TEXT_MODE:-auto}" != "off" ]; then
  (
    cd /srv/pdf-extract
    while true; do
      /opt/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 || true
      sleep 2
    done
  ) &
fi

node_modules/.bin/prisma migrate deploy
exec node dist/main.js
