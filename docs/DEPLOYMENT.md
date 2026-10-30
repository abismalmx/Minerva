# Minerva — Despliegue y verificación del backend nativo en Cloudflare

Runbook operativo para `apps/minerva-app/workers/minerva-sync/`. Cubre el
despliegue desde cero, la verificación automatizada y la verificación manual
entre dispositivos.

---

## 0. Requisitos

| Recurso | Comando | Notas |
| --- | --- | --- |
| Cuenta Cloudflare | — | El plan gratuito no pide tarjeta. |
| Base D1 | `wrangler d1 create minerva-sync` | Copiar el `database_id` a `wrangler.toml`. |
| Bucket R2 | `wrangler r2 bucket create minerva-library` | Los libros, las portadas y los blobs de las réplicas. |
| Secreto del Worker | `wrangler secret put JWT_SECRET` | 32+ caracteres aleatorios. **Nunca** en `wrangler.toml`. |

---

## 1. Despliegue All-in-One (Recomendado)

Todo el proceso de aprovisionamiento en Cloudflare (D1, R2, JWT_SECRET, migraciones y publicación del Worker `minerva-cloudflare`) se ejecuta en **un solo comando desatendido**:

```bash
# Desde la raíz de Minerva:
./deploy-cloudflare.sh

# O desde readest/:
pnpm deploy:cloudflare
```

El script se encarga automáticamente de:
1. Validar sesión en Cloudflare (`wrangler whoami` / `wrangler login`).
2. Crear la base D1 `minerva-sync` (o detectar una existente) y extraer su UUID.
3. Crear el bucket R2 `minerva-library` de forma idempotente.
4. Generar criptográficamente un `JWT_SECRET` seguro de 32 bytes y registrarlo en Cloudflare Secrets.
5. Inyectar los identificadores en `wrangler.toml`.
6. Aplicar las migraciones remotas de SQLite (`0001` a `0004`).
7. Publicar el Worker `minerva-cloudflare` en `*.workers.dev`.
8. Comprobar el endpoint de salud `curl /health` y mostrar la URL lista para usar.

---

## 1.1 Conexión In-App desde Minerva (Sin Recompilar)

Cualquier cliente (Web, Linux de escritorio o APK Android):
1. Abre **Ajustes → Sincronización → Minerva Cloud (Cloudflare)**.
2. Pega la URL generada (`https://minerva-cloudflare.<tu-subdominio>.workers.dev`).
3. Pulsa **Probar Conexión** y luego **Guardar y Activar**.
4. La aplicación guardará la URL en almacenamiento local y conmutará en caliente a modo auto-hospedado desbloqueando registro e inicio de sesión inmediatos.

---

## 1.2 Despliegue Manual (Paso a paso alternativo)

```bash
cd readest/apps/minerva-app/workers/minerva-sync

# 1. Aplicar el esquema (contra la base real).
pnpm migrate:remote

# 2. Publicar el Worker.
pnpm deploy

# 3. Anotar la URL.
#    https://minerva-cloudflare.<subdominio>.workers.dev
```

### Variables de entorno

| Variable | Por defecto | Para qué sirve |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `*` | Orígenes del navegador autorizados. Con `*`, el `Authorization` se refleja explícitamente (la especificación de Fetch no empareja comodines con `Authorization`), así que no hay un preflight extra por petición. |
| `MAX_UPLOAD_BYTES` | `104857600` | Tope por subida. El límite de la plataforma es 100 MB en el plan gratuito. |
| `STORAGE_FIXED_QUOTA` | `0` | Cuota por cuenta, en bytes. `0` = sin cuota configurada. Se **aplica** al subir, no solo se informa. |
| `JWT_SECRET` | — | Secreto. Sin él, las rutas autenticadas responden `503` (fallo cerrado). |

### Apuntar la aplicación

En `apps/minerva-app/.env.local`:

```dotenv
NEXT_PUBLIC_API_BASE_URL=https://<tu-worker>.workers.dev
SELF_HOSTED_BACKEND=true
NEXT_PUBLIC_SELF_HOSTED_BACKEND=true
```

`getAPIBaseUrl()` (src/services/environment.ts) añade el `/api` por su cuenta:
la aplicación llama a `<origen>/api/sync`, `<origen>/api/storage/upload`, etc.

---

## 2. Verificación automatizada

```bash
# Tipado del Worker (0 errores).
cd readest/apps/minerva-app/workers/minerva-sync && pnpm typecheck

# Tipado de la aplicación (incluye los ficheros del Worker que importan los tests).
cd readest/apps/minerva-app && npx tsc --noEmit

# Suite del Worker: 134 pruebas sobre las migraciones reales en SQLite.
cd readest/apps/minerva-app && pnpm test --run src/__tests__/workers/

# Lint y formato.
cd readest && npx biome check apps/minerva-app/workers/minerva-sync apps/minerva-app/src/__tests__/workers
```

