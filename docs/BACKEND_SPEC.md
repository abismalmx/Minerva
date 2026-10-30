# BLUEPRINT DE ESPECIFICACIÓN TÉCNICA (PRD)
## Minerva (Fork de Readest) - Backend Nativo en Cloudflare

- **Versión:** 1.2.0
- **Estado:** Especificación Validada
- **Alcance:** Backend en Cloudflare Workers + D1 (SQLite) + R2 Storage
- **Objetivo:** Sincronización multiplataforma (Android, Linux, Web) de libros completos, progreso de lectura, marcadores, notas y configuración, de forma privada y 100% sobre Cloudflare (sin Supabase y sin KOSync).

---

## 1. Resumen Ejecutivo y Flujos de Interacción

### 1.1. Arquitectura General
El backend reemplaza por completo la infraestructura de Supabase y servicios externos por una solución *serverless* ejecutada 100% en el Edge de Cloudflare:
- **Cloudflare Worker (`readest-selfhost-sync`):** Enrutador universal, autenticación JWT con email/passphrase (hashing SHA-256), rate limiting de protección contra fuerza bruta y lógica de sincronización incremental.
- **Cloudflare D1 (SQLite para progreso, notas, marcadores):** Guarda los deltas de sincronización mediante la **API Nativa de Readest** (`/api/sync` y `/api/storage/*`).
- **Cloudflare R2 (`readest-library`):** Almacén de objetos compatible con S3 para binarios de ebooks (EPUB/PDF), portadas y backups, sin costes de salida de datos (*zero egress fees*).

### 1.2. Flujo Crítico de Interacción (Happy Path de Minerva)

```
[ Cliente Minerva: Web / Linux / Android ]
        |
        | 1. POST /api/auth/register o /api/auth/login (email + passphrase)
        v
[ Cloudflare Worker ] ---> Valida passhash (SHA-256) / brute-force en [ D1 ]
        |
        | 2. Devuelve Bearer JWT Token
        v
[ Cliente Minerva: Web / Linux / Android ]
        |
        +---> 3. POST /api/storage/upload (o URL firmada) ---> Guarda libros en [ R2 ]
        |
        +---> 4. POST /api/sync (push: progreso, notas, marcas) -> Upsert en [ D1 ]
        |
        +---> 5. GET /api/sync (pull con cursor incremental) ---> Delas en [ D1 ]
```

---

## 2. Contratos de Interfaz (API Nativa de Minerva)

### 2.1. Endpoints Nativos en Cloudflare Worker
| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| `GET` | `/health` | Chequeo de estado del Worker (`{ status: "ok" }`) | Pública |
| `POST` | `/api/auth/register` | Registro de usuario (email, username, passhash SHA-256) | Pública |
| `POST` | `/api/auth/login` | Autenticación y emisión de JWT | Pública (Rate Limited) |
| `GET` | `/api/auth/me` | Datos de la cuenta activa y cuota de almacenamiento | Bearer JWT |
| `DELETE` | `/api/auth/account` | Eliminación de cuenta y borrado en cascada | Bearer JWT |
| `GET` | `/api/sync` | Pull incremental basado en cursor `synced_at` | Bearer JWT |
| `POST` | `/api/sync` | Push de cambios (libros, progreso, notas, marcadores, configs) | Bearer JWT |
| `GET` | `/api/sync/replicas` | Obtención de estado de réplicas y estantes | Bearer JWT |
| `POST` | `/api/sync/replicas` | Sincronización de réplicas | Bearer JWT |
| `GET/POST` | `/api/storage/*` | Subida, descarga, firmado y estadísticas de archivos en R2 | Bearer JWT |

### 2.2. Esquema de Base de Datos (D1 SQLite)
El esquema almacena la totalidad de la experiencia de lectura:
- `users`: Cuentas de usuario, credenciales hashed (SHA-256), uso de almacenamiento y timestamps.
- `login_attempts`: Control contra ataques de fuerza bruta por email.
- `books`: Metadatos de libros (título, autor, formato, portadas, cursor monotónico `synced_at`).
- `book_configs`: Posición exacta de lectura (`location`, `xpointer`, `progress`, modo de vista).
- `book_notes`: Notas del lector vinculadas a párrafos y capítulos.
- `book_highlights`: Resaltados de texto, colores y rangos.
- `book_bookmarks`: Marcadores de páginas.
- `files`: Registro de binarios almacenados en R2 (`file_key`, `file_size`, `content_type`).
- `replicas`, `replica_keys`: Sincronización de preferencias globales y estantes de biblioteca.

---

## 3. Seguridad y Manejo de Errores

1. **Hashing Seguro:** Uso estricto de SHA-256 con Web Crypto API para almacenar y comparar contraseñas.
2. **Protección Brute-Force:** Bloqueo temporal con HTTP 429 tras superar intentos fallidos en `login_attempts`.
3. **Límite de Carga Estricto:** Validación de payload contra `MAX_UPLOAD_BYTES` (100 MB límite de Cloudflare Workers).
4. **Control de Cuota:** Validación de cuota antes de persistir objetos en R2 (`STORAGE_FIXED_QUOTA`).
5. **Respuestas Normalizadas:** Respuestas JSON consistentes con códigos estándar (`400`, `401`, `403`, `404`, `409`, `429`, `500`).
6. **CORS Abierto/Configurable:** Permite la comunicación tanto desde la versión Web local como desde el contenedor Capacitor en Android.

---

## 4. Reglas del Proyecto para Agentes de Código

1. **Tipado Estricto:** TypeScript sin `any` implícito utilizando `@cloudflare/workers-types`.
2. **Determinismo en SQLite:** Sin funciones ni triggers propietarios de PostgreSQL; los cursores de reconciliación (`synced_at`) se calculan en el Worker.
3. **Validación Primero:** Compilación limpia (`npm run typecheck` = 0 errores) y pruebas locales (`npm run migrate`, `wrangler dev`).
4. **Estructura de Directorios:**
   - Worker Core: `apps/readest-app/workers/readest-sync/src/`
   - Migraciones D1: `apps/readest-app/workers/readest-sync/migrations/`
   - Configuración: `apps/readest-app/workers/readest-sync/wrangler.toml`
   - Tests: `apps/readest-app/src/__tests__/workers/`
