<div align="center">
  <img src="https://github.com/minerva/minerva/blob/main/apps/minerva-app/src-tauri/icons/icon.png?raw=true" alt="Minerva" width="120" />
  <h1>Minerva</h1>
  <p><strong>Tu servidor de sincronizacion de libros, sobre Cloudflare.</strong></p>
  <br>

[![CI](https://github.com/minerva/minerva/actions/workflows/pull-request.yml/badge.svg)](https://github.com/minerva/minerva/actions/workflows/pull-request.yml)
[![Secret scan](https://github.com/minerva/minerva/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/minerva/minerva/actions/workflows/secret-scan.yml)
[![Licencia](https://img.shields.io/badge/licencia-AGPL--3.0-teal)](LICENSE)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1%20%2B%20R2-f38020)](https://workers.cloudflare.com)
[![KOSync](https://img.shields.io/badge/KOSync-compatible-4a90d9)](https://koreader.rocks/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![Tauri](https://img.shields.io/badge/Tauri-2-orange)](https://v2.tauri.app)
[![pnpm](https://img.shields.io/badge/pnpm-11.1.1-yellow)](https://pnpm.io)

</div>

---

## Que es este repositorio

Minerva es el **backend de sincronizacion de libros** que funciona sobre tu
propia cuenta de Cloudflare. Un solo **Worker** (Node.js) sirve la API, una
base **D1** (SQLite) guarda cuentas, biblioteca, notas y progressing, y un
bucket **R2** guarda los libros, las portadas y los archivos.

```
┌───────────────┐        ┌──────────────────────────────┐
│  Minerva      │  HTTPS │  Cloudflare Worker            │
│  (escritorio, │ ─────► │  minerva-sync                 │
│   movil, web) │        │  ├─ D1  (SQLite)  cuentas,    │
│               │        │  │    libros, notas, réplicas │
│  KOReader     │ ─────► │  └─ R2  libros, portadas       │
└───────────────┘        └──────────────────────────────┘
```

La app lee y escribe contra **tu** servidor: no hay cuenta de por medio, no
hay trafico hacia terceros y no hay que pagar. Ademas habla el protocolo
**KOSync**, asi que **KOReader** puede usar el mismo servidor para su propia
sincronizacion de progreso.

- **Dos superficies en el mismo Worker**: la API nativa de Minerva
  (`/api/sync`, `/api/storage/*`, `/api/auth/*`, `/api/user/*`) y la API
  compatible con KOSync (`/users/create`, `/users/auth`, `/syncs/progress`).
- **La misma API que el servicio alojado**: una build sin modificar habla con
  este Worker solo con pointed `NEXT_PUBLIC_API_BASE_URL` a el.
- **Gratis**: cabe de sobra en el plan gratuito de Cloudflare (100 000
  peticiones/dia, 10 GB en R2, sin coste de salida). No hace falta tarjeta.
- **Cifrado en el cliente**: las campos sensibles se cifran con una clave
  derivada de tu *passphrase de sincronizacion*; el servidor solo guarda la
  sal y el texto cifrado. Y la *passphrase de cuenta* nunca se guarda: solo
  una derivacion con PBKDF2 (600 000 iteraciones) o su MD5 en la superficie
  KOSync.

---

## Despliegue en un comando

```bash
git clone --recurse-submodules https://github.com/minerva/minerva.git
cd minerva

# Sesion de Cloudflare (abre el navegador la primera vez)
npx wrangler login

# Crea D1, crea R2, genera el secreto, aplica las migraciones y publica
# el Worker. Es idempotente: se puede volver a ejecutar.
./deploy-cloudflare.sh
```

El script imprime la URL del Worker al terminar y deja la app configurada en
`apps/minerva-app/.env.local`.

<details>
<summary>Que hace exactamente, paso a paso</summary>

| Paso | Que ocurre |
| ---- | ---------- |
| 1 | Comprueba las herramientas y la sesion de Cloudflare (`wrangler whoami` / `wrangler login`). |
| 2 | Crea la base **D1** `minerva-sync` (o reutiliza la existente) y extrae su `database_id`. |
| 3 | Crea el bucket **R2** `minerva-library` (o reutiliza el existente). |
| 4 | Escribe el `database_id` y el `bucket_name` en `wrangler.toml` sin tocar el resto de tu configuracion. |
| 5 | Genera un `JWT_SECRET` de 32 bytes y lo registra en **Cloudflare Secrets** (nunca en `wrangler.toml`). |
| 6 | Aplica las migraciones remotas (`0001` a `0004`). |
| 7 | Publica el Worker `minerva-cloudflare` en `*.workers.dev`. |
| 8 | Comprueba `/health` y escribe `NEXT_PUBLIC_API_BASE_URL` en `apps/minerva-app/.env.local`. |

Para rotar el secreto sin invalidar las sesiones: `./deploy-cloudflare.sh --rotate-secret`.

</details>

### Variables de entorno

Solo hacen falta si quieres hacer el despliegue a mano. La lista completa
esta en [`.env.example`](.env.example).

| Clave | Que hace | Valor por defecto |
| ----- | -------- | ----------------- |
| `CF_ACCOUNT_ID` | Tu cuenta de Cloudflare | — |
| `CF_R2_BUCKET` | Bucket R2 de los libros | `minerva-library` |
| `CF_D1_DATABASE_ID` | Base D1 de la sincronizacion | — |
| `JWT_SECRET` | Secreto de firma del Worker (32+ caracteres) | lo genera el script |
| `SYNC_PASSPHRASE` | Passphrase de sincronizacion (cifra en el cliente) | la escribes en la app |
| `NEXT_PUBLIC_API_BASE_URL` | Origen de tu Worker | el que imprime el script |
| `SELF_HOSTED_BACKEND` | Autentica contra tu Worker | `true` |
| `ALLOWED_ORIGINS` | Origenes del navegador autorizados | `*` |
| `MAX_UPLOAD_BYTES` | Techo de subida por libro | `104857600` (100 MB) |
| `STORAGE_FIXED_QUOTA` | Cuota por cuenta, en bytes | `0` (sin cuota) |

`SELF_HOSTED_BACKEND` y `SELF_HOSTED` son interruptores distintos:

- `SELF_HOSTED_BACKEND=true` cambia la **capa de cuenta**: te registras con
  email + passphrase contra tu Worker y el trafico no sale de tu cuenta.
- `SELF_HOSTED=true` **desbloquea las funciones de pago**: en un despliegue
  propio no hay tienda y todas quedan disponibles.

### Desarrollo local del Worker

```bash
cd apps/minerva-app/workers/minerva-sync

pnpm install
pnpm migrate     # aplica el esquema en el D1 local
pnpm dev         # wrangler dev en http://localhost:8787

# En otra terminal
curl -s http://localhost:8787/health
# {"status":"ok"}
```

El runbook completo —verificacion automatizada, verificacion manual entre
dispositivos, mantenimiento, copia de seguridad y rollback— esta en
**[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**.

---

## Conectar la app a tu servidor

1. Abre Minerva: **Ajustes → Sincronizacion → Minerva Cloud (Cloudflare)**.
2. Pega la URL del Worker y pulsa **Probar conexion**.
3. Registra una cuenta con email y *passphrase*. El servidor solo guarda una
   derivacion con PBKDF2: **no puede recuperar tu passphrase**, asi que
   guardala.
4. En otro dispositivo, entra con el mismo email y la misma passphrase: la
   biblioteca, el progreso, las notas y los marcadores se sincronizan.

Para KOReader: **Ajustes → Sincronizacion → KOReader** (o el menu
sincronizacion de KOReader), con la URL del Worker, tu email y tu passphrase.

---

## La app

Minerva es un lector de libros electronicos multiplataforma —escritorio
(macOS, Windows, Linux), movil (Android, iOS) y web— con Next.js 16 y
Tauri 2. Este repositorio lo publica para que puedas **autoalojar su
sincronizacion**; la app y el Worker se despliegan por separado.

| | |
| --- | --- |
| **Formatos** | EPUB, PDF, MOBI, KF8 (AZW3), FB2, CBZ, TXT, HTML, MD |
| **Plataformas** | macOS, Windows, Linux, Android, iOS, Web (PWA) |
| **Sincronizacion** | Cloudflare Workers + D1 + R2, autoalojable, KOSync |
| **Base de datos local** | SQLite (Turso) con busqueda full-text |
| **Licencia** | AGPL-3.0 |

### Requisitos

| Herramienta | Version | Para que |
| ----------- | ------- | -------- |
| [Node.js](https://nodejs.org) | 24 | interfaz y build de Next.js |
| [pnpm](https://pnpm.io/installation) | 11.1.1 | gestor de paquetes del monorepo |
| [Rust](https://www.rust-lang.org/tools/install) | 1.90 o superior | backend nativo de Tauri |
| [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) | segun el sistema | librerias del sistema |

Para el **Worker** solo hacen falta Node.js y una cuenta de Cloudflare.

### Clonar y preparar el arbol

El workspace de pnpm usa **submodulos de Git** para las dependencias con
upstream propio (el motor de lectura, el fork de Tauri, los diccionarios):

```bash
git clone --recurse-submodules https://github.com/minerva/minerva.git
cd minerva

# Si ya lo tenias clonado sin submodulos:
git submodule update --init --recursive

pnpm install --frozen-lockfile
pnpm --filter @minerva/app setup-vendors
```

### Ejecutar y compilar

```bash
pnpm dev-web              # interfaz web (sin compilar Rust: el ciclo rapido)
pnpm tauri dev            # aplicacion de escritorio
pnpm --filter @minerva/app build-web   # build web
pnpm tauri build          # binarios de escritorio en target/release/bundle/
```

### Scripts de desarrollo

Todos se ejecutan desde la raiz del monorepo.

| Comando | Que hace |
| ------- | -------- |
| `pnpm dev-web` | Servidor de desarrollo web |
| `pnpm tauri dev` | Aplicacion de escritorio con recarga en caliente |
| `pnpm lint` | `tsc --noEmit` + Biome sobre el codigo web |
| `pnpm format` / `pnpm format:check` | Formatea con Biome / comprueba el formato |
| `pnpm test` | Suite unitaria (Vitest + jsdom), en modo watch |
| `pnpm test --run` | La misma suite, una sola vez |
| `pnpm --filter @minerva/app test:browser` | Tests de navegador (Chromium) |
| `pnpm --filter @minerva/app test:tauri` | Tests de integracion de Tauri |
| `pnpm --filter @minerva/app test:lua` | Tests del plugin de KOReader |
| `pnpm fmt:check` / `pnpm clippy:check` | `cargo fmt` / `cargo clippy` del backend Rust |
| `pnpm check:eink-identity` | Comprueba la paridad de la lista de identidad en e-ink |
| `pnpm deploy:cloudflare` | Despliega el Worker (ver mas arriba) |

Los tests del Worker (que ejecutan las migraciones reales contra un SQLite
real) viven en la suite de la app:

```bash
cd apps/minerva-app
pnpm test --run src/__tests__/workers/
```

---

## Estructura del proyecto

```text
minerva/
├── apps/
│   ├── minerva-app/                 # aplicacion (Next.js 16 + Tauri 2)
│   │   ├── src/                     # interfaz, servicios y estado
│   │   ├── src-tauri/               # backend nativo en Rust
│   │   ├── workers/
│   │   │   ├── minerva-sync/        # <-- el backend autoalojado
│   │   │   │   ├── src/             #   Worker: rutas, auth, merge de réplicas
│   │   │   │   ├── migrations/      #   esquema D1 (0001..0004)
│   │   │   │   └── wrangler.toml    #   bindings de D1 y R2
│   │   │   ├── iap-reconcile/       # conciliacion de compras in-app
│   │   │   └── send-email/          # recepcion de correo de las extensiones
│   │   └── extensions/              # extension del navegador "Send to Minerva"
│   ├── minerva-calibre-plugin/      # plugin de Calibre
│   ├── minerva-crosspoint-plugin/   # plugin de CrossPoint
│   └── minerva.koplugin/            # plugin para KOReader (Lua)
├── packages/                        # dependencias con upstream propio (submodulos)
├── data/                            # iconos, capturas y metadatos de release
├── docs/                            # runbooks y especificaciones
├── fastlane/                        # automatizacion de publicacion en tiendas
├── nix/                             # empaquetado Nix
├── scripts/                         # utilidades de desarrollo y despliegue
└── .github/                         # CI, plantillas de issues y politicas
```

---

## Contribucion

Las Pull Requests son bienvenidas. Antes de enviar una:

1. Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) y [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
2. Abre una issue si el cambio es una opinion sobre el producto.
3. Valida antes de subir: `pnpm lint`, `pnpm test --run` y, si tocas Rust,
   `pnpm fmt:check` y `pnpm clippy:check`.

La guia de arquitectura esta en
[`apps/minerva-app/docs/architecture.md`](apps/minerva-app/docs/architecture.md).

Si encuentras una vulnerabilidad, **no abras una issue publica**: sigue la
politica de [`SECURITY.md`](SECURITY.md).

---

## Reconocimientos

Los componentes de terceros conservan sus propias licencias:

- [foliate-js](https://github.com/johnfactotum/foliate-js) — MIT.
- [zip.js](https://github.com/gildas-lormeau/zip.js) — BSD-3-Clause.
- [fflate](https://github.com/101arrowz/fflate) — MIT.
- [PDF.js](https://github.com/mozilla/pdf.js) — Apache-2.0.
- [daisyUI](https://github.com/saadeghi/daisyui) — MIT.
- [marked](https://github.com/markedjs/marked) — MIT.
- [Next.js](https://github.com/vercel/next.js) — MIT.
- [React](https://github.com/facebook/react) — MIT.
- [react-icons](https://github.com/react-icons/react-icons) — varias licencias de codigo abierto.
- [Tauri](https://github.com/tauri-apps/tauri) — MIT / Apache-2.0.

Fuentes tipograficas incluidas o servidas por la web: [Bitter](https://fonts.google.com/specimen/Bitter),
[Fira Code](https://fonts.google.com/specimen/Fira+Code), [Inter](https://fonts.google.com/specimen/Inter),
[Literata](https://fonts.google.com/specimen/Literata), [Merriweather](https://fonts.google.com/specimen/Merriweather),
[Noto Sans](https://fonts.google.com/specimen/Noto+Sans), [Roboto](https://fonts.google.com/specimen/Roboto),
[LXGW WenKai](https://github.com/lxgw/LxgwWenKai), [MiSans](https://hyperos.mi.com/font/en/),
[Source Han](https://github.com/adobe-fonts/source-han-sans/) y
[WenQuanYi Micro Hei](http://wenq.org/wqy2/).

## Licencia

Minerva es software libre bajo la **GNU Affero General Public License v3.0** o
posterior. El texto completo esta en [`LICENSE`](LICENSE).

Minerva es un proyecto independiente. Su origen, el trabajo previo del que
deriva, los avisos de autoria y la atribucion a las personas y proyectos que
lo hicieron posible estan en [`NOTICE`](NOTICE).
