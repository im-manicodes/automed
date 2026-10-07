#!/usr/bin/env bash
# Prepara Dokku para auto-med (una vez; es idempotente y se puede repetir para aplicar cambios del env).
# Ejecutar COMO ROOT en el Droplet, con Dokku ya instalado:
#   GHCR_USER=<usuario> GHCR_TOKEN=<PAT read:packages> ./bootstrap.sh /root/automed.env
# Crea: red interna, apps api/web/pdf-extract/rustfs, Postgres (plugin), HTTPS (Let's Encrypt) y config.
# Las apps api/web/pdf-extract se despliegan después desde GitHub Actions (imágenes de GHCR).
set -euo pipefail

ENV_FILE="${1:?Uso: GHCR_USER=... GHCR_TOKEN=... $0 /ruta/automed.env}"
: "${GHCR_USER:?Define GHCR_USER}" "${GHCR_TOKEN:?Define GHCR_TOKEN}"
[ "$(id -u)" = 0 ] || { echo "Ejecuta como root"; exit 1; }

set -a; . "$ENV_FILE"; set +a
: "${DOMAIN:?}" "${LETSENCRYPT_EMAIL:?}" "${S3_ACCESS_KEY:?}" "${S3_SECRET_KEY:?}" "${JWT_SECRET:?}" "${TOKEN_ENC_KEY:?}"

NET=automed
DB=automed-db

echo "== Plugins =="
dokku plugin:installed postgres    || dokku plugin:install https://github.com/dokku/dokku-postgres.git --name postgres
dokku plugin:installed letsencrypt || dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git --name letsencrypt

echo "== Registro de imágenes (GHCR) =="
dokku registry:login ghcr.io "$GHCR_USER" "$GHCR_TOKEN"

echo "== Red interna y apps =="
dokku network:exists "$NET" || dokku network:create "$NET"
for app in api web pdf-extract rustfs; do
  dokku apps:exists "$app" || dokku apps:create "$app"
  # Se unen a la red al crear el contenedor; se alcanzan como <app>.web (p. ej. http://api.web:3000).
  dokku network:set "$app" attach-post-create "$NET"
done
# Solo `web` se publica; api, pdf-extract y rustfs quedan accesibles únicamente desde la red interna.
for app in api pdf-extract rustfs; do dokku proxy:disable "$app"; done

echo "== PostgreSQL =="
dokku postgres:exists "$DB" || dokku postgres:create "$DB"
# `link` define DATABASE_URL en la api (si ya está enlazado, no hace nada).
dokku postgres:linked "$DB" api >/dev/null 2>&1 || dokku postgres:link "$DB" api --no-restart

echo "== Almacenamiento de RustFS =="
docker volume inspect automed-rustfs >/dev/null 2>&1 || docker volume create automed-rustfs >/dev/null
dokku storage:list rustfs 2>/dev/null | grep -q automed-rustfs || dokku storage:mount rustfs automed-rustfs:/data
dokku config:set --no-restart rustfs RUSTFS_ACCESS_KEY="$S3_ACCESS_KEY" RUSTFS_SECRET_KEY="$S3_SECRET_KEY"

echo "== Config de la api =="
args=(
  PORT=3000 NODE_ENV=production COOKIE_SECURE=true
  "WEB_ORIGIN=https://$DOMAIN"
  S3_ENDPOINT=http://rustfs.web:9000 S3_FORCE_PATH_STYLE=true
  PDF_EXTRACT_URL=http://pdf-extract.web:8001
)
# Todo el env salvo lo que solo usa este script.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; DOMAIN=*|LETSENCRYPT_EMAIL=*) continue ;; esac
  [ -n "${line#*=}" ] && args+=("$line")
done < "$ENV_FILE"
dokku config:set --no-restart api "${args[@]}"

echo "== web: dominio, upstream, tamaño de subida, HTTPS =="
dokku config:set --no-restart web API_UPSTREAM=http://api.web:3000
dokku domains:set web "$DOMAIN"
dokku ports:set web http:80:80
dokku nginx:set web client-max-body-size 50m
dokku letsencrypt:set web email "$LETSENCRYPT_EMAIL"

echo "== RustFS (imagen pública, se despliega ya) =="
dokku git:from-image rustfs rustfs/rustfs:latest

cat <<MSG

Listo. Siguientes pasos:
  1. Autoriza la clave SSH de GitHub Actions:  dokku ssh-keys:add github-actions < deploy_key.pub
  2. Haz push a main: el workflow despliega api, web y pdf-extract.
  3. Tras el primer despliegue de web, activa HTTPS:
       dokku letsencrypt:enable web && dokku letsencrypt:cron-job --add
  4. Crea el primer usuario:
       dokku enter api web node dist/cli/user.js create --email tu@correo.com --nombre "Tu nombre"
MSG
