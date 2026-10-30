# Plan de Auto‑hosting de **Readest** en Cloudflare (español)

## 1. Descripción del objetivo
Crear un backend **totalmente auto‑hosteado** para **Readest** que funcione en **Cloudflare Workers**, use **R2** para almacenar los ebooks y **D1 (SQLite)** para los datos de usuarios, autenticación y metadatos de sincronización. El backend debe funcionar con el **APK oficial de Readest** (compilado desde el código fuente) en **Linux** y **Android**, sincronizando en tiempo real:

- Progreso de lectura (página/posición)
- Notas, resaltados y marcadores
- Metadatos de la biblioteca (portadas, títulos, autores)
- Configuración y preferencias
- Estadísticas (tiempo leído, sesiones)

Todo debe ser **gratuito** (sin necesidad de tarjeta de crédito) y usar **HTTPS** + una **passphrase** de sincronización para cifrado en tránsito.

## 2. Preguntas abiertas (para validar)
1. **Dominio** – ¿Prefieres usar un sub‑dominio personalizado (`sync.tudominio.com`) o el dominio `workers.dev` que provee Cloudflare?
2. **Gestión de la passphrase** – ¿Almacenar la passphrase solo del lado client (el usuario la escribe cada sesión) o guardarla cifrada en D1?
3. **Construcción del APK** – ¿Compilar el APK localmente con Gradle o usar CI de Cloudflare Pages para generar una versión firmada?

## 3. Cambios propuestos
### 3.1. Fork del repositorio
1. Fork de `https://github.com/readest/readest` a tu cuenta de GitHub.
2. Clona localmente y crea la rama `cloudflare-self-host`.

### 3.2. Recursos en Cloudflare
| Recurso | Acción | Comando |
|---------|--------|---------|
| **R2 bucket** | `readest-library` | `wrangler r2 bucket create readest-library` |
| **D1 database** | `readest-sync` con tablas `users`, `books`, `progress`, `notes` | `wrangler d1 create readest-sync` + migraciones (ver SQL bajo *2.2 D1 Database*). |
| **Workers** | `readest-sync` (worker) | `wrangler publish` después de los cambios. |

### 3.3. Variables de entorno (`.env.local.example`)
```dotenv
# Cloudflare
CF_ACCOUNT_ID=TU_ACCOUNT_ID
CF_R2_BUCKET=readest-library
CF_R2_ENDPOINT=https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com

# D1
CF_D1_DATABASE_ID=readest-sync
CF_D1_DATABASE_URL=https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}

# Passphrase de sincronización
NEXT_PUBLIC_SYNC_PASSPHRASE=TU_PASSPHRASE

# Opcionales (PostHog)
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=
```

### 3.4. `wrangler.toml`
```toml
name = "readest-sync"
compatibility_date = "2024-09-01"
account_id = "${CF_ACCOUNT_ID}"
workers_dev = true

[[r2_buckets]]
binding = "LIBRARY_BUCKET"
bucket_name = "${CF_R2_BUCKET}"
preview_bucket_name = "${CF_R2_BUCKET}"

[[d1_databases]]
binding = "SYNC_DB"
database_name = "${CF_D1_DATABASE_ID}"
database_id = "${CF_D1_DATABASE_ID}"
```

### 3.5. Worker (`src/workers/sync.ts`)
Implementa una API **compatible con KOSync** bajo `/api/v1/kosync/*`:
- `POST /register` → crear usuario en D1.
- `POST /login` → validar passphrase (hash SHA‑256).
- `GET /books` → listado de libros del usuario.
- `GET /book/:id/file` → descargar ebook desde R2.
- `POST /progress` → upsert de progreso.
- `POST /notes` → upsert de notas.
- `POST /upload` → subir EPUB a R2 y crear registro en `books`.

