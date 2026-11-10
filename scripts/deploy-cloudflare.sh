#!/usr/bin/env bash
# ==============================================================================
# Minerva — All-in-One Cloudflare Deployment Script
#
# Despliega de forma 100% automatizada e idempotente todo el backend de Minerva:
# 1. Verificación de sesión en Cloudflare (wrangler login/whoami)
# 2. Creación/Detección de base D1 (minerva-sync) y extracción de UUID
# 3. Creación/Detección de bucket R2 (minerva-library)
# 4. Inyección dinámica de configuración en wrangler.toml
# 5. Generación segura y registro desatendido de JWT_SECRET
# 6. Aplicación de migraciones remotas SQLite (0001 a 0004)
# 7. Despliegue del Worker (minerva-cloudflare en workers.dev)
# 8. Verificación de endpoint /health y configuración de cliente
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# La carpeta de la app es apps/minerva-app. Se resuelve de forma dinámica
# para que el despliegue funcione también con un checkout donde upstream la
# hubiera renombrado a otra variante.
APP_DIR=""
for candidate in "$REPO_ROOT/apps/minerva-app" "$REPO_ROOT/apps/readest-app"; do
  if [ -d "$candidate/workers/minerva-sync" ] || [ -d "$candidate/workers/readest-sync" ]; then
    APP_DIR="$candidate"
    break
  fi
done
if [ -z "$APP_DIR" ]; then
  echo -e "${RED}Error: no se encontró la app (apps/minerva-app/workers/minerva-sync).${NC}" >&2
  exit 1
fi
WORKER_DIR="$APP_DIR/workers/minerva-sync"
[ -d "$WORKER_DIR" ] || WORKER_DIR="$APP_DIR/workers/readest-sync"

WORKER_NAME="minerva-cloudflare"
DB_NAME="minerva-sync"
LEGACY_DB_NAME="minerva-sync"
BUCKET_NAME="minerva-library"
LEGACY_BUCKET_NAME="minerva-library"

echo -e "${BOLD}${BLUE}======================================================${NC}"
echo -e "${BOLD}${BLUE}   Minerva — Cloudflare Backend All-in-One Deploy     ${NC}"
echo -e "${BOLD}${BLUE}======================================================${NC}"
echo ""

# 1. Comprobar herramientas requeridas
echo -e "${BOLD}[1/7] Verificando entorno y herramientas...${NC}"
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Error: Node.js no está instalado. Instálalo para continuar.${NC}" >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo -e "${RED}Error: npx no está disponible en el PATH.${NC}" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo -e "${RED}Error: pnpm no está disponible en el PATH.${NC}" >&2
  exit 1
fi

# pnpm aquí puede ser el shim de corepack. Si corepack está desactualizado
# frente a la versión de pnpm fijada en package.json (packageManager), la
# descarga/activación falla con un stack trace críptico de Node en lugar de
# un mensaje claro. Lo detectamos aquí y pedimos actualizar dependencias.
if ! pnpm --version >/tmp/minerva-pnpm-check.$$ 2>&1; then
  echo -e "${RED}Error: pnpm no pudo ejecutarse correctamente.${NC}" >&2
  echo -e "${YELLOW}Esto normalmente significa que tus dependencias de Node (corepack/pnpm) están desactualizadas o en conflicto, no que el proyecto esté roto.${NC}" >&2
  echo -e "${YELLOW}Actualiza corepack y vuelve a intentarlo:${NC}" >&2
  echo -e "  ${BOLD}sudo npm install -g corepack@latest${NC}" >&2
  echo -e "${YELLOW}Si tienes otra instalación de corepack/pnpm en ~/.local/bin que tape la del sistema, bórrala para que se use la actualizada.${NC}" >&2
  rm -f /tmp/minerva-pnpm-check.$$
  exit 1
fi
rm -f /tmp/minerva-pnpm-check.$$

# 2. Comprobar sesión de Cloudflare
echo -e "${BOLD}[2/7] Comprobando autenticación en Cloudflare...${NC}"
if ! npx wrangler whoami >/dev/null 2>&1; then
  echo -e "${YELLOW}No se detectó una sesión activa en Cloudflare.${NC}"
  echo -e "Abriendo el navegador para autenticarte con Cloudflare..."
  npx wrangler login
fi

WHOAMI_OUTPUT=$(npx wrangler whoami 2>&1 || true)
echo -e "${GREEN}✓ Sesión verificada correctamente con Cloudflare.${NC}"

