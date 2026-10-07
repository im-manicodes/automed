#!/usr/bin/env bash
# Construye el instalable de escritorio de auto-med (Linux: AppImage + deb; Windows: NSIS .exe).
#
#   ./scripts/build-desktop.sh                 construye el instalable del sistema donde corres el script
#   ./scripts/build-desktop.sh linux | win     igual, indicando el destino (debe coincidir con tu sistema)
#   ./scripts/build-desktop.sh all             construye LINUX Y WINDOWS en GitHub Actions y descarga los dos
#   opciones: --smoke (prueba de humo del paquete, solo local) · --dry-run (muestra qué haría)
#             --clean (borra la carpeta release antes) · --ref <rama> (solo "all") · --out <carpeta> (solo "all")
#
# No necesitas haber instalado node_modules: en modo local el script instala pnpm y las dependencias
# solo (necesita Node 22 o superior). El modo "all" no necesita ni Node: solo `gh` (GitHub CLI) con sesión.
#
# POR QUÉ no se construye todo en un solo equipo: el paquete lleva módulos nativos y binarios de Postgres
# propios de cada sistema (@napi-rs/canvas, @node-rs/argon2, embedded-postgres). Un .exe hecho en Linux
# llevaría binarios de Linux y no funcionaría. Por eso Windows se construye en Windows o en la nube.
# En Windows ejecuta este script desde "Git Bash".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET="auto"
SMOKE=0
DRY=0
CLEAN=0
REF=""
SHIM=""
OUT="$ROOT/release-desktop"

die() { printf '\n%s\n\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
usage() { sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    auto | linux | win | all) TARGET="$1" ;;
    --smoke) SMOKE=1 ;;
    --dry-run) DRY=1 ;;
    --clean) CLEAN=1 ;;
    --ref) shift; [ $# -gt 0 ] || die "--ref necesita un valor (rama o tag)."; REF="$1" ;;
    --out) shift; [ $# -gt 0 ] || die "--out necesita una carpeta."; OUT="$(mkdir -p "$1" && cd "$1" && pwd)" ;;
    -h | --help) usage; exit 0 ;;
    *) die "Opción o destino desconocido: $1. Usa --help para ver cómo se usa." ;;
  esac
  shift
done

case "$(uname -s)" in
  Linux*) HERE="linux" ;;
  MINGW* | MSYS* | CYGWIN*) HERE="win" ;;
  *) die "Este sistema ($(uname -s)) no está soportado. El instalable es para Linux y Windows." ;;
esac

# Ejecuta (o solo muestra, con --dry-run) un comando.
run() {
  printf '\n$ %s\n' "$*"
  [ "$DRY" -eq 1 ] || "$@"
}

nombre() { [ "$1" = "win" ] && echo "Windows" || echo "Linux"; }