**Ejemplo de fragmento (TypeScript)**
```ts
import { R2Bucket, D1Database } from '@cloudflare/workers-types';

export interface Env {
  LIBRARY_BUCKET: R2Bucket;
  SYNC_DB: D1Database;
}

export const onRequest: ExportedHandler<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  if (url.pathname.startsWith('/api/v1/kosync')) {
    return handleKOSync(ctx);
  }
  return new Response('Not Found', { status: 404 });
};

async function handleKOSync(ctx: FetchEventContext<Env>) {
  const { request, env } = ctx;
  const path = new URL(request.url).pathname.split('/').slice(3); // after /api/v1/kosync
  const method = request.method;
  // Dispatch based on path & method – omitted for brevity.
  if (method === 'POST' && path[0] === 'register') {
    const { email, passphrase } = await request.json();
    const passhash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passphrase));
    const id = crypto.randomUUID();
    await env.SYNC_DB.prepare(`INSERT INTO users (id, email, passhash) VALUES (?, ?, ?)`).bind(id, email, Buffer.from(passhash).toString('hex')).run();
    return new Response(JSON.stringify({ user_id: id }), { status: 201 });
  }
  // Otros endpoints siguen el mismo patrón usando env.SYNC_DB y env.LIBRARY_BUCKET.
  return new Response('Not Implemented', { status: 501 });
}
```

### 3.6. Sustituir Supabase en el frontend
- **Auth**: modificar `src/services/auth.ts` (o equivalente) para usar los endpoints del Worker en vez de `supabase-js`.
- **Sync**: actualizar `src/services/sync/providers/s3.ts` para usar el SDK de **R2** (compatible con S3).
- **Base URL**: en `.env.local.example` establecer `NEXT_PUBLIC_API_BASE_URL=https://<tu-worker>.workers.dev/api/v1/kosync`.

### 3.7. Ajustes para Android
- Copiar las mismas variables de entorno al archivo `.env` dentro de `android/app/src/main/assets/` (o configuraciones de Gradle).
- Reconstruir el APK:
```bash
cd apps/readest-app
./gradlew assembleRelease   # produce app-release.apk
```
- Instalar el APK en el dispositivo y verificar que apunta a la URL del Worker.

## 4. Pruebas y verificación
### 4.1. Automatizadas
```bash
npm test                # unit tests
npm run test:e2e        # Playwright, prueba completa de sincronización
```
### 4.2. Manuales
1. Inicia el Worker localmente: `wrangler dev` y la UI (`npm run dev`).
2. Registra un usuario, sube un EPUB y anota el `book_id`.
3. En Android, inicia sesión con el mismo email/passphrase y verifica que el libro aparece.
4. Cambia página o agrega notas en Linux → verifica reflejo inmediato en Android, y viceversa.
5. Confirma que el archivo está en R2 (`wrangler r2 object list`) y que las tablas D1 contienen los registros (`wrangler d1 execute readest-sync "SELECT * FROM users;"`).
6. Asegúrate de que no haya tráfico a Supabase (monitoriza en DevTools).

## 5. Checklist de despliegue
- [ ] Cuenta de Cloudflare creada (sin tarjeta).
- [ ] Bucket R2 `readest-library` creado.
- [ ] Base D1 `readest-sync` creada y migrada.
- [ ] Fork del repositorio con rama `cloudflare-self-host` empujada.
- [ ] Worker desplegado (`wrangler publish`).
- [ ] APK de Android reconstruido e instalado.
- [ ] Pruebas de sincronización (automáticas y manuales) aprobadas.
- [ ] README actualizado con pasos de despliegue y uso de KOSync.

## 6. Próximos pasos sugeridos
1. **Responder las preguntas abiertas** (dominio, passphrase, método de compilación). 
2. **Crear los recursos en Cloudflare** (R2, D1, Worker). 
3. **Aplicar los cambios de código** en el fork. 
4. **Desplegar y probar** siguiendo la sección de verificación.

---
*Este archivo está listo para ser guardado como `readest-selfhost_plan_es.md` en tu proyecto.*