> **Nota sobre la suite completa de la aplicación.** Vitest no carga el
> `.env` de la aplicación en `process.env`, y `src/utils/supabase.ts` lee
> `NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64` con una aserción no nula: sin esa
> variable, `atob(undefined)` lanza `InvalidCharacterError` en el momento de
> importar el módulo y **cualquier** fichero de test que importe
> `src/utils/access.ts` falla en la colección (424 de los 1216 ficheros en este
> entorno). No tiene relación con el backend; para ejecutar la suite completa
> hay que exportar las dos variables:
>
> ```bash
> cd readest/apps/minerva-app
> set -a && . ./.env && set +a
> pnpm test
> ```

La suite `src/__tests__/workers/` ejecuta las **migraciones reales** contra
una base SQLite en memoria, de modo que un esquema roto falla el test y no la
producción.

---

## 3. Verificación con el Worker en local

```bash
cd readest/apps/minerva-app/workers/minerva-sync

pnpm migrate        # aplica el esquema al D1 local
pnpm dev            # wrangler dev en http://localhost:8787
```

Comprobaciones rápidas:

```bash
curl -s http://localhost:8787/health
# {"status":"ok"}

TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"a@example.com","passphrase":"correct horse battery staple"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

curl -s http://localhost:8787/api/auth/me -H "authorization: Bearer $TOKEN"
```

---

## 4. Verificación manual entre dispositivos

### 4.1 Android ↔ Linux

1. Instalar el APK en el dispositivo:
   ```bash
   cd readest/apps/minerva-app
   pnpm tauri android build -t aarch64
   adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
   ```
2. En ambos dispositivos: **Ajustes → Sync → URL del backend** = la del Worker;
   iniciar sesión con el mismo email y passphrase.
3. **Lectura:** avanzar 20 páginas en Linux → en Android, la barra de posición
   debe reflejarlo tras el siguiente ciclo de sincronización.
4. **Notas y resaltados:** crear una nota en Android → debe aparecer en Linux.
5. **Portadas y metadatos:** editar el título en un dispositivo → el otro debe
   mostrarlo. La portada y los metadatos llevan su propio reloj: un cambio de
   portada no puede pisar un cambio de título.
6. **Ajustes y estantes** (réplicas): cambiar un ajuste de sincronización en
   Linux → debe verse en Android. Este recorrido es el que ejercita el pull
   por lotes (`POST /api/sync/replicas` con `{ cursors }`).

### 4.2 Comprobaciones de red

- El tráfico a Supabase debe ser **cero** (DevTools → Network).
- El tráfico del Worker debe estar limitado a las rutas `/api/*` y a las
  URLs firmadas de `/api/storage/object`.

---

## 5. Verificación del almacenamiento

```bash
# Lo que hay en el bucket.
cd readest/apps/minerva-app/workers/minerva-sync
npx wrangler r2 object list --bucket minerva-library --local

# Lo que hay en la base.
npx wrangler d1 execute minerva-sync --local --command \
  "SELECT user_id, file_key, file_size, deleted_at FROM files;"
```

---

## 6. Mantenimiento

| Tarea | Comando |
| --- | --- |
| Rotar el secreto | `wrangler secret put JWT_SECRET` ( invalida los tokens emitidos; el cliente vuelve a iniciar sesión ) |
| Ver las migraciones aplicadas | `npx wrangler d1 migrations list minerva-sync --remote` |
| Ver los logs | `npx wrangler tail` |
| Descargar la base (copia de seguridad) | `npx wrangler d1 export minerva-sync --remote --output backup.sql` |

Las copias de seguridad de los **archivos** no las hace el Worker: exporta el
bucket con `wrangler r2` o replicas desde el propio cliente.

---

## 7. Rollback

- **Worker:** `wrangler rollback` devuelve al despliegue anterior. La base no
  se toca, así que un rollback del código es seguro mientras la migración
  nueva no haya cambiado el esquema.
- **Esquema:** las migraciones de este Worker solo **añaden** (o reconstruyen
  `replicas`, conservando los datos). Para volver atrás hay que exportar la
  base antes de aplicar y restaurarla con `wrangler d1 execute`.

---

## 8. Limitaciones conocidas

| Limitación | Consecuencia |
| --- | --- |
| Sin correo | No hay enlace mágico, ni recuperación de contraseña, ni OAuth. |
| 100 MB por subida | Los libros mayores que el tope de la plataforma no caben. |
| Token de 30 días | El cliente revalida con `GET /api/auth/me` en cada arranque. |
| Cuota única para toda la cuenta | `STORAGE_FIXED_QUOTA` no distingue entre usuarios; es el límite del operador. |
| Sin purga programable | `DELETE /api/storage/purge` borra en bloque hasta 100 claves por petición. |