# ───────────────────────── Modo nube: Linux + Windows en GitHub Actions ─────────────────────────
build_cloud() {
  command -v gh > /dev/null 2>&1 || die "Para construir ambos hace falta GitHub CLI (gh). Instálalo desde https://cli.github.com y ejecuta: gh auth login"
  gh auth status > /dev/null 2>&1 || die "gh no tiene sesión iniciada. Ejecuta: gh auth login"
  command -v git > /dev/null 2>&1 || die "Falta git."

  local ref="${REF:-$(git rev-parse --abbrev-ref HEAD)}"
  if [ "$ref" = "HEAD" ]; then die "Estás en un HEAD desacoplado. Indica la rama o tag con --ref <nombre>."; fi

  if [ -n "$(git status --porcelain)" ]; then
    say "AVISO: tienes cambios sin commit. GitHub construirá lo que haya subido a '$ref', no tus cambios locales."
  fi
  if git rev-parse --abbrev-ref "$ref@{u}" > /dev/null 2>&1 && [ "$(git rev-list --count "$ref@{u}..$ref")" -gt 0 ]; then
    say "AVISO: '$ref' tiene commits sin subir (git push). GitHub construirá la versión que ya está en el repositorio."
  fi

  say "Construyendo Linux y Windows en GitHub Actions (rama/tag: $ref)…"
  local desde
  desde="$(date -u -d '-60 seconds' +%Y-%m-%dT%H:%M:%SZ)"
  run gh workflow run release-desktop.yml --ref "$ref" -f publish=false

  if [ "$DRY" -eq 1 ]; then
    run gh run list --workflow release-desktop.yml --branch "$ref" --event workflow_dispatch --limit 5
    run gh run watch "<id-de-la-ejecución>" --exit-status
    run gh run download "<id-de-la-ejecución>" --dir "$OUT"
    say; say "(--dry-run: no se ejecutó nada)"
    return 0
  fi

  local id=""
  for _ in $(seq 1 45); do
    id="$(gh run list --workflow release-desktop.yml --branch "$ref" --event workflow_dispatch --limit 10 \
      --json databaseId,createdAt --jq "[.[] | select(.createdAt >= \"$desde\")] | sort_by(.createdAt) | last | .databaseId // empty")"
    [ -n "$id" ] && break
    sleep 2
  done
  [ -n "$id" ] || die "No encontré la ejecución recién lanzada. Revísala en la pestaña Actions de GitHub."

  say "Ejecución: $id (puedes verla en la pestaña Actions). Esperando a que termine, suele tardar varios minutos…"
  gh run watch "$id" --exit-status || die "La construcción falló en GitHub. Revisa el detalle con: gh run view $id --log-failed"

  rm -rf "$OUT"
  mkdir -p "$OUT"
  gh run download "$id" --dir "$OUT"
  say; say "Listo. Instaladores descargados en $OUT:"
  find "$OUT" -type f \( -name '*.AppImage' -o -name '*.deb' -o -name '*.exe' \) -exec ls -lh {} \; | awk '{print "  " $9 "  (" $5 ")"}'
  say; say "Nota: el instalador de Windows pasó la prueba de humo en GitHub, pero no se ha probado a mano en un Windows real."
}

# ───────────────────────── Modo local: el sistema donde corres el script ─────────────────────────
build_local() {
  local dest="$1"
  command -v node > /dev/null 2>&1 || die "Falta Node.js 22 o superior. Instálalo desde https://nodejs.org (o con nvm/fnm) y vuelve a ejecutar."
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  [ "$major" -ge 22 ] || die "Tienes Node $(node -v) y se necesita 22 o superior. Actualízalo desde https://nodejs.org"

  # pnpm: se activa con corepack (viene con Node) en una carpeta temporal, sin tocar el sistema.
  SHIM="$(mktemp -d)"
  trap '[ -z "$SHIM" ] || rm -rf "$SHIM"' EXIT
  local pm
  pm="$(node -p "require('./package.json').packageManager || ''")"
  say "Preparando pnpm (${pm:-versión por defecto})…"
  if [ "$DRY" -eq 1 ]; then
    printf '\n$ corepack enable --install-directory <temporal>\n'
  else
    command -v corepack > /dev/null 2>&1 || die "Falta corepack (viene con Node 22). Reinstala Node desde https://nodejs.org"
    corepack enable --install-directory "$SHIM" || die "No se pudo activar pnpm con corepack."
    export PATH="$SHIM:$PATH"
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  fi

  # Dependencias: solo si faltan, el lockfile cambió o node_modules quedó sin devDependencies
  # (un empaquetado previo puede dejarlo así; sin tsc/vite el build falla).
  if [ ! -f node_modules/.modules.yaml ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ] \
    || grep -A3 '"included"' node_modules/.modules.yaml | grep -q '"devDependencies": false'; then
    say "Instalando dependencias (primera vez: puede tardar unos minutos)…"
    if [ "$DRY" -eq 1 ]; then printf '\n$ CI=true pnpm install --frozen-lockfile\n'; else CI=true pnpm install --frozen-lockfile; fi
  else
    say "Dependencias al día (node_modules)."
  fi

  # El empaquetado (pnpm deploy / electron-builder) reinstala por su cuenta y cambia el estado de node_modules;
  # sin esto, pnpm intenta `pnpm install --production` antes de cada comando y aborta sin terminal.
  export pnpm_config_verify_deps_before_run=false

  if [ "$SMOKE" -eq 1 ] && [ "$dest" = "linux" ] && [ -z "${DISPLAY:-}" ] && ! command -v xvfb-run > /dev/null 2>&1; then
    die "La prueba de humo en Linux necesita xvfb (pantalla virtual). Instálalo con: sudo apt install xvfb"
  fi

  local args=("$dest")
  [ "$SMOKE" -eq 1 ] && args+=(--smoke)
  [ "$CLEAN" -eq 1 ] && args+=(--clean)
  [ "$DRY" -eq 1 ] && args+=(--dry-run)
  run node apps/desktop/scripts/dist.mjs "${args[@]}"
}

# ───────────────────────── Despacho ─────────────────────────
case "$TARGET" in
  all) build_cloud ;;
  auto) build_local "$HERE" ;;
  linux | win)
    if [ "$TARGET" != "$HERE" ]; then
      die "No se puede construir el instalable de $(nombre "$TARGET") desde $(nombre "$HERE"): el paquete lleva binarios propios de cada sistema.
Opciones:
  · ejecuta este script en un $(nombre "$TARGET"), o
  · construye en la nube (Linux y Windows a la vez):  ./scripts/build-desktop.sh all"
    fi
    build_local "$TARGET"
    ;;
esac
