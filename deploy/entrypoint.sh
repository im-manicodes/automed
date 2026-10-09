#!/bin/bash
# Arranque de la imagen única: migraciones y API (Node). La API supervisa el OCR local (en /models).
set -e

node_modules/.bin/prisma migrate deploy
exec node dist/main.js
