# Guía del Desarrollador — Minerva

> **Minerva** es un fork soberano y libre de telemetría de [Readest](https://github.com/readest/readest).
> Esta es la guía técnica de referencia paraoquien quiera desarrollar, auditar o desplegar el proyecto.

**Versión del documento:** 1.0
**Público objetivo:** desarrolladores de front-end, backend, Rust/nativo, empaquetado y personas que autoalojan su propia infraestructura.
**Licencia del proyecto:** GNU AGPL v3 o posterior.
**Upstream:** Readest — Copyright © Bilingify LLC y los colaboradores de Readest (ver [`NOTICE`](../NOTICE)).

---

## Tabla de contenidos

1. [Introducción](#1-introducción)
2. [Filosofía del proyecto y principios de ingeniería](#2-filosofía-del-proyecto-y-principios-de-ingeniería)
3. [Arquitectura del monorepo](#3-arquitectura-del-monorepo)
4. [Configuración del entorno de desarrollo](#4-configuración-del-entorno-de-desarrollo)
5. [Guía de las nuevas funcionalidades del fork](#5-guía-de-las-nuevas-funcionalidades-del-fork)
6. [Testing, calidad de código y seguridad](#6-testing-calidad-de-código-y-seguridad)
7. [Compilación y empaquetado multiplataforma](#7-compilación-y-empaquetado-multiplataforma)
8. [Flujo de contribución](#8-flujo-de-contribución)
9. [Referencia rápida](#9-referencia-rápida)
10. [Glosario y mapa de la documentación](#10-glosario-y-mapa-de-la-documentación)

---

## 1. Introducción

### 1.1 Qué es Minerva

Minerva es un **lector de libros electrónicos multiplataforma** (escritorio, móvil y web) construido sobre una única base de código TypeScript/React que se compila hacia varios objetivos:

| Objetivo | Runtime | Empaquetado |
| --- | --- | --- |
| Windows | Tauri v2 + WebView2 | `.exe` portable (PE32+) y instalador NSIS |
| macOS | Tauri v2 + WKWebView | `.dmg` / binario universal `universal-apple-darwin` |
| Linux | Tauri v2 + **CEF** (Chromium Embedded Framework) | `.AppImage`, `.deb`, `.rpm` |
| Android | Tauri v2 + WebView de Android | `.apk` / `.aab` |
| iOS | Tauri v2 + WKWebView | `.ipa` |
| Web | Next.js sobre Cloudflare Workers (OpenNext) | PWA / imagen Docker |

Lo que distingue a Minerva de Readest no es el conjunto de funciones, sino la **relación con el usuario y con sus datos**: Minerva está diseñada para que el usuario sea el único dueño de su biblioteca, de su progreso de lectura y de sus notas, y para que nada de eso salga de su control.

### 1.2 Convenciones de este documento

- Los bloques de código con `bash` se ejecutan **desde la raíz del monorepo** salvo que se indique lo contrario.
- Las rutas son **relativas a la raíz del monorepo**.
- Cuando se cita un comando que depende de la plataforma, se indica el sistema operativo.
- Los nombres en `código` identifican ficheros, funciones, comandos o variables literales del repositorio.
- Los avisos con el formato **⚠️ Nota de precisión** señalan divergencias entre el imaginario popular (o la documentación de upstream) y la realidad del código, para que nadie pierde tiempo buscando algo que no existe.

### 1.3 El nombre de las carpetas: `readest-app` → `minerva-app`

Upstream organize la aplicación en `apps/readest-app`. El fork la renombró a **`apps/minerva-app`**. Varias herramientas del repositorio resuelven dinámicamente cualquiera de los dos nombres para no romperse:

```bash
# scripts/deploy-cloudflare.sh
for candidate in "$REPO_ROOT/apps/minerva-app" "$REPO_ROOT/apps/readest-app"; do
  if [ -d "$candidate/workers/minerva-sync" ] || [ -d "$candidate/workers/readest-sync" ]; then
    APP_DIR="$candidate"
    break
  fi
done
```

> ⚠️ **Nota de precisión — el stack real.** La documentación de upstream y algunas descripciones de Minerva mencionan «Vite + Jotai». En el código actual de Minerva:
>
> - **El bundler de producción es Next.js 16.4.2 (App Router + Pages Router)** con React 19.2.8. Existe además un `vite.config.ts` con el plugin [`vinext`](https://github.com/vercel/vinext) que habilita una **ruta alternativa Vite** (`pnpm --filter @minerva/app dev-web:vinext` / `build-web:vinext`), y Vitest usa Vite como runner.
> - **El estado global es [Zustand](https://github.com/pmndrs/zustand) 5.0.10**, no Jotai. No existe `atom()`/`useAtom` en ninguna parte del código. Los stores viven en `apps/minerva-app/src/store/` (31 stores de propósito único). Ver §3.3.2.
> - **El estilos es Tailwind CSS v4** con **daisyUI 5** como capa de componentes, configurados por CSS-first en `apps/minerva-app/src/styles/globals.css` (`@import 'tailwindcss'`, `@plugin 'daisyui'`), no por un `tailwind.config.js`.
>
> Usa siempre la fuente de verdad del repositorio antes de asumir un API.

---

## 2. Filosofía del proyecto y principios de ingeniería

### 2.1 Soberanía de datos

El principio rector de Minerva es que **la biblioteca del usuario le pertenece al usuario**. Esto se traduce en decisiones concretas, no en declaraciones de intenciones:

1. **El servidor es opcional y autoalojable.** El backend de sincronización completo (`minerva-sync`) se despliega en la cuenta de Cloudflare del usuario. Una build sin modificar habla con ese Worker solo con apuntar `NEXT_PUBLIC_API_BASE_URL` a su URL. No hay un intermediario obligatorio.
2. **No hay cuenta obligatoria.** Con `SELF_HOSTED_BACKEND=true` la capa de cuenta deja de hablar con Supabase y pasa a hablar con tu Worker: te registras con email + *passphrase* y el tráfico no sale de tu cuenta.
3. **Los bytes del libro no pasan por un backend de terceros.** Los ficheros EPUB/MOBI/PDF viven en tu bucket R2 (`minerva-library`), en tu disco, o en tu proveedor de archivoSync favorito (WebDAV, Google Drive, S3, OneDrive, iCloud).
4. **Sin compras, sin nube de pago.** `SELF_HOSTED=true` desbloquea las funciones premium porque en un despliegue propio no hay tienda que consultar.

La arquitectura completa del autoalojo está documentada en [`apps/minerva-app/workers/minerva-sync/README.md`](../apps/minerva-app/workers/minerva-sync/README.md) y el runbook operativo en `docs/DEPLOYMENT.md`.

### 2.2 Privacidad por diseño

La privacidad no es un parche aplicado al final: es una restricción de diseño que se aplica en cada capa.

**Cifrado de conocimiento cero (client-side).** Los campos sensibles que se sincronizan (contraseñas de catálogos OPDS, credenciales de servicios, blobs de réplicas) **se cifran en el cliente antes de subir**. El servidor nunca ve la clave ni el texto en claro.

```ts
// apps/minerva-app/src/libs/crypto/derive.ts
const PBKDF2_DEFAULT_ITERATIONS = 600_000;
const KEY_LENGTH_BITS = 256;

export const derivePbkdf2Key = async (
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_DEFAULT_ITERATIONS,
): Promise<CryptoKey> => {
  const subtle = requireSubtle();
  const passphraseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    passphraseKey,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    true,
    ['encrypt', 'decrypt'],
  );
};
```

El sobre que viaja por la red es autocontenido y declara su algoritmo:

```ts
// apps/minerva-app/src/libs/crypto/envelope.ts
export const CURRENT_ALG = 'aes-gcm/pbkdf2-600k-sha256';

export const encryptToEnvelope = async (
  plaintext: string | Uint8Array,
  key: CryptoKey,
  saltId: string,
): Promise<CipherEnvelope> => {
  const bytes = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const payload = await encryptPlaintext(bytes, key);
  const sidecar = await sha256(bytes);
  return {
    c: bytesToBase64(payload.ciphertext),
    i: bytesToBase64(payload.iv),
    s: saltId,
    alg: CURRENT_ALG,
    h: bytesToBase64(sidecar),
  };
};
```

| Capa | Primitiva | Detalle |
| --- | --- | --- |
| Cifrado de réplicas (cliente) | AES-GCM-256 + PBKDF2-HMAC-SHA256 | IV de 12 bytes aleatorio por operación; sidecar SHA-256 para integridad; envoltura `{c, i, s, alg, h}` |
| *Passphrase* de cuenta (servidor) | PBKDF2-HMAC-SHA256 | 600 000 iteraciones (OWASP 2023), sal de 16 bytes por cuenta; también se admite Argon2id (`m=4096, t=1, p=1`) |
| Superficie KOSync | MD5 con sal | El protocolo fija `md5(password)`; el servidor solo compara digests y almacena `kosync-sha256$<sal>$<hash>` |
| Comparaciones de digest | Tiempo constante | `safeEqual` / `constantTimeEq` en `src/libs/crypto/` y `workers/minerva-sync/src/crypto.ts` |

> ⚠️ **Nota de precisión.** La *passphrase de sincronización* (la que cifra las réplicas) y la *passphrase de cuenta* (la que autentica al usuario) son **cosas distintas**. El Worker nunca ve ninguna de las dos: de la primera solo almacena la sal; de la segunda solo una derivación estirada.

**Aislamiento del contenido de libros.** El contenido de un EPUB se renderiza en un `<iframe>` con `sandbox` y sin ejecución de scripts externos. La navegación fuera del contexto del libro está bloqueada. Ver [`SECURITY.md`](../SECURITY.md) § *Attack Surfaces & Mitigations*.

**Superficie de archivos acotada.** En `src-tauri/src/lib.rs`, `allow_paths_in_scopes` extiende `fs_scope` y `asset_protocol_scope` **solo** para rutas que el diálogo de Tauri (o `persisted-scope` tras un reinicio) ya concedió. Sin esa puerta, una XSS hipotética a través del contenido de un libro podría concederse lectura del directorio home del usuario.

**Guardián de URL.** Las importaciones de novelas y las peticiones de recursos de sesión del navegador **rechazan IPs privadas y nombres de host locales**, y las redirecciones nativas se vuelven a comprobar antes de elegir.

### 2.3 Erradicación total de la telemetría

Este es el compromiso más fuerte del fork y, por tanto, el que más fácil puede romperse sin querer. La regla es:

> **Ninguna dependencia de analítica de producto. Ninguna llamada saliente a un tercero con fines de medición. Ningún identificador de usuario enviado a un servidor de terceros.**

Concretamente:

- **Cero PostHog.** No hay dependencia `posthog-js` ni `posthog-node` en ningún `package.json` del workspace, ni entrada en `pnpm-lock.yaml`.
- **Cero Sentry.** No hay `@sentry/*` en el workspace ni en el árbol de crates de Rust.
- **Cero Mixpanel / Amplitude / Segment / GA / gtag.** Verificado tanto en `package.json` como en `pnpm-lock.yaml`.
- **Cero crates de telemetría en Rust.** `apps/minerva-app/src-tauri/Cargo.toml` no declara ningún cliente de analítica.
- **Sin identificadores persistentes de usuario** enviados a terceros. Las APIs de pago (Stripe, IAP de Apple/Google) reciben lo que necesitan para cobrar, y el resto de la app no emite eventos de producto a ninguna parte.

Lo que **sí** existe y no es telemetría de producto:

| Mecanismo | Dónde | Por qué no es telemetría |
| --- | --- | --- |
| Estadísticas de lectura locales | `src/services/statistics/` → SQLite `statistics.db` | Se quedan en el dispositivo. Alimentan el widget «Continuar leyendo» y el panel de estadísticas. |
| `ReadingStatsTracker` | `src/app/reader/components/ReadingStatsTracker.tsx` | Escribe en la base local, no transmite nada. |
| `src/libs/payment/iap/telemetry.ts` | Verificaciones IAP | Registra el resultado de una compra en el backend propio para reconciliar facturación. Es contabilidad, no analítica de comportamiento. |
| Cloudflare Analytics Engine | `wrangler.toml` (`IAP_WEBHOOK_AE`, `STATS_COMPACT_AE`) | Métricas **del servidor autoalojado del usuario**, en su propia cuenta de Cloudflare. No salen de su infraestructura. |
| `head_sampling_rate = 0.01` en `[observability]` | `wrangler.toml` | Telemetría del propio Worker, en la cuenta de Cloudflare del usuario. Equivalente a las que hace cualquier aplicación autoalojada. |

**Protocolo de verificación de cero telemetría** (detalle operativo en §6.5):

```bash
# 1. Ninguna dependencia de analítica en el workspace
grep -rn "posthog\|@sentry\|mixpanel\|amplitude-js\|google-analytics\|gtag\|segment\.io" \
  --include=package.json apps/ packages/ | grep -v node_modules

# 2. Ninguna dependencia de analítica en el árbol de Rust
grep -n "posthog\|sentry\|analytics\|telemetry" apps/minerva-app/src-tauri/Cargo.toml

# 3. Ninguna llamada a un host de analítica en el código de aplicación
grep -rniE "posthog|sentry\.io|api\.mixpanel|api\.amplitude|collect\.google-analytics" \
  apps/minerva-app/src --include=*.ts --include=*.tsx
```

Los tres comandos deben devolver **cero coincidencias**. Este bloque forma parte del checklist de PR (§8.3).

### 2.4 Política de código abierto: AGPL v3 y créditos del upstream

Minerva se distribuye bajo la **GNU Affero General Public License v3.0 o posterior**. El texto completo está en [`LICENSE`](../LICENSE).

**Por qué AGPL y no MIT.** La AGPL añade la sección 13: si alguien ofrece Minerva modificado **a través de una red**, debe ofrecer el código fuente correspondiente. Para un proyecto cuyo valor central es «la infraestructura la controlas tú, el código también», es la licencia coherente.

**Deber de atribución.** `NOTICE` es de lectura obligatoria para cualquiera que redistribuya Minerva:

```text
Minerva
=======

Minerva is a modified version (fork) of Readest, https://github.com/readest/readest
Copyright (C) Bilingify LLC and the Readest contributors.

Both the original work and the modifications made in Minerva are distributed
under the GNU Affero General Public License, version 3 or (at your option) any
later version. The full text is in the LICENSE file. The original copyright and
license notices are preserved, as the license requires.

Modifications in Minerva include: a new name, visual identity (palette, typography,
icons) and user-facing text. Their dates and authors are recorded in the version
control history of this repository.

Under section 13 of the AGPL, anyone who uses a modified Minerva over a network
must be offered the corresponding source code. Publish your source repository
and set its URL in the About dialog (src/components/AboutWindow.tsx).

Third-party components keep their own licenses; see the "Acknowledgments"
section of README.md.
```

Consecuencias prácticas para quien contribuye:

1. **Se conservan los avisos de copyright de Readest y Bilingify LLC.** No se eliminan cabeceras de licencia de ficheros heredados.
2. **Las modificaciones se registran en el historial de Git.** Los cambios de Minerva (nombre, identidad visual, tipografías, textos) tienen fecha y autor en el control de versiones.
3. **Si despliegas Minerva modificado en red, publica la URL de tu repositorio** y ponla en el diálogo «Acerca de» (`src/components/AboutWindow.tsx`).
4. **Los componentes de terceros conservan sus licencias propias.** La sección *Reconocimientos* del `README` enumera foliate-js (MIT), zip.js (BSD-3), fflate (MIT), PDF.js (Apache-2.0), daisyUI (MIT), marked (MIT), Next.js (MIT), React (MIT), Tauri (MIT/Apache-2.0) y las tipografías incluidas.
5. **Ficheros de licencia submodulares.** `packages/tauri` (submódulo) trae `LICENSE-APACHE-2.0`, `LICENSE-MIT` y `LICENSE.spdx`; `packages/simplecc-wasm` y `packages/qcms` traen las suyas.

**Reporte de vulnerabilidades.** No abras una issue pública. Sigue el proceso de [`SECURITY.md`](../SECURITY.md).

---

## 3. Arquitectura del monorepo

### 3.1 Vista general

Minerva es un **monorepo pnpm** con un único workspace Rust embebido:

```text
minerva/
├── apps/
│   ├── minerva-app/                 # La aplicación (Next.js 16 + Tauri v2)
│   │   ├── src/                     # UI, servicios y estado (TypeScript)
│   │   ├── src-tauri/               # Backend nativo (Rust)
│   │   ├── workers/                 # Cloudflare Workers
│   │   │   ├── minerva-sync/        # <-- El backend autoalojable
│   │   │   ├── iap-reconcile/       # Conciliación de compras in-app
│   │   │   └── send-email/          # Recepción de correo de la extensión
│   │   ├── extensions/              # Extensión del navegador "Send to Minerva"
│   │   ├── e2e/                     # End-to-end de interfaz (Playwright)
│   │   └── docs/                    # Documentación técnica de la app
│   ├── minerva-calibre-plugin/      # Plugin de Calibre
│   ├── minerva-crosspoint-plugin/   # Plugin de CrossPoint
│   └── minerva.koplugin/            # Plugin para KOReader (Lua)
├── packages/                        # Dependencias con upstream propio (submódulos)
├── data/                            # Iconos, capturas y metadatos de release
├── docs/                            # Guías y runbooks
├── fastlane/                        # Automatización de publicación en tiendas
├── nix/                             # Empaquetado Nix
├── scripts/                         # Utilidades de desarrollo y despliegue
└── .github/                         # CI, plantillas y políticas
```

El workspace se declara en `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - apps/minerva-app/workers/send-email
  - apps/minerva-app/workers/iap-reconcile
  - apps/minerva-app/workers/minerva-sync
  - apps/minerva-app/extensions/*
  - packages/foliate-js
```

El workspace Cargo vive en el `Cargo.toml` de la raíz:

```toml
[workspace]
members = ["apps/minerva-app/src-tauri"]
exclude = ["packages/qcms", "packages/tauri"]
resolver = "2"

[patch.crates-io]
tauri = { path = "packages/tauri/crates/tauri" }
swift-rs = { path = "packages/swift-rs" }
# El runtime CEF solo existe en la build CEF de Linux; .cargo/cef.toml lo
# toma de feat/cef. El resto de builds solo necesitan resolverlo.
tauri-runtime-cef = { path = "packages/tauri-runtime-cef-stub" }

[profile.release]
codegen-units = 1
```

> La raíz del monorepo en este checkout es el directorio `Github/`. En el repositorio publicado es la raíz del repositorio. Todas las rutas de esta guía son relativas a esa raíz.

### 3.2 `apps/minerva-app` — la aplicación

El código TypeScript vive en `apps/minerva-app/src`:

| Ruta | Responsabilidad |
| --- | --- |
| `src/app/` | Páginas y rutas de API del App Router (`src/app/api/*`) |
| `src/pages/` | Páginas y rutas heredadas del Pages Router (`src/pages/api/*`) |
| `src/components/` | Primitivas y componentes compartidos (`primitives/`, `settings/`, `assistant/`, …) |
| `src/app/reader/` | El lector: ~80 componentes y ~30 hooks |
| `src/app/library/` | Biblioteca: rejilla, importación, orden, estanterías OPDS |
| `src/services/` | Lógica de negocio: TTS, traductores, OPDS, sync, IA, metadatos, diccionarios |
| `src/store/` | Stores Zustand |
| `src/hooks/` | Hooks de React reutilizables |
| `src/libs/` | Carga de documentos, pagos, almacenamiento, criptografía (`src/libs/crypto/`) |
| `src/plugins/` | Implementaciones de plugins incluidos (Yomitan) |
| `src/utils/` | Funciones puras |
| `src/workers/` | Web Workers para tareas en segundo plano |
| `src-tauri/` | Backend nativo en Rust |

La referencia de arquitectura de sistema (con diagramas Mermaid) está en [`apps/minerva-app/docs/architecture.md`](../apps/minerva-app/docs/architecture.md); el desglose de directorios, en [`code-layout.md`](../apps/minerva-app/docs/code-layout.md).

### 3.3 Capa de frontend

#### 3.3.1 Stack

| Capa | Tecnología | Versión |
| --- | --- | --- |
| Framework | Next.js (App Router + Pages Router) | 16.4.2 |
| UI | React | 19.2.8 |
| Bundler de producción | Next.js / Turbopack | — |
| Bundler alternativo | Vite + `vinext` | ver `vite.config.ts` |
| Estado | Zustand | 5.0.10 |
| Estilos | Tailwind CSS v4 + daisyUI v5 | CSS-first (`src/styles/globals.css`) |
| Componentes base | Radix UI primitives + `lucide-react` | — |
| Editor del cuaderno | TipTap (`@tiptap/react`, `tiptap-markdown`) | 3.32.x |
| Service worker | Serwist (`@serwist/next`) | 9.5.x |
| i18n | i18next + react-i18next, esquema *key-as-content* | 24.x |
| Tests | Vitest, Playwright, WebdriverIO | — |

#### 3.3.2 Estado: Zustand, no Jotai

Cada concern tiene **un** store de propósito único. Esto es deliberado: el lector es un sistema grande y un mega-contexto lo vuelve ingobernable.

```text
libraryStore        -> libros, carpetas, selección, orden
bookDataStore       -> datos por libro (TOC, anotaciones, ubicaciones)
readerStore         -> vistas activas, layout, estado del ribbon
parallelViewStore   -> lectura en dos paneles
notebookStore       -> panel lateral del cuaderno
settingsStore       -> ajustes de usuario y de la app
themeStore          -> claro/oscuro/atmósfera
sidebarStore        -> visibilidad y ancho de la barra lateral
appLockStore        -> bloqueo por PIN
deviceStore         -> perfil del dispositivo
transferStore       -> subidas/bajadas en curso
aiChatStore         -> sesiones de chat con IA
statisticsStore     -> estadísticas de lectura
```

**Regla para contributions.** No añadas un store nuevo sin antes justificar por qué no encaja en uno existente. Y no crees un store para estado que solo vive dentro de un componente: `useState` local es el sitio correcto.

#### 3.3.3 La abstracción de plataforma (`AppService`)

**La abstracción más importante del código.** Todo lo que toca «la plataforma» (sistema de ficheros, diálogos nativos, shell, TTS nativo, IAP, escaneo de directorios, deep links) pasa por la interfaz `AppService` de `src/services/appService.ts`, con tres implementaciones:

```text
nativeAppService.ts  -> Tauri (escritorio + móvil)
webAppService.ts     -> navegador (APIs web + OPFS)
nodeAppService.ts    -> Node (tests, CLI, tooling)
```

`src/services/environment.ts` decide en tiempo de ejecución cuál montar, según `NEXT_PUBLIC_APP_PLATFORM` y la detección de plataforma. El patrón de uso normal es:

```ts
const appService = useEnv().appService;
```

El mismo patrón se repite en la capa de base de datos (`src/services/database/`): `webDatabaseService` (Turso/WASM sobre OPFS), `nativeDatabaseService` (plugin `tauri-plugin-turso`) y `nodeDatabaseService` (tests). Las tres comparten `migrate.ts` y `migrations/*`.

**Dónde va cada cosa** (regla práctica, extraída de `docs/architecture.md` §9):

| Si el código… | Va a… |
| --- | --- |
| habla con un servicio remoto o escribe en almacenamiento compartido | `src/pages/api` o `src/app/api`, precedido de un servicio en `src/services` |
| toca el sistema de ficheros, diálogos, shell o TTS | `appService` → `nativeAppService` (comandos Rust) o `webAppService` |
| manipula contenido de libros, renderiza el lector o mantiene estado de UI | `src/app/reader`, `src/components`, `src/hooks`, `src/store` |
| es un asunto de sincronización | `src/services/sync` + la ruta API correspondiente |

### 3.4 Runtime nativo: Tauri v2 y CEF

El host Tauri vive en `apps/minerva-app/src-tauri`:

```text
src-tauri/src/
├── lib.rs                      -> registro de comandos, permisos, deep links, builder
├── main.rs                     -> punto de entrada
├── clip_url.rs                 -> captura de página renderizada
├── browser_fetch.rs            -> peticiones usando la sesión del navegador
├── browser_cookies_macos.rs    -> acceso al almacén de cookies de WebKit
├── dir_scanner.rs              -> escaneo recursivo de directorios (importación)
├── transfer_file.rs            -> subida/bajada por trozos para ficheros grandes
├── discord_rpc.rs              -> Discord Rich Presence (solo escritorio)
└── android/, macos/, windows/  -> pegamento por plataforma
```

Plugins Tauri:

- **Estándar:** `fs`, `dialog`, `http`, `opener`, `os`, `process`, `shell`, `cli`, `deep-link`, `haptics`, `log`, `updater`, `websocket`, `oauth`, `persisted-scope`, `device-info`, `sharekit`.
- **Propios del árbol:** `tauri-plugin-native-bridge` (puentes Android), `tauri-plugin-native-tts` (TTS nativo), `tauri-plugin-turso` (SQLite embebido), `tauri-plugin-webview-upgrade`.

#### 3.4.1 El runtime CEF de Linux

**Linux es el objetivo raro.** En lugar del WebKitGTK del `wry` por defecto, Minerva usa **CEF (Chromium Embedded Framework)**:

```toml
# apps/minerva-app/src-tauri/Cargo.toml
[features]
default = ["wry"]
# Runtime WebView2 / WKWebView, y en Linux el de WebKitGTK, que queda solo
# para el arnés de tests con webdriver (scripts/test-tauri.sh) — toda build
# de Linux que se distribuye corre sobre CEF y desactiva esto
# (`--no-default-features --features cef`, ver scripts/tauri.mjs).
wry = ["tauri/wry", "tauri/x11", "tauri/dbus"]
# Runtime Chromium Embedded Framework, el runtime de Linux (`pnpm tauri`).
cef = ["dep:tauri-runtime-cef", "dep:zbus", "tauri-plugin-native-bridge/cef"]
cargo-clippy = []
webdriver = ["tauri-plugin-webdriver"]
devtools = ["tauri/devtools", "tauri-runtime-cef?/devtools"]
```

El desafío es que **Cargo solo puede tener un `Cargo.lock`**, y el grafo de dependencias de CEF es distinto del de `wry`. La solución son **dos lockfiles versionados** y un intercambiador:

| Fichero | Grafo |
| --- | --- |
| `Cargo.lock` | Grafo `wry` (1032 paquetes). `tauri` resuelve al parche de ruta `packages/tauri`. `tauri-runtime-cef` resuelve al **stub**. |
| `Cargo.cef.lock` | Grafo `CEF` (1108 paquetes). `tauri` y `tauri-runtime-cef` resuelven a `git+https://github.com/readest/tauri?branch=feat/cef`. |

El intercambio lo hace `apps/minerva-app/scripts/tauri.mjs`:

```js
// apps/minerva-app/scripts/tauri.mjs
const CEF_CLI = '@tauri-apps/cli-cef@3.0.0-alpha.27';
const cargoCefCli = process.env['TAURI_CEF_CARGO'] === '1';
const cargoConfig = path.join(appDir, 'src-tauri/.cargo/cef.toml');
const lockPath = path.join(repoRoot, 'Cargo.lock');
const cefLockPath = path.join(repoRoot, 'Cargo.cef.lock');
const savedLockPath = path.join(repoRoot, 'Cargo.lock.wry');

const useCef = process.platform === 'linux' && ['dev', 'build', 'bundle'].includes(command);
```

Y el conjunto de parches que aplica al grafo CEF:

```toml
# apps/minerva-app/src-tauri/.cargo/cef.toml
[patch.crates-io]
tauri = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-build = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-codegen = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-macros = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-plugin = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-runtime = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-runtime-cef = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-utils = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
# ... más los plugins tauri-plugin-*
```

> ⚠️ **Restauración manual.** Si un build CEF muere con `SIGKILL` antes de restaurar el lock, el repositorio queda con `Cargo.lock.wry` huérfano. Recupéralo con:
>
> ```bash
> mv Cargo.lock.wry Cargo.lock
> ```
>
> El script aborta con un mensaje explícito si detecta ese estado, para que dos builds CEF simultáneos no se pisen.

**Comportamiento por plataforma:**

| Plataforma | Runtime | Flags |
| --- | --- | --- |
| Linux escritorio | **CEF** | `--features cef` + cargo `--no-default-features --config src-tauri/.cargo/cef.toml` |
| macOS / Windows | wry (WebKit / **WebView2**) | features por defecto (`wry`) |
| Linux móvil (`tauri android/ios`) | wry | wry también en Linux |
| Linux arnés webdriver | wry / WebKitGTK | `tauri dev --features webdriver` |
| Paquete Nix | **CEF** | `buildFeatures = [ "cef" ]; buildNoDefaultFeatures = true;` |

#### 3.4.2 Configuración de Tauri

```json
// apps/minerva-app/src-tauri/tauri.conf.json (extracto)
{
  "productName": "Minerva",
  "mainBinaryName": "minerva",
  "identifier": "com.minerva.app",
  "version": "../package.json",
  "build": {
    "frontendDist": "../out",
    "devUrl": "http://localhost:3000",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build && pnpm strip-sourcemaps"
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "windows": {
      "webviewInstallMode": { "type": "embedBootstrapper" },
      "nsis": { "installerHooks": "nsis/installer-hooks.nsh", "installMode": "both" }
    },
    "linux": {
      "appimage": { "files": { "bin/00-no-userns-prompt.hook": "appimage/00-no-userns-prompt.hook" } }
    },
    "android": { "minSdkVersion": 26 },
    "iOS": { "minimumSystemVersion": "16.4" },
    "createUpdaterArtifacts": true
  }
}
```

Observa `beforeBuildCommand`: la build de Tauri **siempre** ejecuta `pnpm strip-sourcemaps` (§6.5).

### 3.5 `packages/` — motores de renderizado y dependencias con upstream propio

`packages/` contiene **submódulos de Git** con dependencias que tienen su propio upstream y que Minerva parchea:

```text
packages/
├── foliate-js/               -> https://github.com/readest/foliate-js.git
├── tauri/                    -> https://github.com/readest/tauri.git
├── simplecc-wasm/            -> https://github.com/readest/simplecc-wasm.git
├── js-mdict/                 -> https://github.com/readest/js-mdict.git
├── qcms/                     -> https://github.com/mozilla/pdf.js.qcms.git
├── swift-rs/                 -> bindings Swift/ObjC (vendorizado, no submódulo)
└── tauri-runtime-cef-stub/   -> stub para builds que no usan CEF
```

**Motores de formato.** Minerva **no** reimplementa el parsing de libros; se apoya en `packages/foliate-js` (fork de Foliate JS):

| Fichero en `packages/foliate-js/` | Formato / función |
| --- | --- |
| `epub.js` | EPUB 2/3 (reflowable y fixed-layout) |
| `epubcfi.js` | CFI (EPUB Canonical Fragment Identifier) |
| `mobi.js` | MOBI, AZW, AZW3, KF8 |
| `fb2.js` | FB2 (FictionBook) |
| `comic-book.js` | **CBZ y CBR** (cómics) |
| `fixed-layout.js` | Libros de paginación fija |
| `dict.js` | Diccionarios |
| `footnotes.js` | Notas al pie |
| `search.js`, `text-walker.js`, `section-chunks.js` | Búsqueda y troceado de texto |
| `tts.js` | Media overlays / narración |
| `progress.js` | Progreso de lectura |
| `quote-image.js` | Cita como imagen |
| `reader.js`, `view.js`, `paginator.js`, `overlayer.js` | Renderizado y vistas |
| `opds.js` | Catálogos OPDS |
| `pdf.js` + `vendor/pdfjs/` | **PDF** vía PDF.js |
| `vendor/zip.js`, `vendor/fflate.js` | Descompresión ZIP |

`packages/js-mdict` implementa el formato **MDict** (diccionarios) y `packages/qcms` es el módulo de gestión de color de PDF.js.

**Conversión de tradicional a simplificado:** `packages/simplecc-wasm` (OpenCC en WASM), expuesto bajo el alias `@simplecc`.

**Aliases de resolución.** Ni `pdfjs-dist` ni `simplecc-wasm` se copian al `public/`; se resuelven desde `packages/` porque Tauri embebe todo lo publicado en `public/` y se empaquetaría dos veces (issue #6368):

```ts
// apps/minerva-app/vite.config.ts
resolve: {
  alias: {
    '@pdfjs': path.resolve('../../packages/foliate-js/node_modules/pdfjs-dist/legacy/build'),
    '@simplecc': path.resolve('../../packages/simplecc-wasm/dist/web'),
  },
},
```

**Importadores y conversores.** Viven en la app, no en `packages/`:

| Ubicación | Función |
| --- | --- |
| `src/services/ingestService.ts` | Decide si un libro se importa como copia por hash (`Books/<hash>/`) o **in situ** en la ruta elegida por el usuario |
| `src/services/send/conversion/` | Conversión artículo/URL → EPUB (`buildEpub.ts`, `convertToEpub.ts`, `assetBundler.ts`, `toc.ts`, `coverGenerator.ts`, `conversionWorker.ts`) |
| `src/services/transformers/` | Funciones puras: detección de idioma, normalización de puntuación, saneado, reescritura de notas, inyección de estilos, conversión chino, Warichu |
| `src/services/opds/` | Parseo de feeds OPDS y auto-descarga |
| `src/services/dictionaries/` | Importación de StarDict, MDict, DICT, SLOB y BGL |

### 3.6 El backend autoalojable: Cloudflare Workers + D1 + R2

El corazón del fork es `apps/minerva-app/workers/minerva-sync`: **un único Worker** que sirve la API completa.

```text
┌───────────────┐        ┌──────────────────────────────┐
│  Minerva      │  HTTPS │  Cloudflare Worker            │
│  (escritorio, │ ─────► │  minerva-sync                 │
│   móvil, web) │        │  ├─ D1  (SQLite)  cuentas,    │
│               │        │  │    libros, notas, réplicas │
│  KOReader     │ ─────► │  └─ R2  libros, portadas       │
└───────────────┘        └──────────────────────────────┘
```

**Dos superficies de API en el mismo Worker:**

| Superficie | Rutas | Quién la habla |
| --- | --- | --- |
| API nativa de Minerva | `/api/sync`, `/api/sync/replicas`, `/api/sync/replica-keys`, `/api/storage/*`, `/api/auth/*`, `/api/user/*` | La app (escritorio, móvil, web) |
| API compatible con KOSync | `/users/create`, `/users/auth`, `/syncs/progress` | KOReader y la integración «KOReader Sync» de Minerva |

**Estructura del Worker:**

```text
apps/minerva-app/workers/minerva-sync/
├── src/
│   ├── index.ts            # punto de entrada
│   ├── routes.ts           # tabla de rutas
│   ├── auth.ts             # emisión y verificación de tokens HS256
│   ├── accounts.ts         # registro, login, borrado de cuenta
│   ├── crypto.ts           # PBKDF2 / Argon2id / SHA-256 / MD5 con sal
│   ├── crdt.ts             # reglas de merge por campo (last-writer-wins)
│   ├── merge.ts            # aplicación de parches sobre una fila canónica
│   ├── push.ts, pull.ts    # subida y descarga incremental
│   ├── replicas.ts         # réplicas cifradas
│   ├── replicaKeys.ts      #.bootstrap de sales de passphrase
│   ├── replicaValidation.ts# allowlist de tipos, límites de tamaño, skew
│   ├── kosync.ts           # superficie KOSync
│   ├── storage.ts          # reserva de hueco, cuota, URLs firmadas
│   ├── storageTicket.ts    # tickets de descarga
│   ├── rows.ts, types.ts, http.ts
├── migrations/             # 0001_init.sql .. 0004_replicas_canonical_row.sql
└── wrangler.toml           # bindings de D1 y R2
```

**Migraciones:**

| Fichero | Qué hace |
| --- | --- |
| `0001_init.sql` | Esquema completo: cuentas, *throttle*, biblioteca, notas, ficheros, estadísticas, réplicas, sales, progreso KOSync y las vistas `book_highlights` / `book_bookmarks` |
| `0002_login_attempts.sql` | Tabla de intentos de inicio de sesión fallidos (bases que ejecutaron el primer esquema antes de que existiera) |
| `0003_kosync_progress.sql` | Tabla de progreso KOSync y las dos vistas |
| `0004_replicas_canonical_row.sql` | Reconstruye `replicas` con una fila por `(kind, replica_id)` y pliega las versiones que el esquema previo iba acumulando |

**Qué se guarda dónde:**

| Dato | Ubicación |
| --- | --- |
| Cuentas (email, digests estirados) | D1 `users` |
| Intentos fallidos de login | D1 `login_attempts` |
| Metadatos de biblioteca | D1 `books` |
| Progreso y ajustes de vista | D1 `book_configs` |
| Notas, resaltados, marcadores, tinta | D1 `book_notes` (y las vistas `book_highlights` / `book_bookmarks`) |
| Estadísticas de lectura | D1 `stat_books`, `stat_pages` |
| Ajustes, estanterías, traductores sincronizados | D1 `replicas`, `replica_keys` |
| Progreso KOReader | D1 `kosync_progress` |
| Ficheros de libro, portadas, blobs de réplicas | R2 `minerva-library` |

> Toda fila está acotada por `user_id` y toda consulta filtra por él: una cuenta nunca puede leer datos de otra.

**Modelo de merge.** El cliente publica **parches**, no filas completas: un cambio de ajustes solo lleva el campo que cambió. Por eso el servidor es el único sitio donde dos lados pueden combinarse:

- Un campo lo gana el sobre con el reloj mayor; a igualdad, el `device_id`.
- Una lápida es la lápida más grande vista, y una escritura nunca revive una fila lápida.
- Un manifiesto nunca lo limpia una versión que no lleva ninguno.
- El reloj de la fila nunca retrocede, así que el cursor de descarga es monótono.

Dos dispositivos que suben la misma réplica a la vez es seguro: la escritura es un compare-and-set sobre el reloj de la fila, y una carrera perdida relee y vuelve a combinar.

#### 3.6.1 Despliegue en un comando

```bash
git clone --recurse-submodules https://github.com/minerva/minerva.git
cd minerva

npx wrangler login          # abre el navegador la primera vez
./deploy-cloudflare.sh      # idempotente: se puede reejecutar
```

`scripts/deploy-cloudflare.sh` es idempotente y hace ocho pasos:

| Paso | Qué ocurre |
| --- | --- |
| 1 | Comprueba herramientas y sesión de Cloudflare (`wrangler whoami` / `wrangler login`) |
| 2 | Crea (o reutiliza) la base **D1** `minerva-sync` y extrae su `database_id` |
| 3 | Crea (o reutiliza) el bucket **R2** `minerva-library` |
| 4 | Escribe `database_id` y `bucket_name` en `wrangler.toml` sin tocar el resto |
| 5 | Genera un `JWT_SECRET` de 32 bytes y lo registra en **Cloudflare Secrets** (nunca en `wrangler.toml`) |
| 6 | Aplica las migraciones remotas (`0001`–`0004`) |
| 7 | Publica el Worker `minerva-cloudflare` en `*.workers.dev` |
| 8 | Comprueba `/health` y escribe `NEXT_PUBLIC_API_BASE_URL` en `apps/minerva-app/.env.local` |

Rotar el secreto sin invalidar sesiones:

```bash
./deploy-cloudflare.sh --rotate-secret
```

Despliegue manual, si prefieres control granular:

```bash
cd apps/minerva-app/workers/minerva-sync

wrangler d1 create minerva-sync         # imprime el database_id
wrangler r2 bucket create minerva-library
wrangler secret put JWT_SECRET           # 32+ caracteres aleatorios
pnpm migrate:remote                      # aplica 0001..0004
pnpm deploy
```

#### 3.6.2 Desarrollo local del Worker

```bash
cd apps/minerva-app/workers/minerva-sync

pnpm install
pnpm migrate     # aplica el esquema en el D1 local
pnpm dev         # wrangler dev en http://localhost:8787

# En otra terminal
curl -s http://localhost:8787/health
# {"status":"ok"}
```

Los tests del Worker (que ejecutan **las migraciones reales contra un SQLite real**) viven en la suite de la app:

```bash
cd apps/minerva-app
pnpm test --run src/__tests__/workers/
```

### 3.7 Workers hermanos

| Worker | Función |
| --- | --- |
| `workers/minerva-sync` | El backend de sincronización descrito arriba |
| `workers/iap-reconcile` | Conciliación de compras in-app (App Store / Google Play) |
| `workers/send-email` | Recepción de correo de la extensión «Send to Minerva»; normaliza adjuntos y los deja en la bandeja del usuario |

### 3.8 Plugins y superficies laterales

| Superficie | Ubicación | Notas |
| --- | --- | --- |
| Extensión de navegador «Send to Minerva» | `apps/minerva-app/extensions/send-to-minerva/` | Envía URLs y artículos a la app |
| Plugin de KOReader (Lua) | `apps/minerva.koplugin/` | Sincronización de lotes de palabras, con binarios de LocalSend compilados para `armv7` y `arm64` |
| Plugin de Calibre | `apps/minerva-calibre-plugin/` | Envío de libros desde Calibre |
| Plugin de CrossPoint | `apps/minerva-crosspoint-plugin/` | |
| Thumbnail de Windows | `apps/minerva-app/extensions/windows-thumbnail/` | DLL de shell extension, `windows_thumbnail.dll` |

### 3.9 El modelo de tres rutas de sincronización

Conviene no confundirlas:

1. **KOSync heredado** — `src/services/sync/KOSyncClient.ts` contra `pages/api/sync.ts` y `pages/api/kosync.ts`. Solo progreso de lectura. Existe por compatibilidad con clientes KOSync (KOReader).
2. **Réplicas (la ruta moderna)** — el cliente cifra cada réplica localmente con una clave derivada de la passphrase (`replicaCryptoMiddleware.ts`, `passphraseGate.ts`), publica deltas en `pages/api/sync/replicas.ts` y aplica los cambios remotos mediante adaptadores por categoría (`src/services/sync/adapters/*`: anotaciones, ajustes, diccionarios, tipografías, texturas, catálogos OPDS). El orquestador es `replicaSyncManager.ts`, y `replicaCursorStore.ts` registra «hasta dónde descargué» por categoría para que la sincronización sea incremental.
3. **Archivos de terceros** — motor neutral bajo `src/services/sync/file` con adaptadores para **WebDAV, Google Drive, S3, OneDrive e iCloud**. Guarda metadatos de estantería compartida en `library.json` junto a los ficheros de libro, portadas y configuración por libro. Los libros solo remotos aparecen como filas respaldadas por la nube; el fichero permanece remoto hasta que el usuario lo abre o descarga.

---

## 4. Configuración del entorno de desarrollo

### 4.1 Requisitos previos

| Herramienta | Versión | Para qué | Referencia |
| --- | --- | --- | --- |
| **Node.js** | 24 (mínimo 22) | Interfaz y build de Next.js | La CI usa Node 24; `build-all-platforms.yml` usa 22 |
| **pnpm** | 11.1.1 | Gestor de paquetes del monorepo | Fijado en `packageManager` del `package.json` raíz |
| **Rust / Cargo** | 1.90 o superior | Backend nativo de Tauri | `rust-version = "1.90"` en `src-tauri/Cargo.toml`. ⚠️ La build **CEF de Linux** necesita **Rust ≥ 1.95** |
| **Tauri prerequisites** | Según el sistema | Librerías del sistema | <https://v2.tauri.app/start/prerequisites/> |
| **Cloudflare CLI (wrangler)** | Reciente | Solo para el backend | `npx wrangler login` |
| **Android SDK + NDK** | NDK `28.2.13676358`, JDK 17 (Zulu), API 36 | Solo para builds Android | `sdkmanager "ndk;28.2.13676358"` |
| **Xcode** | 16 o superior | Solo para iOS/macOS | `xcode-select --install` |

Instalación rápida:

```bash
# Node con nvm
nvm install v24
nvm use v24

# pnpm (usa corepack para respetar la versión fijada)
corepack enable
corepack prepare pnpm@11.1.1 --activate

# Rust
rustup update
rustup component add clippy rustfmt
rustup target add aarch64-linux-android armv7-linux-androideabi  # si compilas Android
```

### 4.2 Dependencias del sistema en Linux

Para la build de escritorio con CEF:

```bash
sudo apt-get update
sudo apt-get install -y \
  pkg-config \
  libfontconfig-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1 libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1 \
  gir1.2-webkit2-4.1 \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf xdg-utils \
  libnss3 libpulse0 libspeechd2 libxkbcommon-x11-0
```

Para las pruebas de integración de Tauri (WebKitWebDriver):

```bash
sudo apt-get install -y xvfb
```

Para el plugin de KOReader (Lua):

```bash
sudo apt-get install -y luajit luarocks libsqlite3-dev
sudo luarocks --lua-version=5.1 install busted
sudo luarocks --lua-version=5.1 install lsqlite3complete
```

> La build CEF de Linux además **instala el CLI de tauri desde el fork**, porque el paquete npm `cli-cef` empaqueta un fork de `quick-sharun` roto:
>
> ```bash
> cargo install tauri-cli \
>   --git https://github.com/readest/tauri \
>   --rev 6beeb209b5514f597a26f48b7a5b9fe4c59b5f12 \
>   --locked --force
> ```

### 4.3 Clonar y preparar el árbol

```bash
git clone --recurse-submodules https://github.com/minerva/minerva.git
cd minerva

# Si ya lo tenías clonado sin submódulos:
git submodule update --init --recursive

pnpm install --frozen-lockfile

# Copia los assets vendorizados (PDF.js worker/WASM/cmaps/fuentes) a public/
pnpm --filter @minerva/app setup-vendors
```

`setup-vendors` ejecuta:

```bash
pnpm prepare-vendor            # mkdirp ./public/vendor/pdfjs
pnpm copy-pdfjs-worker         # pdf.worker.min.mjs
pnpm copy-pdfjs-wasm           # decodificadores WASM
pnpm copy-pdfjs-fonts          # cmaps + standard_fonts
pnpm copy-flatten-pdfjs-css    # CSS de la capa de anotaciones y de texto, aplanado con postcss
```

Comprobación de que el entorno está sano:

```bash
pnpm tauri info
```

### 4.4 Variables de entorno

Hay tres ficheros de entorno de la app, con un patrón fijo:

| Fichero | Propósito | `NEXT_PUBLIC_APP_PLATFORM` |
| --- | --- | --- |
| `.env.tauri` / `.env.tauri.local` | Build de escritorio y móvil | `tauri` |
| `.env.web` / `.env.web.example` | Build web (Cloudflare / Docker) | `web` |
| `.env.apple-appstore.local`, `.env.apple-nonstore.local`, `.env.ios-appstore.local`, `.env.google-play.local` | Datos de firma y tiendas | — |

Los scripts los cargan con `dotenv`, encadenando siempre el `.local` primero y el `.example` como respaldo:

```json
// apps/minerva-app/package.json
"dev":       "dotenv -e .env.tauri -e .env.tauri.example -- next dev",
"build":     "dotenv -e .env.tauri -e .env.tauri.example -- next build",
"dev-web":   "dotenv -e .env.web -e .env.web.example -- next dev",
"build-web": "dotenv -e .env.web -e .env.web.example -- next build"
```

#### 4.4.1 Variables de la app

```dotenv
# apps/minerva-app/.env.local.example
# Origen de tu Cloudflare Worker. La app le añade `/api` por su cuenta.
NEXT_PUBLIC_API_BASE_URL=https://minerva-cloudflare.<tu-subdominio>.workers.dev

# Autentica contra tu Worker en lugar de contra Minerva Cloud.
SELF_HOSTED_BACKEND=true
NEXT_PUBLIC_SELF_HOSTED_BACKEND=true

# Desbloquea las funciones de pago: en un despliegue propio no hay tienda.
SELF_HOSTED=true
NEXT_PUBLIC_SELF_HOSTED=true

# Passphrase de sincronización. Cifra en el cliente los campos sensibles que
# se suben; el servidor solo guarda la sal.
SYNC_PASSPHRASE=

# --- Opcionales -------------------------------------------------------------
NEXT_PUBLIC_STORAGE_FIXED_QUOTA=
MINERVA_TTS_CATALOG_URL=
```

> **Diferencia crítica entre los dos interruptores.**
> - `SELF_HOSTED=true` **desbloquea las funciones premium** (no hay tienda que consultar).
> - `SELF_HOSTED_BACKEND=true` **cambia la capa de cuenta**: te registras con email + passphrase contra tu Worker y la app **deja de hablar con Supabase por completo**.
>
> Un despliegue que solo quiera el desbloqueo premium mantiene `SELF_HOSTED_BACKEND` apagado y sigue usando Minerva Cloud.

#### 4.4.2 Variables del backend autoalojado

```dotenv
# .env.example (raíz del monorepo)
CF_ACCOUNT_ID=
CF_R2_BUCKET=minerva-library
CF_D1_DATABASE_ID=
JWT_SECRET=            # 32+ caracteres; se registra con `wrangler secret put JWT_SECRET`

NEXT_PUBLIC_API_BASE_URL=https://minerva-cloudflare.<tu-subdominio>.workers.dev
SELF_HOSTED_BACKEND=true
NEXT_PUBLIC_SELF_HOSTED_BACKEND=true
SELF_HOSTED=true
NEXT_PUBLIC_SELF_HOSTED=true
SYNC_PASSPHRASE=

ALLOWED_ORIGINS=*
MAX_UPLOAD_BYTES=104857600
STORAGE_FIXED_QUOTA=0
PASSPHRASE_KDF_ITERATIONS=600000
```

| Variable | Efecto |
| --- | --- |
| `ALLOWED_ORIGINS` | Lista separada por comas de orígenes de navegador autorizados. `*` vale para un despliegue personal |
| `MAX_UPLOAD_BYTES` | Techo de subida por libro. El límite de la plataforma es 100 MB; el Worker responde `413` en lugar de truncar |
| `STORAGE_FIXED_QUOTA` | Cuota por cuenta en bytes. `0` = sin cuota |
| `PASSPHRASE_KDF_ITERATIONS` | Iteraciones del PBKDF2. El número queda guardado con cada hash, así que bajarlo nunca invalida las cuentas ya creadas |

**Ningún valor real se versiona.** Solo se publican `.env.example`; los `.env.local` están en `.gitignore`.

### 4.5 Ejecutar la aplicación

```bash
# Desarrollo web (sin compilar Rust — el ciclo rápido)
pnpm dev-web

# Desarrollo de escritorio (compila el backend Rust)
pnpm tauri dev

# Vista previa con build OpenNext para web
pnpm preview
```

En Linux, `pnpm tauri dev` **usa el runtime CEF** (ver §3.4.1). Para inspeccionar la app en ejecución en Linux hay una vía CDP:

```bash
# Terminal 1 — build de dev con el endpoint CDP en 127.0.0.1:9222
pnpm tauri:dev:cdp

# Terminal 2
pnpm cdp targets                                     # listar objetivos depurables
pnpm cdp eval 'document.title'                       # ejecutar JS en la ventana
pnpm cdp eval 'window.__TAURI_INTERNALS__.invoke("plugin:app|version")'
pnpm cdp click 'button[aria-label="Import Books"]'   # eventos de puntero reales
pnpm cdp screenshot /tmp/library.png
pnpm cdp logs 30                                     # cola de la consola
```

> El IPC bridge no se puede falsear: `window.__TAURI_INTERNALS__.invoke` es no escribible y no configurable, así que asignarlo desde `eval` falla en silencio y el comando real se ejecuta.

### 4.6 Android e iOS

**Android** — la inicialización del proyecto Android se hace una vez:

```bash
rm -rf apps/minerva-app/src-tauri/gen/android
pnpm tauri android init
pnpm tauri icon ../../data/icons/minerva-book.png
git checkout apps/minerva-app/src-tauri/gen/android
```

Desarrollo en dispositivo o emulador:

```bash
pnpm tauri android dev
pnpm tauri android dev --host   # con un dispositivo real por USB
```

O el atajo que instala el APK de dev directamente:

```bash
pnpm --filter @minerva/app dev-android
```

**iOS** (solo macOS):

```bash
pnpm tauri ios init
pnpm tauri icon ../../data/icons/minerva-book.png
pnpm tauri ios dev
pnpm tauri ios dev --host
```

### 4.7 Worktrees

**Usa siempre `pnpm worktree:new`, nunca `git worktree add` a mano.** El script se encarga de la inicialización de submódulos, la instalación de dependencias, la copia de `.env`, los assets vendorizados y los enlaces simbólicos de `src-tauri/gen` que hacen falta para que el lint y los tests pasen.

```bash
pnpm worktree:new feat/mi-feature   # nueva rama desde origin/main
pnpm worktree:new 3837              # checkout del PR #3837 con acceso de push al fork
pnpm worktree:rm                    # limpieza
```

### 4.8 Nix

Si tienes Nix, el flake te da un shell con todas las dependencias:

```bash
nix develop           # shell para web y escritorio
nix develop .#android # shell para Android
nix develop .#ios     # shell para iOS (solo macOS)

nix build -L          # empaquetar
```

El paquete Nix se construye con **CEF**:

```nix
buildFeatures = [ "cef" ];
buildNoDefaultFeatures = true;
```

---

## 5. Guía de las nuevas funcionalidades del fork

Esta sección documenta las tres funcionalidades que distinguen a Minerva de Readest: dónde viven, cómo se estructuran, qué contrato tienen y cómo extenderlas sin romper nada.

### 5.1 Cuaderno de Notas Markdown

El cuaderno es un **documento Markdown por libro**, editable con un editor enriquecido (WYSIWYG) cuya formato durable es Markdown.

#### 5.1.1 Arquitectura

```text
apps/minerva-app/src/app/reader/components/notebook/
├── Notebook.tsx                    # Panel lateral: visibilidad, pin, ancho, responsive, atajos
├── NotebookEditor.tsx              # Cuerpo de la pestaña de notas: selector de capítulo, extractos, estado de guardado
├── RichNotebookEditor.tsx          # Editor TipTap. El formato durable es Markdown
├── NotebookToolbar.tsx             # Estilo de texto, negrita, cursiva, tachado, resaltado, listas, cita, "Citar del libro"
├── NotebookChapterSelector.tsx     # Selector de capítulo (TOC aplanado) + "Todas las notas" + salto al capítulo actual
├── NotebookTabNavigation.tsx       # Pestañas inferiores: notes / ai
├── NotebookTransitionAlert.tsx     # Modal: no se pudo guardar → mantener abierto / copiar borrador / descartar / reintentar
├── Header.tsx                      # Anclar / desanclar / cerrar
├── AIAssistant.tsx                 # Pestaña de IA (assistant-ui + RAG Reedy)
└── extensions/
    ├── notebookEditorExtensions.ts     # Pila de extensiones TipTap + atajo Mod-Enter → guardar
    └── notebookMarkdownExtensions.ts   # NotebookHighlight (mark) y BookLink (mark con data-cfi)
```

**Servicios y utilidades:**

| Fichero | Responsabilidad |
| --- | --- |
| `src/store/notebookStore.ts` | Estado del panel: ancho, visible, anclado, pestaña activa, borradores de anotación |
| `src/store/notebookDocumentStore.ts` | **Estado real del documento**, indexado por `bookHash`: contenido, contenido durable, revisión, revisión guardada, estado, error, recuperación |
| `src/app/reader/services/notebookDocumentCoordinator.ts` | Orquesta guardado, debounce, flush y recuperación. `NOTEBOOK_SAVE_DEBOUNCE_MS = 750` |
| `src/app/reader/hooks/useNotebookDocumentCoordinator.ts` | Enlace con React; mapa de coordinadores a nivel de módulo por hash de libro |
| `src/app/reader/utils/notebookDocument.ts` | `NOTEBOOK_MAX_BYTES = 256 * 1024`, validación de mutaciones, `upsertNotebookRecord`, inserción respecting CRLF |
| `src/app/reader/utils/notebookRecovery.ts` | Persistencia de recuperación en `localStorage` |
| `src/app/reader/utils/notebookChapters.ts` | `flattenToc`, `matchExcerptChapter`, `parseChapterSections`, `getChapterContent` |
| `src/app/reader/utils/notebookCitation.ts` | **Vinculación por libro**: esquema `minerva-cfi:` |
| `src/app/reader/utils/notebookMarkdown.ts` | `serializeNotebookEditor` ( workaround de un bug de espacios en `tiptap-markdown`) |

#### 5.1.2 Modelo de datos

El cuaderno es un **registro singleton reservado** dentro de la configuración del libro:

```ts
// apps/minerva-app/src/types/book.ts
export type BookNoteType = 'bookmark' | 'annotation' | 'excerpt' | 'notebook' | 'ink';
```

```ts
// apps/minerva-app/src/app/reader/utils/notebookDocument.ts
export const NOTEBOOK_ID = 'notebook';

export const findNotebookRecord = (booknotes: BookNote[]): BookNote | undefined =>
  booknotes.find((note) => note.id === NOTEBOOK_ID);

export const upsertNotebookRecord = (
  booknotes: BookNote[],
  patch: { note: string; updatedAt: number; cfi?: string },
): BookNote[] => { /* ... */ };
```

**El contrato durable**, tal como queda en disco:

```json
{
  "id": "notebook",
  "type": "notebook",
  "cfi": "<creationTimeBookCfi>",
  "note": "# Título\n\nCuerpo en **Markdown**.\n",
  "createdAt": 1764300000000,
  "updatedAt": 1764300123456
}
```

#### 5.1.3 Persistencia en tres capas

| Capa | Ubicación | Cuándo se escribe |
| --- | --- | --- |
| **Durable** | `Books/<book.hash>/config.json` → `BookConfig.booknotes[]` | Tras el debounce de 750 ms, mediante `useBookDataStore.updateBooknotes()` → `appService.saveBookConfig()` |
| **Recuperación** | `window.localStorage`, clave `minerva:notebook-recovery:<profileId>:<bookHash>` | En cada mutación, antes de intentar el guardado durable |
| **Nube** | `POST /api/sync` → Worker → D1 `book_notes` | Cuando la sincronización de notas está activa |

**El perfil de la clave de recuperación** se resuelve en este orden:

```ts
// src/app/reader/hooks/useNotebookDocumentCoordinator.ts
const profileId = user?.id ?? settings.replicaDeviceId ?? settings.kosync.deviceId ?? 'anonymous-profile';
```

> **No requiere migración de base de datos.** Las columnas `book_notes.type` y `book_notes.note` son de texto; el tipo `'notebook'` no necesita esquema nuevo. Las vistas `book_highlights` y `book_bookmarks` filtran por tipos conocidos, así que el cuaderno queda automáticamente excluido de ellas.

#### 5.1.4 Máquina de estados del documento

```ts
// src/store/notebookDocumentStore.ts
type NotebookDocumentStatus =
  | 'clean'
  | 'dirty'
  | 'saving'
  | 'error'
  | 'waiting-for-position'
  | 'recovery-choice';

type NotebookDocumentError = 'size-limit' | 'recovery-unavailable' | 'save-failed' | null;
```

| Estado | Significado |
| --- | --- |
| `clean` | El contenido en memoria coincide con el durable |
| `dirty` | Hay cambios sin guardar |
| `saving` | Guardado en vuelo |
| `error` | El guardado falló; el error concreta el motivo |
| `waiting-for-position` | No hay un CFI válido todavía (el libro aún no ha cargado una posición) |
| `recovery-choice` | Hay un borrador en `localStorage` que diverge del durable; el usuario decide |

**Resolución de conflictos:** si el borrador local y la versión guardada difieren, `resolveNotebookRecovery()` devuelve `'none' | 'restore' | 'diverged'`, y el modal `NotebookTransitionAlert` ofrece *recuperar el borrador* o *usar la última versión guardada*.

**Límite de tamaño:** 256 KiB UTF-8 por libro, medidos con `TextEncoder`. **Nunca se trunca**: si el documento excede el límite, el error `size-limit` bloquea el guardado y la interfaz pide copiar o quitar texto.

#### 5.1.5 La vinculación por libro

Hay **dos mecanismos** complementarios:

**a) Citas con CFI (enlaces Markdown).** El esquema `minerva-cfi:` permite que un enlace Markdown sobreviva a un round-trip de serialización:

```ts
// src/app/reader/utils/notebookCitation.ts
export const NOTEBOOK_CFI_SCHEME = 'minerva-cfi:';

export const buildNotebookCitationHref = (cfi: string): string =>
  `${NOTEBOOK_CFI_SCHEME}${encodeURIComponent(cfi)}`;

export const readNotebookCitationCfi = (href: string): string | null => {
  if (!href.startsWith(NOTEBOOK_CFI_SCHEME)) return null;
  return decodeURIComponent(href.slice(NOTEBOOK_CFI_SCHEME.length));
};
```

El dropdown **«Citar del libro»** de la barra de herramientas inserta una cita en bloque cuyo segundo párrafo lleva la marca `BookLink` con el `cfi` del extracto. Al pulsar el enlace, la app navega a la posición exacta:

```ts
export const navigateToNotebookCitation = async (bookKey: string, cfi: string) => {
  window.dispatchEvent(new CustomEvent('navigate'));
  await view.goTo(cfi);
};
```

**b) Jerarquía por capítulo.** El documento se particiona por capítulo con marcadores que viven *dentro* del Markdown:

```text
<!-- minerva-chapter:cap1:El despertar -->
```

`parseChapterSections()` los detecta, `getChapterContent()` extrae la sección, y `NotebookChapterSelector` permite acotar el editor a un capítulo concreto o a las notas generales.

#### 5.1.6 Formato durable y resaltados

```ts
// src/app/reader/components/notebook/extensions/notebookMarkdownExtensions.ts
export const NOTEBOOK_HIGHLIGHT_COLORS = ['yellow', 'mint', 'blue', 'coral'] as const;
```

Los nombres de color **son parte del contrato durable** del Markdown: `==texto==` se traduce a `<mark data-color="mint">texto</mark>`. Si cambias un nombre, estás rompiendo la compatibilidad con cuadernos ya escritos.

Configuración del serializador:

```ts
// extensions/notebookEditorExtensions.ts
Markdown.configure({
  html: false,
  linkify: false,
  breaks: false,
  tightLists: true,
  bulletListMarker: '-',
})
```

> `underline: false` — el subrayado no es portable en Markdown y por eso está deshabilitado.

#### 5.1.7 Exportación

> ⚠️ **Nota de precisión.** El cuaderno **no tiene exportación propia**. El diseño original (*Notebook Linked Writing Workspace*, sección *Copy to Notebook and legacy excerpts*) lo excluye explícitamente: «Notebook export is not added in this issue».
>
> Lo que sí existe:
>
> - **Exportación de anotaciones y extractos** a Markdown mediante `src/app/reader/components/annotator/ExportMarkdownDialog.tsx`. El cuaderno se **excluye deliberadamente** de esa exportación:
>
>   ```ts
>   // src/app/reader/components/annotator/Annotator.tsx
>   const allNotes = notes.filter((note) => note.type !== 'notebook' && !note.deletedAt);
>   ```
>
> - **«Copy to Notebook»** (`viewSettings.copyToNotebook`), que crea o actualiza un registro de tipo `excerpt` y abre el panel del cuaderno. **No inserta en el documento del cuaderno**; el «Insert into Notebook» se eliminó.
>
> Si necesitas exportar el cuaderno, la vía hoy es copiar y pegar el Markdown desde el editor.

#### 5.1.8 i18n

El proyecto usa el esquema *key-as-content*: **la clave de traducción es la cadena en inglés**.

```json
// apps/minerva-app/public/locales/es/translation.json
{
  "Notebook": "Cuaderno",
  "Notes": "Notas",
  "Excerpts": "Extractos",
  "All notes": "Todas las notas",
  "Saving…": "Guardando…",
  "Saved": "Guardado",
  "Couldn't save": "No se pudo guardar",
  "Notebook is too large to save. Copy or remove some text to continue.":
    "El cuaderno es demasiado grande para guardarse. Copia o elimina texto para continuar."
}
```

Para añadir una cadena: usa `_('English string')` en el componente y ejecuta `pnpm --filter @minerva/app i18n:extract`.

### 5.2 Búsqueda contextual de imágenes web

Permite buscar imágenes de personajes, lugares o conceptos **sin salir de la lectura**, e insertarlas en la nota del usuario.

#### 5.2.1 Fuentes

**Wikipedia y Wikimedia Commons**, mediante las APIs públicas de MediaWiki. No hay Unsplash, Pexels ni Pixabay, y **no hay generación de imágenes con IA**.

| Fuente | Endpoint | Límite |
| --- | --- | --- |
| Wikipedia | `https://{lang}.wikipedia.org/w/api.php` | 12 resultados |
| Wikimedia Commons | `https://commons.wikimedia.org/w/api.php` | 15 resultados |

#### 5.2.2 Servicio

```text
apps/minerva-app/src/services/imageSearch/imageSearchService.ts
```

```ts
export interface ImageSearchResult {
  id: string;
  title: string;
  thumbnailUrl: string;
  originalUrl: string;
  extract?: string;
  source: 'wikipedia' | 'wikimedia' | 'custom';
  pageUrl?: string;
  width?: number;
  height?: number;
}
```

Tres funciones públicas:

| Función | Qué hace |
| --- | --- |
| `searchWikipediaImages(query, lang = 'es', limit = 10, signal?)` | Consulta `generator=search` + `prop=pageimages\|extracts`; **cae automáticamente a `en`** si el idioma del libro no devuelve nada |
| `searchWikimediaCommons(query, limit = 12, signal?)` | `gsrnamespace=6` + `prop=imageinfo` con `extmetadata`; limpia el prefijo `File:` del nombre y extrae `ImageDescription` / `ObjectName` (truncado a 200 caracteres) |
| `searchPersonImages(query, lang = 'es', signal?)` | `Promise.allSettled` sobre las dos fuentes, deduplica por `thumbnailUrl` sin query string, y pone los resultados de Wikipedia primero |

Todas usan `AbortSignal.timeout(10000)` y respetan el `AbortController` del diálogo, de modo que una búsqueda nueva cancela la anterior.

#### 5.2.3 Interfaz de usuario

```text
apps/minerva-app/src/app/reader/components/annotator/ImageSearchDialog.tsx
```

| Pieza | Detalle |
| --- | --- |
| Props | `{ isOpen, initialQuery, bookLanguage?, onSelectImage, onClose }` |
| Búsqueda automática | Al abrir, busca la consulta precargada (normalmente el texto seleccionado) |
| Selector de idioma | `es`, `en`, `fr`, `de`, `it`, `pt`; inicial derivado de `bookLanguage`, por defecto `es` |
| Fuentes | `all` / `wikipedia` / `commons` / `custom` (URL pegada a mano) |
| Previsualización | Vista previa de la imagen antes de confirmar |
| Resumen biográfico | Casilla `includeExtract` (por defecto activada) que añade el extracto como cita Markdown |
| Diálogo | `Dialog` con `snapHeight={0.85}` y `SegmentedControl` |

#### 5.2.4 Flujo completo

```text
Usuario selecciona texto en el lector
        │
        ▼
AnnotationTools → botón «Foto» (type: 'image')
        │
        ▼
handleOpenImageSearch(targetNoteId?)
  · siembra la consulta con selection.text
  · cierra el popup de anotación
  · suprime los manejadores nativos de selección
        │
        ▼
ImageSearchDialog → fetch directo a wikipedia.org / commons.wikimedia.org
        │
        ▼
handleSelectImageForNote(data)
  · construye `![title](url)` + `\n\n> extract` (opcional)
  · si hay una anotación destino: saveBooknoteNoteText(noteId, markdown)
  · si no: crea/usa el resaltado en el CFI de la selección y anexa
  · toast «Photo attached to note»
```

El botón está registrado en `AnnotationTools.tsx`:

```ts
{
  type: 'image',
  label: _('Photo'),
  tooltip: _('Search photo or attach image'),
  Icon: LuImagePlus,
  quickAction: true,
}
```

#### 5.2.5 Privacidad

**Solo la cadena de búsqueda sale del dispositivo.** Nunca se envía contenido del libro, ni el título, ni el extracto. La imagen se inserta como Markdown en la nota, que se guarda en el `config.json` local del libro y se sincroniza con el mecanismo normal de notas.

#### 5.2.6 Estado y persistencia

No hay store, ni atomo, ni base de datos, ni endpoint de backend: es un `fetch` directo a las APIs públicas con los resultados en `useState` local del diálogo. La única persistencia es el Markdown resultante, que aterriza en la nota (`BookNote.note`).

### 5.3 Widget «Continuar Lectura»

Minerva añade a la biblioteca un **póster de continuar lectura**: una pieza de identidad visual que muestra el último libro en curso, su progreso y el tiempo restante estimado.

> ⚠️ **Nota de precisión — dos cosas distintas.** Minerva incorpora además los *widgets de pantalla de inicio* de Android/iOS (`src/services/widget/readingWidget.ts`, `bookshelfWidget.ts`, `src/hooks/useHomeScreenWidgets.ts`), pero **eso es funcionalidad de Readest upstream**, no del fork. Lo propio de Minerva es el póster de biblioteca que se describe aquí.

#### 5.3.1 Componentes

```text
apps/minerva-app/src/app/library/components/ContinueReadingHero.tsx   # El póster
apps/minerva-app/src/app/library/components/BookSpine.tsx              # BookSpine + BookFolio
apps/minerva-app/src/app/library/components/Bookshelf.tsx              # Selección del libro
apps/minerva-app/src/app/library/utils/libraryUtils.ts                  # Progreso y tiempo restante
apps/minerva-app/src/hooks/useMedianPageDurationSecs.ts                 # Ritmo de lectura
```

#### 5.3.2 Selección del libro

El póster **solo** aparece en la vista por defecto de la biblioteca, sin filtros activos, y elige el libro en lectura más recientemente actualizado:

```ts
// src/app/library/components/Bookshelf.tsx
const continueReadingBook = useMemo(() => {
  if (queryTerm || contentSearch?.query.trim() || groupId || shelfId || isSelectMode) return null;
  const candidates = visibleBooks.filter((book) => {
    if (book.readingStatus !== 'reading') return false;
    const percentage = getProgressPercentage(book);
    return percentage !== null && percentage > 0 && percentage < 100;
  });
  if (!candidates.length) return null;
  return candidates.reduce((latest, book) =>
    (book.updatedAt ?? 0) > (latest.updatedAt ?? 0) ? book : latest);
}, [...]);
```

| Regla | Valor |
| --- | --- |
| Vista | Solo la biblioteca sin búsqueda, sin grupo, sin estantería y fuera del modo selección |
| Estado | `readingStatus === 'reading'` |
| Progreso | Estrictamente entre 0 % y 100 % (ni recién abierto ni terminado) |
| Elección | El de `updatedAt` más reciente |

#### 5.3.3 La "lomo" (`BookSpine`) — la firma visual

```text
apps/minerva-app/src/app/library/components/BookSpine.tsx
```

Es una regla vertical en el borde de la portada cuya parte rellena equivale al progreso de lectura, mediante la variable CSS `--minerva-spine-progress`. Solo se dibuja para libros ya abiertos (`readingStatus === 'finished' || progress > 0`).

El resto del póster: portada, título, autor (`formatAuthors`), barra de progreso con `role='progressbar'` y `aria-label={_('Reading progress')}`, `BookFolio`, tiempo restante estimado, botón «Continuar» y una cifra grande de porcentaje sobre un panel tonal (`minerva-poster`, `minerva-halftone`).

Si el progreso es `null` o `NaN`, el componente devuelve `null`.

#### 5.3.4 Persistencia del estado y del progreso

| Dato | Ubicación | Detalle |
| --- | --- | --- |
| Progreso de lectura | `Book.progress: [number, number]` en el array de biblioteca → `Books/library.json` | `libraryStore` → `appService.saveLibraryBooks()` → `safeSaveJSON(fs, 'library.json', 'Books', …)` |
| Ritmo de lectura | **SQLite** `statistics.db` (`StatisticsDb`) | `db.getBookByMd5(hash)` → `db.getMedianPageDurationSecs(book.id)` |
| Estadísticas de lectura | `src/services/statistics/` | Locales; alimentan el widget y el panel |

**El guardado de la biblioteca tiene un throttle de 30 segundos** (`scheduleLibrarySave` en `src/store/bookDataStore.ts`), con `flushPendingLibrarySave()` al desmontar o al perder el foco.

**La base de datos no es IndexedDB.** Es SQLite: el plugin `tauri-plugin-turso` en nativo, y **OPFS + Turso/WASM** en web (`navigator.storage.getDirectory()` en `src/services/webAppService.ts`).

#### 5.3.5 Cálculo del tiempo restante

```ts
// src/app/library/utils/libraryUtils.ts
export const getProgressPercentage = (book: Book): number | null => { /* ... */ };

export const getTimeRemainingMinutes = (
  book: Book,
  medianPageDurationSecs?: number,
): number | null => { /* ... */ };  // los audiolibros usan `duration`

export const getDisplayedTimeRemaining = (
  book: Book,
  medianPageDurationSecs?: number,
): string | undefined => { /* ... */ };  // undefined para terminado/abandonado/sin leer
```

El ritmo se obtiene con `useMedianPageDurationSecs(book.hash)`, que lee la mediana de segundos por página de `StatisticsDb`.

---

## 6. Testing, calidad de código y seguridad

### 6.1 Capas de test

El proyecto usa **Vitest** para casi todo, y WebdriverIO para el E2E de interfaz completa:

| Sufijo | Comando | Entorno | Para qué |
| --- | --- | --- | --- |
| `*.test.ts` | `pnpm test` | jsdom | Lógica pura, utilidades, servicios sin APIs de navegador ni IPC |
| `*.browser.test.ts` | `pnpm test:browser` | Chromium (Playwright) | Web Workers, `SharedArrayBuffer`, OPFS, WASM |
| `*.tauri.test.ts` | `pnpm test:tauri` | WebView de Tauri | Comandos de plugin, sistema de ficheros nativo, IPC |
| `*.e2e.ts` | `pnpm test:e2e` | App Tauri (WDIO) | Interacción de UI, gestión de ventanas, navegación |
| `*.android.test.ts` | `pnpm test:android` | Dispositivo Android (CDP) | Selección nativa, gestos táctiles, *handles* de selección |

Referencia completa: [`apps/minerva-app/docs/testing.md`](../apps/minerva-app/docs/testing.md).

### 6.2 Ejecutar los tests

```bash
# Suite unitaria (modo watch)
pnpm test

# Suite unitaria, una sola vez
pnpm test --run

# Solo un fichero (¡sin `--` delante del path!)
pnpm test --run src/__tests__/utils/misc.test.ts

# Solo un test por nombre
pnpm test -t "notebook"

# Navegador
pnpm test:browser

# Cobertura
pnpm --filter @minerva/app test:coverage

# Extensión de navegador
pnpm --filter @minerva/app test:extension
```

**Configuraciones:**

| Fichero | Configura |
| --- | --- |
| `vitest.config.mts` | jsdom, `setupFiles: ['./vitest.setup.ts']`, exclusión de las suites browser/tauri/android/e2e |
| `vitest.browser.config.mts` | Chromium vía `@vitest/browser-playwright` |
| `vitest.tauri.config.mts` | `@vitest/browser-webdriverio`, conecta al WebDriver del puerto 4445 |
| `vitest.android.config.mts` | Entorno Node, ejecución serial, `retry: 1` |
| `wdio.conf.ts` | WebdriverIO + Mocha |

### 6.3 Verificación de tipos y lint (TypeScript + Biome)

```bash
# Verificación de tipos + lint de Biome (ambos)
pnpm lint

# Solo tipos
pnpm --filter @minerva/app exec tsc --noEmit

# Solo Biome
pnpm --filter @minerva/app exec biome lint .

# Formato
pnpm format          # escribe (biome format --write .)
pnpm format:check    # comprueba sin escribir
```

`biome.json` está en la raíz y se aplica a todo el monorepo salvo `packages/`, `node_modules/`, `gen/`, `.next/`, `out/`, `target/`, `fastlane/` y los artefactos vendorizados. Configuración clave:

```json
{
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  }
}
```

> Los `.mjs`, `.cjs` y `.mts` están excluidos del formateador de Biome. Pásalos por tu editor o por `prettier` si lo prefieres, pero **no** rompas el `format:check` de CI.

### 6.4 Rust: fmt, clippy y tests

```bash
pnpm fmt:check       # cargo fmt -p Minerva --check
pnpm clippy:check    # cargo clippy -p Minerva --no-deps -- -D warnings
pnpm --filter @minerva/app test:rust   # cargo test -p Minerva --lib
```

Y desde `apps/minerva-app/src-tauri`:

```bash
cargo fmt --check
cargo clippy -p Minerva --no-deps -- -D warnings
cargo test -p Minerva --lib
```

> Si tocas `apps/minerva-app/src-tauri/**`, **actualiza el `Cargo.lock` que corresponda**: `Cargo.lock` para el grafo `wry` y `Cargo.cef.lock` para el grafo `CEF`. El checklist de PR lo pide explícitamente.

### 6.5 Protocolo de verificación de cero telemetría

Este es el control de calidad específico del fork. Se ejecuta en tres niveles.

#### 6.5.1 Nivel 1 — Análisis estático del código fuente

```bash
# 1.1 Ninguna dependencia de analítica en el workspace
grep -rn "posthog\|@sentry\|mixpanel\|amplitude-js\|google-analytics\|gtag\|segment\.io" \
  --include=package.json apps/ packages/ | grep -v node_modules
# → debe salir vacío

# 1.2 Ninguna dependencia de analítica en el árbol de crates
grep -n "posthog\|sentry\|analytics\|telemetry" apps/minerva-app/src-tauri/Cargo.toml
# → debe salir vacío

# 1.3 Ningún host de analítica en el código de aplicación
grep -rniE "posthog|sentry\.io|api\.mixpanel|api\.amplitude|collect\.google-analytics|googletagmanager" \
  apps/minerva-app/src --include=*.ts --include=*.tsx
# → debe salir vacío

# 1.4 Ninguna llamada fetch/XHR a un host no permitido
grep -rnoE "https?://[a-zA-Z0-9.-]+\.[a-z]{2,}" apps/minerva-app/src --include=*.ts --include=*.tsx \
  | grep -vE "example\.(com|org|test)|localhost|\.invalid|minerva\.invalid"
# → cada resultado debe ser un servicio que el usuario haya configurado a propósito
```

#### 6.5.2 Nivel 2 — Inspección del bundle construido

```bash
pnpm --filter @minerva/app build

# 2.1 Ningún SDK de analítica en el bundle de producción
grep -rniE "posthog|sentry\.io|mixpanel|amplitude" apps/minerva-app/out/ apps/minerva-app/.next/
# → debe salir vacío

# 2.2 Verificación de que no se filtran los source maps
pnpm --filter @minerva/app strip-sourcemaps
find apps/minerva-app/out/_next/static -name '*.js.map' | wc -l
# → debe ser 0
```

**Sobre `strip-sourcemaps.mjs`.** Este script (`apps/minerva-app/scripts/strip-sourcemaps.mjs`) forma parte del contrato de privacidad de la build, aunque su objetivo no es la telemetría sino **evitar que el código fuente original viaje dentro del binario**:

```js
// apps/minerva-app/scripts/strip-sourcemaps.mjs
export const stripSourceMappingComment = (code) =>
  code.replace(/\n\/\/# sourceMappingURL=[^\n]*/g, '');

export const stripMaps = (dir) => {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) removed += stripMaps(full);
    else if (entry.endsWith('.js.map')) {
      rmSync(full);
      removed += 1;
    } else if (entry.endsWith('.js')) {
      const code = readFileSync(full, 'utf8');
      const stripped = stripSourceMappingComment(code);
      if (stripped !== code) writeFileSync(full, stripped);
    }
  }
  return removed;
};
```

Se ejecuta automáticamente en cada build de Tauri (`beforeBuildCommand: "pnpm build && pnpm strip-sourcemaps"`). Para builds de desarrollo con depuración:

```bash
KEEP_SOURCEMAPS=1 pnpm --filter @minerva/app dev-macos
```

#### 6.5.3 Nivel 3 — Verificación dinámica

```bash
# 3.1 Levanta la app web y observa el tráfico saliente
pnpm dev-web

# En DevTools → Network, filtra por Fetch/XHR:
#   · no debe aparecer ningún host de analítica
#   · las peticiones a /api/* van solo a NEXT_PUBLIC_API_BASE_URL
#   · las peticiones a wikipedia.org / commons.wikimedia.org solo ocurren
#     cuando el usuario usa explícitamente la búsqueda de imágenes
```

En la build CEF de Linux, la misma verificación con CDP:

```bash
pnpm tauri:dev:cdp
pnpm cdp logs 30
```

#### 6.5.4 Nivel 4 — Regresión en CI

El `secret-scan.yml` ejecuta **gitleaks** sobre el historial completo:

```yaml
- uses: gitleaks/gitleaks-action@ff98106e… # v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}
```

> El `fetch-depth: 0` es intencional: «The whole history: a leaked key stays in the log even after it is removed from the tip».

El `codeql.yml` analiza `actions`, `javascript-typescript` y `rust` con `build-mode: none`, y el `scorecard.yml` publica el OpenSSF Scorecard.

#### 6.5.5 Nivel 5 — Verificación binaria del artefacto

Un `strings | grep -iE "sentry|posthog"` sobre el APK **no basta**: Tauri incrusta el bundle del frontend en la biblioteca nativa **comprimido con brotli**, así que el texto JavaScript no aparece en el binario, y el grep solo ve las cadenas sin comprimir (el binario Rust, el DEX). Para verificar de verdad lo que se distribuye, `apps/minerva-app/scripts/verify-no-telemetry.mjs` descomprime el artefacto antes de buscar:

```bash
# El artefacto completo (descomprime el APK y busca en cada entrada)
node apps/minerva-app/scripts/verify-no-telemetry.mjs \
  apps/minerva-app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk

# El frontend incrustado (los blobs brotli de tauri-codegen)
node apps/minerva-app/scripts/verify-no-telemetry.mjs --brotli \
  target/aarch64-linux-android/release/build/Minerva-*/out/tauri-codegen-assets
```

El script clasifica cada coincidencia en dos niveles:

- **telemetry** — un SDK, un endpoint o una clave reales (`io.sentry`, `@sentry/`, `sentry.io`, `posthog.com`, `SentryInitProvider`, …). **Falla la compilación.**
- **incidental** — el nombre del proveedor aparece solo como substring de otro identificador. En este proyecto son las propiedades de pdf.js que terminan en `Entry` (`canvasEntry`, `settingsEntry`, `hasXfaDatasetsEntry`): la «s» final de la palabra anterior más `Entry` forman «sentry». Se informa con su contexto para que una persona los confirme, pero no rompen la compilación.

El paso `verify no telemetry` de `build-all-platforms.yml` ejecuta esta comprobación sobre cada artefacto de la matriz.

### 6.6 El modelo de seguridad en resumen

El §*Threat Model* de [`SECURITY.md`](../SECURITY.md) es la referencia. Resumen:

| Superficie | Riesgo | Mitigación |
| --- | --- | --- |
| Parsing de ebooks | Ficheros malformados → XSS o path traversal | Renderizado en `<iframe>` con sandbox, scripts externos bloqueados, parsing aislado del proceso principal |
| Sincronización y autenticación | Robo de credenciales o acceso cruzado | HTTPS/TLS, tokens en el almacén seguro del SO, autorización por `user_id` en cada consulta |
| Catálogos OPDS | Servidor malicioso que sirve XML manipulado | Parseo defensivo, fuentes añadidas explícitamente por el usuario, descargas tratadas como contenido no confiable |
| HTML/JS embebido en el libro | XSS o exfiltración | `<iframe>` con sandbox y restricciones de scripting, navegación fuera del libro bloqueada |
| Cadena de suministro | Dependencia comprometida | `pnpm-lock.yaml` y `Cargo.lock` fijados, Dependabot y revisión de dependencias de GitHub activas |
| Tauri IPC | Abuso de comandos desde contenido web | Allowlist de capacidades; el acceso a ficheros se limita al directorio de datos de la app y a las rutas ya concedidas por el diálogo |

---

## 7. Compilación y empaquetado multiplataforma

### 7.1 Comandos de build

Todos se ejecutan desde `apps/minerva-app` salvo indicación contraria.

| Objetivo | Comando | Salida |
| --- | --- | --- |
| Build web | `pnpm build-web` | `.next/` + `out/` |
| Build web (Vite/vinext) | `pnpm build-web:vinext` | — |
| Build Tauri (frontend) | `pnpm build` | `out/` (export estático) |
| Linux AppImage | `pnpm build-linux-x64` | `target/release/bundle/appimage/` |
| Windows (instalador NSIS) | `pnpm build-win-x64` | `target/<triple>/release/bundle/nsis/` |
| Windows ARM64 | `pnpm build-win-arm64` | idem |
| macOS universal (DMG) | `pnpm build-macos-universial` | `target/universal-apple-darwin/release/bundle/dmg/` |
| macOS universal (App Store) | `pnpm build-macos-universial-appstore` | `.app` |
| iOS | `pnpm build-ios` / `pnpm build-ios-appstore` | `.ipa` |
| Android (dev) | `pnpm dev-android` | APK de debug |
| Desktop completo | `pnpm tauri build` | según la plataforma |

> ⚠️ **Errata heredada del upstream.** El script `build-win-x64` usa el target `i686-pc-windows-msvc` (32 bits) pese al nombre. Si necesitas un PE32+ de 64 bits, invoca el CLI directamente:
>
> ```bash
> cd apps/minerva-app
> pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
> ```
>
> El mismo desajuste de nombres existe en `build-macos-universial*` («universial» en lugar de «universal»). Son nombres de script, no errores de funcionalidad; no los «corrijas» sin actualizar también las referencias en `.github/workflows/`.

### 7.2 Linux — AppImage con CEF

**El flujo de build de Linux es especial:** el CLI de tauri se instala desde el fork, y el grafo de dependencias se intercambia con `Cargo.cef.lock`.

```bash
# 1. CLI de tauri desde el fork de CEF
cargo install tauri-cli \
  --git https://github.com/readest/tauri \
  --rev 6beeb209b5514f597a26f48b7a5b9fe4c59b5f12 \
  --locked --force

# 2. Build (el wrapper scripts/tauri.mjs se encarga del intercambio de lockfiles)
cd apps/minerva-app
pnpm tauri build --bundles appimage
```

Salida:

```text
target/release/bundle/appimage/Minerva.AppImage
```

**El hook de AppImage.** `src-tauri/appimage/00-no-userns-prompt.hook` desactiva el prompt de contraseña root que el *fix-namespaces* hook estándar de AppImage pide para habilitar los *user namespaces* sin privilegios:

```sh
#!/bin/sh
# Sourced by AppRun before the bundler's own hooks (glob order). Its
# fix-namespaces hook asks for a root password to enable unprivileged user
# namespaces, which this build never needs: CEF runs without the sandbox
# feature, every child with --no-sandbox.
notify() { return 1; }
run_gui_sudo() { return 1; }
```

**Verificación del bundle** (lo que hace `try-appimage.yml`):

```bash
APPIMAGE_DIR=target/release/bundle/appimage/Minerva.AppDir

# Bibliotecas de runtime que deben estar presentes
for lib in libsoftokn3.so libfreeblpriv3.so libnssckbi.so libsqlite3.so.0 \
           libpulse.so.0 libspeechd.so.2 libxkbcommon-x11.so.0; do
  test -e "$APPIMAGE_DIR/lib/$lib" || echo "FALTA: $lib"
done

# El directorio de pulseaudio y su entrada en lib.path
test -d "$APPIMAGE_DIR/lib/pulseaudio"
grep -q '+/pulseaudio' "$APPIMAGE_DIR/lib.path"

# El hook sin prompt de userns
test -e "$APPIMAGE_DIR/bin/00-no-userns-prompt.hook"
```

**La CI de AppImage** (`.github/workflows/try-appimage.yml`) es de disparo manual y cubre dos arquitecturas:

| Eje | Runner | Objetivo Rust |
| --- | --- | --- |
| `x86_64` | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` |
| `aarch64` | `ubuntu-22.04` | `aarch64-unknown-linux-gnu` |

Sus pasos: checkout con submódulos → pnpm/Node 24 → `pnpm install --frozen-lockfile --prefer-offline` → `pnpm --filter @minerva/app setup-vendors` → toolchain de Rust + caché → instalación del CLI CEF → dependencias apt → **staging de las librerías de runtime de CEF** (parcheo con `jq` de `tauri.conf.json` para añadir `/usr/lib/libspeechd.so.2` y `/usr/lib/libxkbcommon-x11.so.0`) → build con `TAURI_CEF_CARGO=1` → verificación del contenido del AppImage → subida del artefacto.

### 7.3 Windows — PE32+ portable con WebView2

En Windows el runtime es **wry/WebView2**, no CEF.

```bash
cd apps/minerva-app

# Instalador NSIS (64 bits)
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis

# Portable .exe (PE32+)
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
```

**El ejecutable portable** se produce en la CI (`release.yml`, paso *build and upload portable binaries*):

```bash
pushd apps/minerva-app/
echo "NEXT_PUBLIC_PORTABLE_APP=true" >> .env.local
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
popd

exe_file="target/x86_64-pc-windows-msvc/release/minerva.exe"
cp $exe_file "Minerva_${version}_x64-portable.exe"
gh release upload $RELEASE_TAG "Minerva_${version}_x64-portable.exe" --clobber
pnpm tauri signer sign "Minerva_${version}_x64-portable.exe"
gh release upload $RELEASE_TAG "Minerva_${version}_x64-portable.exe.sig" --clobber
```

> Nota del propio workflow: «Browsers on Windows won't download zip files that contain exe files so upload the exe files instead. This is totally stupid.» Por eso el portable se publica como `.exe` y no como `.zip`.

**WebView2.** El instalador embebe el *bootstrapper*:

```json
"windows": {
  "webviewInstallMode": { "type": "embedBootstrapper" }
}
```

Y el plugin `webview-upgrade` fija el rango de versiones soportadas:

```json
"plugins": {
  "webview-upgrade": { "minUpgradeMajor": 121, "minSupportedMajor": 111 }
}
```

**Extensión de miniaturas del Explorador.** La DLL `windows_thumbnail.dll` se compila aparte:

```bash
cargo build --package windows_thumbnail --release --target x86_64-pc-windows-msvc
mkdir -p extensions/windows-thumbnail/target
cp target/x86_64-pc-windows-msvc/release/windows_thumbnail.dll extensions/windows-thumbnail/target/
```

Y se empaqueta como recurso mediante `src-tauri/tauri.windows.conf.json`:

```json
{
  "bundle": {
    "resources": {
      "../extensions/windows-thumbnail/target/windows_thumbnail.dll": "minerva_thumbnail.dll"
    }
  }
}
```

Los *hooks* de NSIS (`src-tauri/nsis/installer-hooks.nsh`) registran y desregistran el manejador de miniaturas para `.epub .mobi .azw .azw3 .kf8 .fb2 .cbz .cbr .pdf`.

**Requisitos de compilación en Windows:** «Build Tools for Visual Studio 2022» con el flujo *Desktop development with C++*; para ARM64, los componentes *VS 2022 C++ ARM64 build tools* y *C++ Clang Compiler for Windows*, con `clang` en el `PATH`.

### 7.4 Android — APK firmado con Gradle

**El proyecto Android lo genera la CLI de Tauri.** No es un proyecto Gradle puro: no existe `./gradlew assembleRelease`.

**El proyecto Android está versionado.** `src-tauri/gen/android/` se hace seguimiento en git porque lleva el flavor FOSS, la configuración de firma (`keystore.properties`) y el paso `llvm-strip`, ninguno de los cuales está en la plantilla de la CLI. `tauri android init` solo rellena los archivos que aún no existen, así que el proyecto versionado sobrevive a la inicialización.

**Inicialización (una vez):**

```bash
cd apps/minerva-app
pnpm tauri android init
pnpm tauri icon ../../data/icons/minerva-book.png
git checkout .
```

> No borres `src-tauri/gen/android` antes de la inicialización: eso elimina el proyecto versionado y deja la plantilla vanilla de la CLI, sin firma ni flavor FOSS.

**Configuración de firma** — `src-tauri/gen/android/app/build.gradle.kts` lee `keystore.properties`:

```kotlin
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = java.util.Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}

signingConfigs {
    if (keystorePropertiesFile.exists()) {
        create("signing") {
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["password"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["password"] as String
        }
    }
}

buildTypes {
    getByName("release") {
        isMinifyEnabled = true
        if (keystorePropertiesFile.exists()) {
            signingConfig = signingConfigs.getByName("signing")
        }
    }
}
```

Valores de compilación: `compileSdk = 36`, `targetSdk = 36`, `minSdk = 26`, `jvmTarget = "1.8"`, `applicationId = "com.minerva.app"`.

**Variantes de sabor:**

| `storeFlavor` | `penFlavor` | Uso |
| --- | --- | --- |
| `foss` (por defecto) | `genericPen` (por defecto) | F-Droid y APK directo |
| `googleplay` | `booxPen` | Google Play y dispositivos e-ink BOOX |

> El sabor `googleplay` fija `carAppMetaName = "com.minerva.app.androidauto.withheld"` porque la revisión de Auto de Play rechaza la app (issues #5038 / #5235).

**Build:**

```bash
cd apps/minerva-app

# Un APK universal
pnpm tauri android build -t aarch64

# Por ABI (lo que hace la CI)
pnpm tauri android build -t aarch64        # arm64-v8a
pnpm tauri android build -t armv7          # armeabi-v7a
pnpm tauri android build -t i686 -t x86_64 # legacy
```

El APK sale en:

```text
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

**Firma en CI** (`release.yml`):

```bash
cd apps/minerva-app/
pnpm tauri android init
pnpm tauri icon ../../data/icons/minerva-book.png
git checkout .

pushd src-tauri/gen/android
echo "keyAlias=${{ secrets.ANDROID_KEY_ALIAS }}" > keystore.properties
echo "password=${{ secrets.ANDROID_KEY_PASSWORD }}" >> keystore.properties
base64 -d <<< "${{ secrets.ANDROID_KEY_BASE64 }}" > $RUNNER_TEMP/keystore.jks
echo "storeFile=$RUNNER_TEMP/keystore.jks" >> keystore.properties
popd

pnpm tauri android build -t aarch64
cp src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk \
   "Minerva_${version}_arm64.apk"
gh release upload $RELEASE_TAG "Minerva_${version}_arm64.apk" --clobber
pnpm tauri signer sign "Minerva_${version}_arm64.apk"
```

**Variables de entorno de la CI:** `NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358`, Java 17 (distribución Zulu), `sdkmanager "ndk;28.2.13676358"`.

**Publicación en Google Play** — `scripts/release-google-play.sh`:

```bash
# Quita REQUEST_INSTALL_PACKAGES del manifest (no lo permite Play)
# Comprueba que MANAGE_EXTERNAL_STORAGE sigue presente
source .env.google-play.local
ORG_GRADLE_PROJECT_storeFlavor=googleplay \
  pnpm tauri android build --config src-tauri/tauri.playstore.conf.json

# Escribe el changelog (truncado a 480 caracteres)
# → fastlane/metadata-play/android/en-US/changelogs/default.txt

fastlane android upload_production
```

> `src-tauri/tauri.playstore.conf.json` **no está versionado en este checkout**. Créalo antes de usar esta ruta.

**Validación del listing** (sin subir nada):

```bash
pnpm --filter @minerva/app validate-google-play
```

### 7.5 macOS — binario universal

```bash
cd apps/minerva-app

# DMG de distribución directa (no App Store)
pnpm build-macos-universial
# → tauri build -t universal-apple-darwin --bundles dmg \
#     --config src-tauri/tauri.macos-nonestore.conf.json

# App Store
pnpm build-macos-universial-appstore
# → tauri build -t universal-apple-darwin --bundles app \
#     --config src-tauri/tauri.appstore.conf.json
```

Targets de Rust: `x86_64-apple-darwin,aarch64-apple-darwin`. Salida en `target/universal-apple-darwin/release/bundle/macos/`.

El perfil de distribución directa lleva sus propios entitlements:

```json
// src-tauri/tauri.macos-nonestore.conf.json
{
  "bundle": {
    "macOS": {
      "minimumSystemVersion": "12.0",
      "entitlements": "./profiles/direct-entitlements.plist",
      "files": {
        "embedded.provisionprofile": "./profiles/MinervaDeveloperID.provisionprofile"
      }
    }
  }
}
```

Hay dos overlays más, ambos versionados:

- `src-tauri/tauri.macos-unsigned.conf.json` — la misma configuración **sin** el perfil de aprovisionamiento. Es la que usa `build-all-platforms.yml`: un perfil emitido por Apple solo tiene sentido junto a su clave privada, así que un binario sin certificado no debe llevar uno incrustado.
- `src-tauri/tauri.ci.conf.json` — desactiva `bundle.createUpdaterArtifacts`. Con los artefactos del actualizador activados, el empaquetador exige `TAURI_SIGNING_PRIVATE_KEY` y la compilación falla sin ese secreto.

**Publicación en el Mac App Store** (`scripts/release-mac-appstore.sh`):

```bash
jq --arg version "$CURRENT_DATE" '.bundle.macOS.bundleVersion = $version' \
  src-tauri/tauri.appstore.conf.json
pnpm run build-macos-universial-appstore

BUNDLE_DIR=../../target/universal-apple-darwin/release/bundle/macos
xcrun productbuild --sign "$APPLE_INSTALLER_SIGNING_IDENTITY" \
  --component $APP_BUNDLE /Applications $INSTALLER_BUNDLE
xcrun altool --upload-app --type macos --file $INSTALLER_BUNDLE \
  --apiKey $APPLE_API_KEY --apiIssuer $APPLE_API_ISSUER
```

### 7.6 iOS

```bash
pnpm build-ios-appstore
# → tauri ios build --export-method app-store-connect
# → src-tauri/gen/apple/build/arm64/Minerva.ipa
```

El script de release aplica las correcciones y verificaciones de entitlements **antes** de subir, y aborta si algo falla (`set -euo pipefail`):

```bash
pnpm --filter @minerva/app release-ios-appstore
```

### 7.7 Actualizador automático

`createUpdaterArtifacts: true` genera los artefactos firmados con minisign. El manifiesto `latest.json` se actualiza por plataforma:

| Clave de plataforma | Artefacto |
| --- | --- |
| `windows-x86_64` | Instalador NSIS |
| `windows-x86_64-portable` | `.exe` portable |
| `windows-aarch64` / `windows-aarch64-portable` | Equivalente ARM64 |
| `darwin-x86_64` / `darwin-aarch64` | `.dmg` / `.app` |
| `linux-x86_64-appimage` | `.AppImage` |
| `android-arm64` / `android-armv7` / `android-legacy` | APK por ABI |
| `android-universal` | Alias de `android-armv7` para clientes pre-split |

Los endpoints configurados son:

```json
"plugins": {
  "updater": {
    "pubkey": "...",
    "endpoints": [
      "https://download.minerva.invalid/releases/latest.json",
      "https://github.com/minerva/minerva/releases/latest/download/latest.json"
    ]
  }
}
```

### 7.8 Resumen de comandos de build

```bash
# --- Frontend ---
pnpm dev-web                              # servidor de desarrollo web
pnpm --filter @minerva/app build-web      # build web
pnpm --filter @minerva/app build          # build para Tauri (export estático)

# --- Escritorio ---
pnpm tauri dev                            # desarrollo (CEF en Linux)
pnpm tauri build                          # bundle de escritorio
pnpm --filter @minerva/app build-linux-x64            # AppImage
pnpm --filter @minerva/app build-win-x64              # NSIS
pnpm --filter @minerva/app build-win-arm64            # NSIS ARM64
pnpm --filter @minerva/app build-macos-universial      # DMG universal

# --- Móvil ---
pnpm --filter @minerva/app dev-android
pnpm --filter @minerva/app build-ios
pnpm --filter @minerva/app build-ios-appstore

# --- Backend autoalojado ---
pnpm deploy:cloudflare                    # script idempotente de 8 pasos

# --- Empaquetado Nix ---
nix build -L
```

---

## 8. Flujo de contribución

### 8.1 Antes de escribir código

1. **Lee [`CONTRIBUTING.md`](../CONTRIBUTING.md)**, [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) y [`SECURITY.md`](../SECURITY.md).
2. **Abre una issue** si el cambio es una opinión sobre el producto o una funcionalidad nueva. La política del proyecto es explícita: *«If you want to make code changes based on your personal opinion(s), make sure you open an issue first describing the changes you want to make, and open a pull request only when your suggestions get approved by maintainers.»*
3. **Busca en el rastreador de issues** si ya hay una propuesta o un fix conocido.
4. **Lee [`apps/minerva-app/docs/contributors.md`](../apps/minerva-app/docs/contributors.md)** antes de revisar un PR de la comunidad: qué detiene una revisión por posible daño, qué se cierra sin revisar y quién está bloqueado o vigilado.
5. **Lee [`apps/minerva-app/LESSONS.md`](../apps/minerva-app/LESSONS.md)**: qué se hizo mal en el trabajo fusionado recientemente y qué regla lo habría atrapado.

### 8.2 Ramas y commits

**Ramas.** El proyecto usa nombres de rama con prefijo de tipo:

```text
feat/descripcion-corta
fix/descripcion-corta
refactor/descripcion-corta
docs/descripcion-corta
chore/descripcion-corta
```

Trabaja en un worktree:

```bash
pnpm worktree:new feat/mi-feature
```

**Commits.** Convenciones claras, con `feat`, `fix`, `docs`, `refactor`, `build` (los mismos tipos que acepta el selector de la plantilla de PR).

```text
<tipo>(<ámbito>): <descripción en imperativo, minúsculas, sin punto final>

< cuerpo: por qué, no qué. Referencia la issue cuando la haya. >

<ejemplo>
feat(notebook): permitir citar desde el capítulo actual

La cita se insertaba siempre en el final del documento, lo que obligaba a
desplazar el texto para encontrar el enlace al extracto. Ahora se inserta
en la sección del capítulo en el que está el cursor.

Closes #5917
</ejemplo>
```

Reglas del proyecto que importan:

- **Nunca incluyas datos internos en texto público.** Commits, títulos y cuerpos de PR, issues y respuestas de revisión son públicos. No incluyas números de usuarios, datos de pago o suscripción, ni identificadores como correos o ids de sesión. Describe el mecanismo, no las cifras.
- **Actualiza los lockfiles correspondientes** cuando tocas dependencias: `pnpm-lock.yaml` y `Cargo.lock` / `Cargo.cef.lock`.
- **Formato automático**: `husky` + `lint-staged` ejecutan `biome format --write` sobre los ficheros staged en cada commit.

### 8.3 Checklist de revisión de PR (centrado en privacidad)

La plantilla oficial de PR es [`PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md) y ya está en español. Su checklist:

```markdown
## Checklist

- [ ] El codigo compila y los tests pasan localmente.
- [ ] No he anadido credenciales, claves ni datos personales.
    Las variables de entorno van en `.env` (ignorado por git); el repositorio
    solo publica `.env.example`.
- [ ] He actualizado la documentacion afectada.
- [ ] Los commits siguen el formato convencional.
- [ ] Si el cambio toca `apps/minerva-app/src-tauri/**`, he actualizado el
    `Cargo.lock` correspondiente.
```

**Añade a ese checklist el bloque de privacidad**, que es el filtro específico del fork:

```markdown
### Privacidad y telemetría

- [ ] Ningún paquete nuevo de analítica (PostHog, Sentry, Mixpanel, Amplitude,
      Segment, GA). Verificado con:
      `grep -rn "posthog\|@sentry\|mixpanel\|amplitude" --include=package.json apps/ packages/`
- [ ] Ninguna llamada saliente a un tercero que no haya pedido el usuario.
      Si el cambio introduce un servicio externo, está documentado en el
      README y es desactivable.
- [ ] Ningún dato de lectura, de biblioteca o de cuenta se envía fuera del
      servidor autoalojado.
- [ ] Los secretos nuevos van a `.env` y el `.env.example` está actualizado.
- [ ] Si toca `src-tauri/**`, `cargo clippy -p Minerva --no-deps -- -D warnings`
      pasa y no se ha ampliado la allowlist de capacidades de Tauri.
```

### 8.4 Verificación local antes de subir

```bash
# Frontend
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm test --run

# Si toca Rust
pnpm fmt:check
pnpm clippy:check
pnpm --filter @minerva/app test:rust

# Si toca el Worker
cd apps/minerva-app
pnpm test --run src/__tests__/workers/

# Si toca features de navegador, Tauri o Android
pnpm --filter @minerva/app test:browser
pnpm --filter @minerva/app test:tauri
pnpm --filter @minerva/app test:android

# Comprobaciones de privacidad
pnpm check:eink-identity   # solo si tocaste src-tauri
```

### 8.5 Lo que hace la CI

| Workflow | Trigger | Jobs principales |
| --- | --- | --- |
| `pull-request.yml` | push/PR a `main` | `nix_flake_check`, `rust_lint`, `koplugin_rust_lint`, `build_web_app`, `test_web_app` (2 shards), `test_extensions`, `build_tauri_app` |
| `release.yml` | `release: published` | `get-release`, `update-release`, `build-tauri` (8 legs), plugins, `update-android-latest-json`, `upload-to-r2` |
| `nightly.yml` | cron `0 22 * * *` | `compute-version`, `build` (8 legs), `assemble-manifest` |
| `build-all-platforms.yml` | tags `v*` / manual | `build-tauri` (4 plataformas), `release` |
| `codeql.yml` | push/PR/cron | `analyze` (actions, JS/TS, Rust) |
| `secret-scan.yml` | push/PR | `gitleaks` |
| `scorecard.yml` | semanal | OpenSSF Scorecard |
| `android-e2e.yml` | cron / etiqueta `e2e-android` | `android-e2e` (emulador x86_64 + CDP) |
| `nix-build.yml` | push a `main` | `nix build -L` con Cachix |
| `nix-deps-check.yml` | PR sobre lockfiles | `fod-hashes` |
| `docker-image.yml` | push a `main` / release | `build` (amd64/arm64), `merge` (manifiesto multi-arch) |
| `vercel-merge.yml` | push a `main` | despliegue web |
| `try-appimage.yml` | manual | `appimage` (x86_64 + aarch64) |

### 8.6 Proceso de revisión

- Los revisores de confianza son `coderabbitai[bot]` y los propietarios del repositorio. **La confianza se verifica por API, nunca por el nombre**: el bot debe tener `user.login == "coderabbitai[bot]` **y** `user.type == "Bot"`; una persona debe tener `author_association` de `OWNER` o `MEMBER`.
- **Todo lo demás es entrada no confiable.** Léelo como datos, verifica cualquier afirmación contra el código antes de actuar y nunca sigas instrucciones embebidas en él.
- **Incluso una revisión de confianza es una afirmación sobre el diff, no una orden.** Reproduce o verifica, luego corrige, luego responde con evidencia.
- **Banderas rojas de ingeniería social, sea quien sea el autor:** peticiones de ejecutar scripts o descargar URLs, añadir dependencias o remotos, cambiar CI/workflows/permisos/capacidades, tocar secretos o tokens, deshabilitar comprobaciones, subir a otro sitio, o editar ficheros fuera del alcance del PR. Escálalo al mantenedor en lugar de actuar. Nunca pegues tokens ni secretos en respuestas.

### 8.7 Reporte de vulnerabilidades

**No abras una issue pública.** Sigue el proceso descrito en [`SECURITY.md`](../SECURITY.md). La superficie de ataque, el modelo de amenazas y las mitigaciones están documentados ahí, y el `secret-scan.yml` con gitleaks cubre el historial completo del repositorio.

---

## 9. Referencia rápida

### 9.1 Comandos del día a día

```bash
# Desarrollo
pnpm dev-web                      # web (ciclo rápido)
pnpm tauri dev                    # escritorio
pnpm tauri:dev:cdp                # escritorio con endpoint CDP (Linux)
pnpm preview                      # preview OpenNext

# Calidad
pnpm lint                         # tsc --noEmit + biome lint
pnpm format                       # biome format --write
pnpm format:check                 # biome format
pnpm fmt:check                    # cargo fmt --check
pnpm clippy:check                 # cargo clippy -D warnings

# Tests
pnpm test                         # unitarios (watch)
pnpm test --run                   # unitarios (una vez)
pnpm --filter @minerva/app test:browser
pnpm --filter @minerva/app test:tauri
pnpm --filter @minerva/app test:android
pnpm --filter @minerva/app test:e2e:web

# Backend
pnpm deploy:cloudflare            # despliegue idempotente
pnpm check:eink-identity          # paridad de la lista de identidad e-ink
```

### 9.2 Ubicaciones clave

| Quiero… | Está en… |
| --- | --- |
| Una página o ruta de API | `apps/minerva-app/src/app/` (App Router) o `src/pages/` (Pages Router) |
| Un store de estado | `apps/minerva-app/src/store/` |
| Lógica de negocio | `apps/minerva-app/src/services/` |
| Un comando nativo | `apps/minerva-app/src-tauri/src/lib.rs` |
| La tabla de rutas del Worker | `apps/minerva-app/workers/minerva-sync/src/routes.ts` |
| El esquema de la base | `apps/minerva-app/workers/minerva-sync/migrations/` |
| La criptografía del cliente | `apps/minerva-app/src/libs/crypto/` |
| Los motores de formato | `packages/foliate-js/` |
| La config de Tauri | `apps/minerva-app/src-tauri/tauri.conf.json` |
| La config de CEF | `apps/minerva-app/src-tauri/.cargo/cef.toml` |
| El wrapper de build | `apps/minerva-app/scripts/tauri.mjs` |
| Las traducciones | `apps/minerva-app/public/locales/<idioma>/translation.json` |
| Los estilos globales | `apps/minerva-app/src/styles/globals.css` |

### 9.3 Comandos de verificación de privacidad

```bash
# Sin dependencias de analítica
grep -rn "posthog\|@sentry\|mixpanel\|amplitude-js\|google-analytics\|gtag" \
  --include=package.json apps/ packages/ | grep -v node_modules

# Sin telemetría en Rust
grep -n "posthog\|sentry\|analytics\|telemetry" apps/minerva-app/src-tauri/Cargo.toml

# Sin hosts de analítica en el código
grep -rniE "posthog|sentry\.io|api\.mixpanel|api\.amplitude|googletagmanager" \
  apps/minerva-app/src --include=*.ts --include=*.tsx

# Sin source maps en el bundle
find apps/minerva-app/out/_next/static -name '*.js.map' | wc -l   # → 0
```

---

## 10. Glosario y mapa de la documentación

### 10.1 Glosario

| Término | Significado |
| --- | --- |
| **CEF** | Chromium Embedded Framework. Runtime de webview que Minerva usa en Linux en lugar de WebKitGTK |
| **wry** | Runtime de webview por defecto de Tauri (WebKit en macOS/Linux, WebView2 en Windows) |
| **AppService** | Interfaz de abstracción de plataforma en `src/services/appService.ts` |
| **Replica** | Unidad de datos sincronizable (ajustes, diccionarios, tipografías, OPDS) que se cifra en el cliente antes de subir |
| **CFI** | EPUB Canonical Fragment Identifier. Identificador estable de una posición dentro de un EPUB |
| **Envelope** | Sobre autocontenido `{c, i, s, alg, h}` que transporta un texto cifrado con AES-GCM |
| **KOSync** | Protocolo de sincronización de progreso de lectura de KOReader, soportado por el Worker |
| **Tombstone / lápida** | Marca de borrado que impide que una escritura posterior revive una fila eliminada |
| **key-as-content** | Esquema de i18n donde la clave de traducción es la propia cadena en inglés |
| **worktree** | Checkout de Git adicional, siempre creado con `pnpm worktree:new` |
| **e-ink** | Modo de interfaz para pantallas de tinta electrónica: sin sombras, sin degradados, bordes de 1 px |

### 10.2 Documentación del repositorio

| Documento | Contenido |
| --- | --- |
| [`README.md`](../README.md) | Punto de entrada: qué es Minerva, despliegue en un comando, estructura |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Guía de contribución oficial |
| [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | Código de conducta |
| [`SECURITY.md`](../SECURITY.md) | Política de seguridad, modelo de amenazas y superficies de ataque |
| [`NOTICE`](../NOTICE) | Avisos de copyright del upstream y del fork |
| [`LICENSE`](../LICENSE) | AGPL v3 completa |
| [`apps/minerva-app/docs/architecture.md`](../apps/minerva-app/docs/architecture.md) | Arquitectura de sistema con diagramas Mermaid |
| [`apps/minerva-app/docs/code-layout.md`](../apps/minerva-app/docs/code-layout.md) | Desglose de directorios |
| [`apps/minerva-app/docs/testing.md`](../apps/minerva-app/docs/testing.md) | Las cinco capas de test |
| [`apps/minerva-app/docs/i18n.md`](../apps/minerva-app/docs/i18n.md) | El esquema *key-as-content* y el flujo de extracción |
| [`apps/minerva-app/docs/contributors.md`](../apps/minerva-app/docs/contributors.md) | Revisión de PRs de la comunidad |
| [`apps/minerva-app/docs/read-along-narration.md`](../apps/minerva-app/docs/read-along-narration.md) | Narración y Media Overlays |
| [`apps/minerva-app/docs/safe-area-insets.md`](../apps/minerva-app/docs/safe-area-insets.md) | Reglas de insets en pantallas con muesca |
| [`apps/minerva-app/docs/stats-archive.md`](../apps/minerva-app/docs/stats-archive.md) | Archivo de estadísticas de lectura |
| [`apps/minerva-app/docs/view-settings.md`](../apps/minerva-app/docs/view-settings.md) | Ajustes de vista del lector |
| [`apps/minerva-app/docs/book-config.md`](../apps/minerva-app/docs/book-config.md) | Configuración por libro |
| [`apps/minerva-app/DESIGN.md`](../apps/minerva-app/DESIGN.md) | Sistema de diseño: superficies, vocabulario de acciones, primitivas, e-ink |
| [`apps/minerva-app/LESSONS.md`](../apps/minerva-app/LESSONS.md) | Errores recientes y la regla que los habría atrapado |
| [`apps/minerva-app/AGENTS.md`](../apps/minerva-app/AGENTS.md) | Contexto de trabajo para asistentes de código |
| [`apps/minerva-app/workers/minerva-sync/README.md`](../apps/minerva-app/workers/minerva-sync/README.md) | Documentación del backend autoalojable |
| `docs/DEPLOYMENT.md` | Runbook de despliegue, verificación, mantenimiento y rollback |
| Diseño original del cuaderno vinculado | Especificación interna (no se publica): *Notebook Linked Writing Workspace* |

### 10.3 Enlaces externos

- Readest (upstream): <https://github.com/readest/readest>
- Tauri v2 y sus prerrequisitos: <https://v2.tauri.app/start/prerequisites/>
- Cloudflare Workers / D1 / R2: <https://developers.cloudflare.com/>
- KOReader y el protocolo KOSync: <https://koreader.rocks/>
- Tailwind CSS v4: <https://tailwindcss.com/>

---

<div align="center">

**Minerva** — un lector soberano, libre de telemetría y autoalojable.

*Derivado de Readest · Copyright © Bilingify LLC y los colaboradores de Readest · AGPL v3*

</div>
