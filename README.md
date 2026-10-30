<div align="center">
  <img src="https://github.com/minerva/minerva/blob/main/apps/minerva-app/src-tauri/icons/icon.png?raw=true" alt="Minerva" width="120" />
  <h1>Minerva</h1>
  <p><strong>El lector de libros electronicos con sincronizacion propia.</strong></p>
  <br>

[![CI](https://github.com/minerva/minerva/actions/workflows/pull-request.yml/badge.svg)](https://github.com/minerva/minerva/actions/workflows/pull-request.yml)
[![Secret scan](https://github.com/minerva/minerva/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/minerva/minerva/actions/workflows/secret-scan.yml)
[![Licencia](https://img.shields.io/badge/licencia-AGPL--3.0-teal)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![Tauri](https://img.shields.io/badge/Tauri-2-orange)](https://v2.tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.90%2B-orange)](https://www.rust-lang.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org)
[![pnpm](https://img.shields.io/badge/pnpm-11.1.1-yellow)](https://pnpm.io)

</div>

---

## Que es Minerva

Minerva es un lector de libros electronicos multiplataforma: lee EPUB, PDF, MOBI,
AZW3, FB2, CBZ, TXT, HTML y Markdown en escritorio (macOS, Windows, Linux), en
movil (Android, iOS) y en la web. Por debajo combina **Next.js 16** para la
interfaz y **Tauri 2** para el backend nativo, con una base de datos local en
SQLite y un motor de busqueda integrated.

Lo que distingue a Minerva es su **capa de sincronizacion**. No depende de un
servicio de terceros: el backend de sincronizacion es un proyecto propio
—`apps/minerva-app/workers/minerva-sync`— que corre como un **Cloudflare
Worker** sobre **D1** (SQLite) y **R2** (almacenamiento de objetos). Se
despliega con un solo comando, funciona en una cuenta gratuita de Cloudflare y
se puede auditar entero porque el codigo esta aqui, en este repositorio.

| | |
| --- | --- |
| **Formatos** | EPUB, PDF, MOBI, KF8 (AZW3), FB2, CBZ, TXT, HTML, MD |
| **Plataformas** | macOS, Windows, Linux, Android, iOS, Web (PWA) |
| **Sincronizacion** | Cloudflare Workers + D1 + R2, autoalojable |
| **Base de datos local** | SQLite (Turso) con busqueda full-text |
| **IA** | Asistente de lectura con proveedores OpenAI-compatibles (Gemini, Ollama, ...) |
| **Licencia** | AGPL-3.0 |

---

## Instalacion

### Requisitos

| Herramienta | Version | Para que |
| ----------- | ------- | -------- |
| [Node.js](https://nodejs.org) | 24 | interfaz y build de Next.js |
| [pnpm](https://pnpm.io/installation) | 11.1.1 | gestor de paquetes del monorepo |
| [Rust](https://www.rust-lang.org/tools/install) | 1.90 o superior | backend nativo de Tauri |
| [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) | segun el sistema | librerias del sistema para compilar la app |

El backend autoalojado solo necesita un navegador y una cuenta de Cloudflare
(plan gratuito suficiente).

### Clonar y preparar el arbol

Minerva usa **submodulos de Git** para las dependencias que tienen su propio
upstream (el motor de lectura, el fork de Tauri, los diccionarios). Sin ellos
el workspace de pnpm no resuelve:

```bash
git clone --recurse-submodules https://github.com/minerva/minerva.git
cd minerva

# Si ya tenias el repositorio clonado sin submodulos:
git submodule update --init --recursive

pnpm install --frozen-lockfile
pnpm --filter @minerva/app setup-vendors
```

`setup-vendors` copia los assets de PDF.js desde `packages/foliate-js` a
`apps/minerva-app/public/vendor`. Es necesario para que el lector de PDF
funcione.

### Ejecutar

```bash
# Interfaz web (solo navegador, sin compilar Rust: el ciclo mas rapido)
pnpm dev-web

# Aplicacion de escritorio (compila el backend Rust)
pnpm tauri dev
```

La interfaz web queda en `http://localhost:3000`.

### Compilar

```bash
# Build web (Cloudflare Workers / OpenNext)
pnpm --filter @minerva/app build-web

# Build de escritorio: produce los binarios en target/release/bundle/
pnpm tauri build
```

---

## Variables de entorno

**El repositorio no publica ninguna credencial.** No hay ningun `.env` versionado:
lo que se versiona es [`.env.example`](.env.example), con los nombres de las
variables y sin valores.

Las variables se leen de `apps/minerva-app/.env` (Next.js lo carga solo) y de
`apps/minerva-app/.env.tauri` / `.env.web`, que ya estan cubiertos por sus
plantillas (`.env.tauri.example`, `.env.web.example`): los scripts de build los
cargan como alternativa, asi que un clon recien hecho compila sin crear ningun
dotfile.

### Lo minimo para trabajar

| Clave | Que hace | Valor por defecto |
| ----- | -------- | ----------------- |
| `NEXT_PUBLIC_APP_PLATFORM` | Plataforma de la build: `tauri` o `web` | `tauri` / `web`, segun el script |
| `NEXT_PUBLIC_API_BASE_URL` | Origen del backend de API (la app anade `/api`) | el backend de Minerva |
| `NEXT_PUBLIC_SUPABASE_URL` | Proyecto Supabase de la capa de cuenta | el de Minerva Cloud |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anon de ese proyecto | la de Minerva Cloud |

### Cuentas de usuario y sincronizacion

| Clave | Que hace | Valor por defecto |
| ----- | -------- | ----------------- |
| `SELF_HOSTED_BACKEND` | `true` cambia la capa de cuenta al Worker propio | `false` |
| `NEXT_PUBLIC_SELF_HOSTED_BACKEND` | Lo mismo, para el navegador | `false` |
| `NEXT_PUBLIC_API_BASE_URL` | Origen del Worker de sincronizacion | — |
| `SUPABASE_ADMIN_KEY` | Clave de servicio, **solo en el servidor** | — |
| `STORAGE_FIXED_QUOTA` | Cuota de almacenamiento por usuario, en bytes | `0` |

### Servicios de terceros

| Clave | Que hace | Valor por defecto |
| ----- | -------- | ----------------- |
| `DEEPL_PRO_API_KEYS` / `DEEPL_FREE_API_KEYS` | Traduccion con DeepL (separadas por coma) | sin traduccion |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | Telemetria (PostHog) | el proyecto de Minerva |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_BASE64` | Clave publicable de Stripe (base64) | la de Minerva |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Pagos, **solo en el servidor** | — |
| `NEXT_PUBLIC_PAGEBOUND_FIREBASE_API_KEY` | Clave de cliente de Firebase para Pagebound | la de Pagebound |
| `NEXT_PUBLIC_PAGEBOUND_TYPESENSE_API_KEY` | Clave de solo busqueda de Typesense | la de Pagebound |
| `R2_*` / `S3_*` | Almacenamiento de libros y portadas | — |

Los identificadores publicos del servicio alojado (Supabase, PostHog, Stripe) y
las claves publicas de Pagebound estan compilados en
[`src/services/publicDefaults.ts`](apps/minerva-app/src/services/publicDefaults.ts),
de modo que la aplicacion funciona sin ningun dotfile. **Ninguno es un
secreto**: viajan dentro del bundle del navegador por diseño. Las variables de
entorno de la tabla tienen prioridad sobre ellos.

La tabla completa, con las 100 variables que lee el proyecto, esta en
[`.env.example`](.env.example); el stack de Docker autoalojado tiene la suya en
[`docker/.env.example`](docker/.env.example).

---

## Estructura del proyecto

```text
minerva/
├── apps/
│   ├── minerva-app/                 # aplicacion (Next.js 16 + Tauri 2)
│   │   ├── src/                     # interfaz, servicios y estado
│   │   ├── src-tauri/               # backend nativo en Rust
│   │   ├── workers/                 # Cloudflare Workers
│   │   │   ├── minerva-sync/        # backend de sincronizacion (D1 + R2)
│   │   │   ├── iap-reconcile/       # conciliacion de compras in-app
│   │   │   └── send-email/          # recepcion de correo de las extensiones
│   │   └── extensions/              # extension del navegador "Send to Minerva"
│   ├── minerva-calibre-plugin/      # plugin de Calibre
│   ├── minerva-crosspoint-plugin/   # plugin de CrossPoint
│   └── minerva.koplugin/            # plugin para KOReader (Lua)
├── packages/
│   ├── foliate-js/                  # motor de lectura (submodulo)
│   ├── js-mdict/                    # diccionarios MDict (submodulo)
│   ├── qcms/                        # decodificador CMYK de PDF (submodulo)
│   ├── simplecc-wasm/               # resaltado de codigo en WASM (submodulo)
│   ├── swift-rs/                    # fork de swift-rs (vendorizado)
│   ├── tauri/                       # fork de Tauri (submodulo)
│   └── tauri-runtime-cef-stub/      # stub del runtime CEF para Linux
├── data/                            # iconos, capturas y metadatos de release
├── docker/                          # stack de despliegue con Docker Compose
├── docs/                            # especificaciones y runbooks
├── fastlane/                        # automatizacion de publicacion en tiendas
├── nix/                             # empaquetado Nix
├── scripts/                         # utilidades de desarrollo y despliegue
└── .github/                         # CI, plantillas de issues y politicas
```

Las rutas `packages/foliate-js`, `packages/js-mdict`, `packages/qcms`,
`packages/simplecc-wasm` y `packages/tauri` son **submodulos**: `git clone
--recurse-submodules` los deja en su sitio y `git submodule update
--init --recursive` los restaura.

---

## Scripts de desarrollo

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
| `pnpm --filter @minerva/app test:extension` | Tests de la extension del navegador |
| `pnpm fmt:check` / `pnpm clippy:check` | `cargo fmt` / `cargo clippy` del backend Rust |
| `pnpm --filter @minerva/app test:rust` | Tests unitarios de Rust |
| `pnpm check:eink-identity` | Comprueba la paridad de la lista de identidad en e-ink |
| `pnpm deploy:cloudflare` | Despliega el backend de sincronizacion (ver abajo) |

El CI ejecuta los mismos comandos; su definicion esta en
[`.github/workflows/pull-request.yml`](.github/workflows/pull-request.yml).

---

## Despliegue

### Backend de sincronizacion autoalojado

El runbook completo esta en **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**:
requisitos, aprovisionamiento, migraciones, verificacion automatica y manual
entre dispositivos, mantenimiento y rollback.

```bash
# Aprovisiona D1, R2, el secreto JWT, aplica las migraciones y publica
# el Worker `minerva-cloudflare` en un solo comando.
./scripts/deploy-cloudflare.sh
```

Despues, en la app: **Ajustes → Sincronizacion → Minerva Cloud
(Cloudflare)**, pega la URL del Worker y pulsa **Probar conexion**.

### Aplicacion de escritorio y web

| Objetivo | Comando |
| -------- | ------- |
| Linux (AppImage) | `pnpm --filter @minerva/app build-linux-x64` |
| Windows (NSIS) | `pnpm --filter @minerva/app build-win-x64` |
| macOS (DMG) | `pnpm --filter @minerva/app build-macos-universial` |
| Web (Cloudflare) | `pnpm --filter @minerva/app deploy` |
| Docker Compose | `docker compose -f docker/compose.yaml up -d` |

Los parametros de la imagen de Docker estan en
[`docker/compose.yaml`](docker/compose.yaml) y su plantilla de secretos en
[`docker/.env.example`](docker/.env.example).

---

## Contribucion

Las Pull Requests son bienvenidas. Antes de enviar una:
1. Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) y [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
2. Abre una issue si el cambio es una opinion sobre el producto; los cambios
   de codigo se discute antes en la issue.
3. Instala los hooks con `pnpm install` (husky) y valida antes de subir:
   `pnpm lint`, `pnpm test --run` y, si tocas Rust, `pnpm fmt:check` y
   `pnpm clippy:check`.

La guia de arquitectura y la disposicion del codigo estan en
[`apps/minerva-app/docs/architecture.md`](apps/minerva-app/docs/architecture.md)
y [`apps/minerva-app/docs/code-layout.md`](apps/minerva-app/docs/code-layout.md).

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

Gracias al [Web Chinese Fonts Plan](https://chinese-font.netlify.app) por las
herramientas de codigo abierto que permiten usar fuentes chinas en la web.

## Licencia

Minerva es software libre bajo la **GNU Affero General Public License v3.0** o
posterior. El texto completo esta en [`LICENSE`](LICENSE).

Minerva es un proyecto independiente. Su origen, el trabajo previo del que
deriva, los avisos de autoria y la atribucion a las personas y proyectos que
lo hicieron posible estan en [`NOTICE`](NOTICE), que forma parte de la
documentacion de esta licencia.