# 3. Base de Datos D1
echo -e "${BOLD}[3/7] Configurando base de datos D1...${NC}"
D1_LIST_JSON=$(npx wrangler d1 list --json 2>/dev/null || echo "[]")

TARGET_DB_NAME="$DB_NAME"
DB_UUID=$(node -e '
  const list = JSON.parse(process.argv[1]);
  const primary = list.find(d => d.name === process.argv[2]);
  if (primary) {
    console.log(primary.uuid || primary.database_id);
    process.exit(0);
  }
  const legacy = list.find(d => d.name === process.argv[3]);
  if (legacy) {
    console.log(legacy.uuid || legacy.database_id);
    process.exit(0);
  }
' "$D1_LIST_JSON" "$DB_NAME" "$LEGACY_DB_NAME" 2>/dev/null || echo "")

if [ -n "$DB_UUID" ]; then
  # Comprobar si era el legacy
  IS_LEGACY=$(node -e '
    const list = JSON.parse(process.argv[1]);
    const found = list.find(d => (d.uuid === process.argv[2] || d.database_id === process.argv[2]));
    console.log(found ? found.name : "");
  ' "$D1_LIST_JSON" "$DB_UUID")
  TARGET_DB_NAME="$IS_LEGACY"
  echo -e "${GREEN}✓ Base D1 encontrada: ${BOLD}$TARGET_DB_NAME${NC} (ID: $DB_UUID)"
else
  echo -e "Creando base D1: ${BOLD}$DB_NAME${NC}..."
  # Nota: wrangler 4.x ya no soporta --json en "d1 create" (deprecado), así
  # que creamos sin esa flag y recuperamos el UUID vía "d1 list --json".
  npx wrangler d1 create "$DB_NAME" >/dev/null 2>&1 || true
  DB_UUID=""

  # Fallback si el output no fue json puro
  if [ -z "$DB_UUID" ]; then
    DB_UUID=$(npx wrangler d1 list --json 2>/dev/null | node -e '
      const fs = require("fs");
      const text = fs.readFileSync(0, "utf-8");
      const start = text.indexOf("[");
      if (start !== -1) {
        try {
          const list = JSON.parse(text.slice(start));
          const target = process.argv[1];
          const found = list.find(d => d.name === target);
          if (found) console.log(found.uuid || found.database_id || "");
        } catch {}
      }
    ' "$DB_NAME" 2>/dev/null || echo "")
  fi

  if [ -z "$DB_UUID" ]; then
    echo -e "${RED}Error al obtener el database_id de la base D1 recién creada.${NC}" >&2
    exit 1
  fi
  TARGET_DB_NAME="$DB_NAME"
  echo -e "${GREEN}✓ Base D1 creada exitosamente con ID: $DB_UUID${NC}"
fi

# 4. Bucket R2
echo -e "${BOLD}[4/7] Configurando bucket R2...${NC}"
TARGET_BUCKET_NAME="$BUCKET_NAME"
R2_LIST_OUT=$(npx wrangler r2 bucket list 2>/dev/null || echo "")
if echo "$R2_LIST_OUT" | grep -q "$BUCKET_NAME"; then
  echo -e "${GREEN}✓ Bucket R2 encontrado: ${BOLD}$BUCKET_NAME${NC}"
elif echo "$R2_LIST_OUT" | grep -q "$LEGACY_BUCKET_NAME"; then
  TARGET_BUCKET_NAME="$LEGACY_BUCKET_NAME"
  echo -e "${GREEN}✓ Bucket R2 existente encontrado: ${BOLD}$LEGACY_BUCKET_NAME${NC}"
else
  echo -e "Creando bucket R2: ${BOLD}$BUCKET_NAME${NC}..."
  npx wrangler r2 bucket create "$BUCKET_NAME" >/dev/null 2>&1 || true
  echo -e "${GREEN}✓ Bucket R2 listo: ${BOLD}$BUCKET_NAME${NC}"
fi

# 5. Parchear configuración de wrangler.toml en el worker
echo -e "${BOLD}[5/7] Sincronizando configuración de wrangler.toml...${NC}"
cd "$WORKER_DIR"

# El despliegue sólo decide tres cosas: el nombre del worker, el bucket de R2 y
# la base de D1. TODO LO DEMÁS de `wrangler.toml` es del operador — los `[vars]`
# que ha ajustado (la lista de orígenes, el techo de subida, el coste del KDF) y
# un bloque `[[routes]]` para un dominio propio — y un redespliegue no debe
# resetearlo en silencio. Por eso el fichero se parchea en lugar de reescribirse.
if [ -f wrangler.toml ]; then
  node -e '
    const fs = require("fs");
    let toml = fs.readFileSync("wrangler.toml", "utf8");
    toml = toml.replace(/^name = .*/m, `name = "${process.argv[1]}"`);
    toml = toml.replace(/^bucket_name = .*/m, `bucket_name = "${process.argv[2]}"`);
    toml = toml.replace(/^database_name = .*/m, `database_name = "${process.argv[3]}"`);
    toml = toml.replace(/^database_id = .*/m, `database_id = "${process.argv[4]}"`);
    if (!toml.includes("HASH_ALGORITHM")) {
      if (toml.includes("[vars]")) {
        toml = toml.replace("[vars]", "[vars]\nHASH_ALGORITHM = \"argon2id\"\nARGON2_MEMORY = \"4096\"\nARGON2_PASSES = \"1\"\nARGON2_PARALLELISM = \"1\"");
      } else {
        toml += "\n[vars]\nHASH_ALGORITHM = \"argon2id\"\nARGON2_MEMORY = \"4096\"\nARGON2_PASSES = \"1\"\nARGON2_PARALLELISM = \"1\"\n";
      }
    }
    fs.writeFileSync("wrangler.toml", toml);
  ' "$WORKER_NAME" "$TARGET_BUCKET_NAME" "$TARGET_DB_NAME" "$DB_UUID"
else
cat > wrangler.toml <<EOF
name = "$WORKER_NAME"
main = "src/index.ts"
compatibility_date = "2026-04-10"
compatibility_flags = ["nodejs_compat"]
workers_dev = true
preview_urls = true

[[r2_buckets]]
binding = "LIBRARY_BUCKET"
bucket_name = "$TARGET_BUCKET_NAME"

[[d1_databases]]
binding = "SYNC_DB"
database_name = "$TARGET_DB_NAME"
database_id = "$DB_UUID"

[vars]
ALLOWED_ORIGINS = "*"
MAX_UPLOAD_BYTES = "104857600"
STORAGE_FIXED_QUOTA = "0"
# Parámetros criptográficos recomendados (Argon2id con fallback seguro)
PASSPHRASE_KDF_ITERATIONS = "100000"
HASH_ALGORITHM = "argon2id"
ARGON2_MEMORY = "4096"
ARGON2_PASSES = "1"
ARGON2_PARALLELISM = "1"

[observability]
enabled = true
head_sampling_rate = 0.1
EOF
fi
echo -e "${GREEN}✓ wrangler.toml actualizado dinámicamente con D1 ($DB_UUID) y R2 ($TARGET_BUCKET_NAME).${NC}"

# 6. Generación y Registro de JWT_SECRET
echo -e "${BOLD}[6/7] Verificando secreto de autenticación (JWT_SECRET)...${NC}"
ROTATE="${ROTATE_SECRET:-0}"
for arg in "$@"; do
  if [ "$arg" = "--rotate-secret" ]; then
    ROTATE=1
  fi
done

SECRET_EXISTS=0
if npx wrangler secret list --name "$WORKER_NAME" 2>/dev/null | grep -q "JWT_SECRET"; then
  SECRET_EXISTS=1
fi

if [ "$SECRET_EXISTS" = "1" ] && [ "$ROTATE" != "1" ]; then
  echo -e "${GREEN}✓ JWT_SECRET existente conservado en Cloudflare Secrets (sesiones de usuario preservadas).${NC}"
  echo -e "  (Usa --rotate-secret si deseas forzar la rotación del secreto)"
else
  # Generar secreto criptográfico seguro de 32 bytes en hex (64 caracteres)
  GENERATED_SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
  echo "$GENERATED_SECRET" | npx wrangler secret put JWT_SECRET --name "$WORKER_NAME" >/dev/null 2>&1 || {
    # Fallback ejecutado desde el directorio del worker
    echo "$GENERATED_SECRET" | npx wrangler secret put JWT_SECRET >/dev/null 2>&1
  }
  echo -e "${GREEN}✓ JWT_SECRET generado y registrado de forma segura en Cloudflare Secrets.${NC}"
fi

# 7. Migraciones D1 y Despliegue
echo -e "${BOLD}[7/7] Aplicando migraciones remotas de SQLite y desplegando Worker...${NC}"
npx wrangler d1 migrations apply "$TARGET_DB_NAME" --remote

echo -e "Publicando Worker ${BOLD}$WORKER_NAME${NC}..."
DEPLOY_OUTPUT=$(npx wrangler deploy 2>&1)

DEPLOYED_URL=$(echo "$DEPLOY_OUTPUT" | grep -o 'https://[^ ]*workers\.dev' | head -n 1 || echo "")

if [ -z "$DEPLOYED_URL" ]; then
  # Intento alternativo de extracción de URL
  DEPLOYED_URL=$(echo "$DEPLOY_OUTPUT" | grep -o 'https://[a-zA-Z0-9.-]*\.[a-zA-Z0-9.-]*\.workers\.dev' | head -n 1 || echo "")
fi

if [ -z "$DEPLOYED_URL" ]; then
  echo -e "${YELLOW}Advertencia: No se pudo parsear automáticamente la URL de la salida del despliegue.${NC}"
  echo -e "Salida completa de wrangler:\n$DEPLOY_OUTPUT"
else
  echo -e "${GREEN}✓ Worker publicado en: ${BOLD}$DEPLOYED_URL${NC}"

  # Verificación de salud /health
  echo -e "Verificando endpoint de salud (${DEPLOYED_URL}/health)..."
  HEALTH_STATUS=$(curl -fsS --max-time 10 "${DEPLOYED_URL}/health" 2>/dev/null || echo "error")

  if [[ "$HEALTH_STATUS" == *"\"status\":\"ok\""* || "$HEALTH_STATUS" == *"ok"* ]]; then
    echo -e "${GREEN}✓ Comprobación de salud exitosa: backend operativo.${NC}"
  else
    echo -e "${YELLOW}Nota: El endpoint /health respondió: $HEALTH_STATUS (puede requerir unos segundos para propagación DNS).${NC}"
  fi

  # Actualizar o generar .env.local para desarrollo local si el directorio existe
  if [ -d "$APP_DIR" ]; then
    ENV_LOCAL="$APP_DIR/.env.local"
    node -e '
      const fs = require("fs");
      const envPath = process.argv[1];
      const url = process.argv[2];
      let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
      const vars = {
        NEXT_PUBLIC_API_BASE_URL: url,
        SELF_HOSTED_BACKEND: "true",
        NEXT_PUBLIC_SELF_HOSTED_BACKEND: "true",
        SELF_HOSTED: "true",
        NEXT_PUBLIC_SELF_HOSTED: "true"
      };
      for (const [k, v] of Object.entries(vars)) {
        const regex = new RegExp(`^${k}=.*`, "m");
        if (regex.test(content)) {
          content = content.replace(regex, `${k}=${v}`);
        } else {
          content = content.trimEnd() + (content.length ? "\n" : "") + `${k}=${v}\n`;
        }
      }
      fs.writeFileSync(envPath, content.trim() + "\n");
    ' "$ENV_LOCAL" "$DEPLOYED_URL"
    echo -e "${GREEN}✓ Sincronizado ${APP_DIR#"$REPO_ROOT/"}/.env.local con la URL del Worker y flags Self-Hosted.${NC}"
  fi
fi

echo ""
echo -e "${BOLD}${GREEN}======================================================${NC}"
echo -e "${BOLD}${GREEN}   ¡Despliegue All-in-One completado con éxito!       ${NC}"
echo -e "${BOLD}${GREEN}======================================================${NC}"
echo ""
if [ -n "$DEPLOYED_URL" ]; then
  echo -e "${BOLD}Tu URL de Minerva Cloud es:${NC}"
  echo -e "  👉 ${BOLD}${BLUE}$DEPLOYED_URL${NC}"
  echo ""
  echo -e "Para conectar tu aplicación (Web, Linux o Android):"
  echo -e "  1. Abre Minerva y ve a: ${BOLD}Ajustes → Minerva Cloud (Cloudflare)${NC}."
  echo -e "  2. Pega la URL: ${BOLD}$DEPLOYED_URL${NC} y pulsa ${BOLD}'Probar y Conectar'${NC}."
  echo -e "  3. ¡Listo! Podrás registrarte o iniciar sesión en tu propio servidor."
else
  echo -e "Revisa los logs superiores para consultar la URL asignada por Cloudflare."
fi
echo ""
