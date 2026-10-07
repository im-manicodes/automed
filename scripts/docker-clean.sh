#!/usr/bin/env bash
# Libera disco de Docker: caché de build e imágenes sin uso. NUNCA toca volúmenes (BD, modelos, RustFS).
set -euo pipefail

docker builder prune -af
docker image prune -f
df -h /
