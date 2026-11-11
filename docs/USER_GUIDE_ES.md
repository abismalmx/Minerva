# Guía y Manual de Usuario de Minerva

**Versión:** 1.0.5 · **Licencia:** AGPL-3.0 · **Idiomas de esta guía:** Español (esta) · [English](USER_GUIDE_EN.md)

> Esta guía describe el comportamiento real de la aplicación compilada a partir de
> este repositorio. Los nombres de menú, botones y opciones se citan tal y como
> aparecen en la interfaz (en inglés, que es el idioma en el que se escribió el
> código) con su traducción al español cuando la existe.

---

## Índice

1. [Qué es Minerva](#1-qué-es-minerva)
2. [Instalación y primer arranque](#2-instalación-y-primer-arranque)
3. [Gestión de la biblioteca](#3-gestión-de-la-biblioteca)
4. [Experiencia de lectura](#4-experiencia-de-lectura)
5. [El Cuaderno (Notebook) y las notas](#5-el-cuaderno-notebook-y-las-notas)
6. [Búsqueda contextual de imágenes](#6-búsqueda-contextual-de-imágenes)
7. [Continuar lectura y atajos de teclado](#7-continuar-lectura-y-atajos-de-teclado)
8. [Diferencias frente a Readest](#8-diferencias-frente-a-readest)
9. [Preguntas frecuentes (FAQ)](#9-preguntas-frecuentes-faq)
10. [Resolución de problemas por sistema operativo](#10-resolución-de-problemas-por-sistema-operativo)
11. [Referencia rápida](#11-referencia-rápida)

---

## 1. Qué es Minerva

### 1.1 En una frase

Minerva es un **lector de libros electrónicos multiplataforma** —escritorio, móvil
y web— que funciona **sin cuenta obligatoria, sin telemetría activada y sin
depender de un servicio en la nube propietario**.

### 1.2 De dónde viene

Minerva es un **fork** de [Readest](https://github.com/readest/readest), el
lector de ebooks de los autores de Readest. El proyecto original y las
modificaciones se distribuyen bajo la **GNU AGPL v3**, y los avisos de autoría
original se conservan en el fichero [`NOTICE`](../NOTICE), como exige la licencia.

El fork no es un cambio de nombre: cambia el **modelo de producto**.

| | Readest (upstream) | Minerva |
| --- | --- | --- |
| Cuenta | Requisito para usar el servicio alojado | **Opcional**. La app funciona sin cuenta |
| Backend | Servicio alojado del proyecto | **El tuyo**: Cloudflare Workers + D1 + R2 |
| Telemetría | Recogida por defecto | **Opt-in explícito**, con 90 % de instalaciones nuevas ya optadas por la salida |
| Identidad visual | Marca Readest | Identidad propia: Minerva, bronce y oro sobre neutros cálidos |
| Datos sensibles | — | Cifrados **en el cliente** con una *passphrase* que el servidor nunca ve |

### 1.3 Filosofía

Cuatro principios que explican casi todas las decisiones del proyecto.

**1 · Independencia.** Minerva no depende de una empresa. El backend son tres
recursos de Cloudflare que puedes crear con tu propia cuenta (un Worker, una
base D1 y un bucket R2) con un único comando:

```bash
./deploy-cloudflare.sh
```

El script crea lo que falta, genera el secreto, aplica las migraciones, publica
el Worker y deja la app configurada. También habla el protocolo **KOSync**, así
que **KOReader** puede usar el mismo servidor.

**2 · Privacidad por construcción, no por política.** Los campos sensibles que
se sincronizan se cifran **antes de salir del dispositivo**, con una clave
derivada de tu *passphrase de sincronización*. El servidor guarda la sal y el
texto cifrado, y **no puede recuperar tu passphrase**. Además, la app habla
con **tu** Worker: no hay tráfico hacia terceros.

**3 · Sin telemetría ni rastreo silencioso.** La instrumentación es **opt-in**:
el SDK de telemetría ni siquiera arranca sin una clave configurada, y cuando
arranca lo hace con la captura desactivada salvo que el usuario lo haya
aceptado expresamente. En la primera ejecución, el 90 % de las instalaciones
nuevas quedan automáticamente **opted out**; solo al 10 % restante se le
pregunta. La decisión se guarda y se respeta para siempre: un opt-out registrado
gana siempre a un `true` obsoleto en el fichero de ajustes.

**4 · Sin bloat.** El fork se centró en el **almacenamiento autoalojado** y
retiró el lastre del servicio alojado: se borró el fichero de credenciales
públicas del proyecto original (Supabase, Stripe, PostHog y Pagebound
embebidos en el código), se redujeron las variables de entorno de más de cien
a las nueve que necesita un despliegue propio, y se eliminaron los scripts de
cuentas del servicio alojado. El plugin de Calibre y el *koplugin* de KOReader
ya no llevan ninguna credencial del servicio original.

### 1.4 Qué es y qué no es

| | |
| --- | --- |
| **Sí es** | Lector de EPUB, PDF, MOBI/AZW3, FB2, CBZ, TXT, HTML y Markdown |
| | Biblioteca con estanterías, grupos, etiquetas, búsqueda de texto completo y sincronización propia |
| | Cuaderno de notas en Markdown enlazado a cada libro, con citas que vuelven a la página exacta |
| | Búsqueda contextual de imágenes (Wikipedia + Wikimedia Commons) desde la propia lectura |
| | Multidioma: 35 idiomas de interfaz, con español e inglés completos |
| **No es** | Un servicio de lectura en la nube con cuenta obligatoria |
| | Un cliente de un único backend: la capa de cuenta es **opcional y reemplazable** |
| | Un producto con suscripción: en un despliegue propio (`SELF_HOSTED=true`) todas las funciones quedan disponibles |

### 1.5 Formatos y plataformas

| Formatos admitidos | Plataformas |
| --- | --- |
| EPUB · PDF · MOBI · AZW · AZW3 · KF8 · FB2 · CBZ · TXT · MD · HTML · HTM · MHTML · MHT | macOS · Windows · Linux · Android · iOS · Web (PWA) |

Los ficheros `.docx` y `.rtf` se **convierten a EPUB** al importarlos. El
formato `.rbooks` es el empaquetado propio de Minerva para transferring
bibliotecas completas.

---

## 2. Instalación y primer arranque

### 2.1 Los artefactos de la versión 1.0.5

| Artefacto | Sistema | Tamaño |
| --- | --- | --- |
| `Minerva-1.0.5-x86_64.AppImage` | Linux x86_64 | 141 380 088 B |
| `Minerva-1.0.5.exe` | Windows x64 (portátil) | 95 532 324 B |
| `Minerva-1.0.5-windows-x86_64.zip` | Windows x64 (portátil, comprimido) | 50 225 191 B |
| `Minerva-1.0.5.apk` | Android (arm64-v8a) | 57 597 296 B |
| `Minerva-1.0.5-arm64-clean.apk` | Android (arm64-v8a) — el mismo APK bajo el nombre de entrega | 57 597 296 B |

SHA-256:

```text
632ac17d3be9c83ac2831db9d7ae30399781d46e27df2be1c323bc067bb0a97a  Minerva-1.0.5-x86_64.AppImage
9e7534e6d277af78e728aaea374f7ace408410c99f1c5c114d133923881b6c2b  Minerva-1.0.5.exe
8674c297b80afbe16198dbc4485c589c251dbc16bb0a15e64b6136c0bb5e3156  Minerva-1.0.5-windows-x86_64.zip
396bd5bb903bccfcdfda1bd9c8e93052e462495fd80e1f788345478a5b4a9e99  Minerva-1.0.5.apk
396bd5bb903bccfcdfda1bd9c8e93052e462495fd80e1f788345478a5b4a9e99  Minerva-1.0.5-arm64-clean.apk
```

El APK está firmado con la **clave de depuración de Android** (esquemas de
firma v2 y v3), así que se instala directamente con «permitir fuentes
desconocidas». No está firmado con una clave de publicación, de modo que
Android lo identifica como una app de depuración. Es la **misma** clave con
la que se firmó la 1.0.5 anterior, así que puedes instalarlo por encima sin
desinstalar antes. En Windows, el `.exe` funciona pero SmartScreen lo
mostrará como *unknown publisher*.

> **Binarios neutros y soberanos.** Los cuatro artefactos se compilaron **sin
> ninguna URL de terceros ni ninguna URL personal incrustada**: no hay
> `NEXT_PUBLIC_API_BASE_URL` quemado en el bundle, ni cuenta de terceros
> configurada, ni endpoint de analítica. El único origen que aparece es el
> placeholder `https://tu-worker.workers.dev` del formulario de
> autenticación. Por eso el binario funciona **100 % offline** (leer, anotar,
> biblioteca, exportar) y no habla con ningún servicio que no hayas elegido
> tú.
>
> El frontend viaja **comprimido con brotli** dentro del binario, así que un
> `strings` sobre el `.exe` no ve ni la URL que lleva ni ninguna otra. La
> comprobación sobre el artefacto se hace descomprimiéndolo, que es lo que
> hace la herramienta de verificación del proyecto (ver
> [6.5.2.1 Verificación de neutralidad del artefacto final](DEVELOPER_GUIDE_ES.md#6521-verificación-de-neutralidad-del-artefacto-final)).
>
> **Sobre Linux:** el AppImage de 1.0.5 usa el runtime **WRY** (WebKitGTK) e
> incluye el motor dentro del propio paquete, de ahí su tamaño.
>
> **Los binarios de la tanda anterior se retiraron:** se compilaron **antes**
> del commit de erradicación de la telemetría (`06f838a`) y todavía llevaban
> dentro el SDK de Sentry. Esta tanda se compila desde el commit limpio y se
> verifica antes de publicarse (ver
> [6.5.5 Verificación binaria del artefacto](DEVELOPER_GUIDE_ES.md#655-nivel-5--verificación-binaria-del-artefacto)).
>
> Los paquetes de escritorio (AppImage, instalador y portable de Windows, DMG
> universal de macOS) se reconstruyen en CI desde el commit limpio con
> [build-all-platforms.yml](https://github.com/minerva/minerva/actions/workflows/build-all-platforms.yml).

### 2.2 Linux (AppImage)

El AppImage es un fichero único, autocontenido: no necesita instalación.

```bash
# 1. Dale permiso de ejecución
chmod +x Minerva-1.0.5-x86_64.AppImage

# 2. Ábrelo
./Minerva-1.0.5-x86_64.AppImage
```

Para integrarlo en el menú de aplicaciones, muévelo a `~/Applications/` o a
`/opt/` y añade su `.desktop`:

```bash
sudo install -Dm755 Minerva-1.0.5-x86_64.AppImage /opt/minerva/minerva.appimage
install -Dm644 squashfs-root/minerva.desktop \
  ~/.local/share/applications/minerva.desktop
update-desktop-database ~/.local/share/applications 2>/dev/null
```

El `.desktop` incluido declara las asociaciones MIME de EPUB, MOBI, AZW,
AZW3, FB2, CBZ, PDF, texto plano y Markdown, más los esquemas
`x-scheme-handler/minerva` y `x-scheme-handler/readest`.

> **Nota sobre las AppImage:** el paquete incluye un *hook*
> (`00-no-userns-prompt.hook`) que evita el aviso del sistema sobre los
> *user namespaces* no confinados al ejecutar el binario envuelto.

#### Primer arranque

1. Se abre la **biblioteca**. Si está vacía, aparece el estado inicial
   *Start your library* con dos opciones: pick a book from your device, o
   arrastrar un libro a la ventana.
2. **Ajustes → Comportamiento → Privacy** (en inglés, *Settings → Behavior →
   Privacy*) contiene el interruptor **Help improve Minerva**. Está en
   posición de apagado por defecto en las instalaciones nuevas.
3. Si quieres sincronización, ve a **Ajustes → Integraciones → Minerva Cloud
   (Cloudflare)** y sigue la sección [9.2](#92-sincronización-con-tu-propio-servidor).

### 2.3 Windows

Hay dos formas de instalarlo.

#### Opción A — el ejecutable directo

```powershell
# Ejecuta esto UNA vez: cambia el ejecutable a una copia local
# y añade una carpeta de instalación para los datos de la app.
```

Simplemente **haz doble clic** en `Minerva-1.0.5.exe`. Se abre y funciona sin
instalación previa.

> **Requisitos:** Windows 10 1809 o superior. Minerva usa **WebView2**, el
> motor web del sistema. En Windows 11 viene preinstalado; en Windows 10 se
> instala solo la primera vez (pide reiniciar el equipo al terminar).

#### Opción B — el ZIP portátil

`Minerva-1.0.5-windows-x86_64.zip` contiene tres ficheros:

```
minerva.exe             125 151 037 B   el ejecutable
WebView2Loader.dll        160 880 B   cargador del motor WebView2
minerva_thumbnail.dll   9 343 351 B   extensión de miniaturas para Explorador
```

Descomprime el ZIP en una carpeta (por ejemplo `C:\Apps\Minerva`) y lanza
`minerva.exe`. **No muevas `minerva.exe` fuera de esa carpeta**: los dos DLL
deben estar a su lado.

#### Sobre `minerva_thumbnail.dll`

Este DLL es una extensión de shell para el Explorador de Windows que genera
miniaturas y vistas previas de libros (EPUB, MOBI, AZW, AZW3, FB2, CBZ) y
renderiza páginas PDF con el motor `Windows.Data.Pdf` nativo. **No es
obligatorio**: si lo quitas, la app funciona igual, solo pierdes las
miniaturas. Si lo dejas en la carpeta pero no lo registras en el sistema, el
Explorador simplemente lo ignorará.

El registro en el registro de Windows lo hace el **instalador NSIS**, que
necesita un equipo con Windows para generarse. Ver
[`BUILD_WINDOWS_MACOS.md`](BUILD_WINDOWS_MACOS.md) para el procedimiento.

#### Integración con el Explorador

Sin el instalador NSIS, puedes asociar los formatos manualmente: clic derecho
sobre un `.epub` → *Abrir con* → *Elegir otra aplicación* → *Minerva* →
comprobar *Siempre*.

### 2.4 Android

El APK está compilado para **arm64-v8a** (Android 8.0 / API 26 y superior).
El APK de esta tanda va **sin firmar**; usa `Minerva-1.0.5-debug-signed.apk`,
que sí está firmado con el esquema v2/v3 y es instalable.

#### Instalación por cable (ADB)

```bash
adb install -r Minerva-1.0.5-debug-signed.apk
```

#### Instalación copiando el fichero

1. Copia `Minerva-1.0.5-debug-signed.apk` al teléfono.
2. Ábrelo desde el explorador de ficheros.
3. Android pedirá permitir la instalación desde fuentes desconocidas: acepta
   para el explorador que estés usando.

> **Aviso:** al ser una clave de depuración, el sistema puede mostrar
> advertencias. Es lo esperado en un APK no publicado en Google Play.

#### Permiso de almacenamiento

Minerva declara `MANAGE_EXTERNAL_STORAGE` ("Todos los archivos"), que le da
acceso a tus libros para poder leerlos directamente del disco. Si prefieres no
concederlo, puedes copiar los libros a la carpeta propia de la app y usar la
importación desde el selector de ficheros.

#### Android y sincronización

La app declara un `MediaPlaybackService` para el servicio de lectura en voz
alta del sistema. Las notificaciones de reproducción aparecen en la sombra de
notificaciones.

### 2.5 macOS

> **No hay un `.dmg` de la versión 1.0.5.** Compilar para macOS desde Linux
> es imposible por cuatro motivos independientes, cada uno fatal por sí solo:
>
> 1. **No hay SDK de Apple.** La app enlaza con frameworks de Apple (`objc2`,
>    `objc2-foundation`, `objc2-authentication-services`, `cocoa`, `dispatch2`)
>    y hay 74 puntos del código bajo `cfg(target_os = "macos")`. `zig cc` no
>    incluye ningún SDK de macOS, y `osxcross` necesita que tú aportes el SDK
>    descargado de Xcode en un Mac.
> 2. **La firma es exclusiva de macOS.** `codesign` necesita el certificado
>    *Developer ID Application*.
> 3. **El notarizado es exclusivo de macOS.** `xcrun notarytool` y `altool`
>    no existen en Linux.
> 4. **Los empaquetadores se compilan por host.** El CLI de Tauri solo ofrece
>    los tipos de paquete `dmg` y `app` cuando se compila en macOS.
>
> **Cómo obtenerlo:** en un Mac con Xcode instalado,
>
> ```bash
> pnpm tauri build -t universal-apple-darwin --bundles dmg \
>   --config src-tauri/tauri.macos-nonestore.conf.json
> ```
>
> Requiere los targets Rust `aarch64-apple-darwin` y `x86_64-apple-darwin`.
> El resultado es un `.app` universal (Apple Silicon + Intel) y su `.dmg`.

#### Aviso sobre la App Store de macOS

El `package.json` del proyecto referencia tres ficheros de configuración que
**no existen** en el repositorio:

- `src-tauri/tauri.appstore.conf.json`
- `src-tauri/tauri.appstore-dev.conf.json`
- `src-tauri/tauri.macos-appstore.conf.json`

Los scripts `build-macos-universial-appstore`,
`build-macos-universial-appstore-dev` y `release-mac-appstore.sh` fallarán
antes de empezar, en cualquier sistema. Si necesitas esa vía, hay que crear
esos ficheros primero.

### 2.6 Primer arranque, en cualquier sistema

La app **no pide cuenta**. Al abrirla:

1. Se muestra la **biblioteca** con el póster de *Continuar lectura* (si hay
   un libro a medias) o el estado inicial *Start your library*.
2. Ajustes → **Idioma** para cambiar el idioma de la interfaz. Por defecto
   sigue al del sistema.
3. Ajustes → **AI Assistant** si quieres usar el chat sobre el libro. Aparece
   **desactivado** hasta que actives el interruptor *Enable AI Assistant*.
4. Ajustes → **Integraciones** si quieres conectar tu propio servidor.

**Los binarios que descarga esta guía son neutros.** No llevan incrustada
ninguna URL de terceros ni ninguna URL personal: el ejecutable no sabe de
antemano a qué servidor habla. Por eso la app funciona **completamente
offline** (leer, anotar, biblioteca, exportar) sin tocar la red, y cuando
quieres sincronizar es tú quien indica **tu** Worker.

Si el build tiene el modo autoalojado activado —y los binarios públicos lo
tienen— la **pantalla de autenticación** muestra un campo editable
**Servidor Cloudflare** (placeholder `https://tu-worker.workers.dev`). Pegas
ahí la URL de tu Worker y la app la guarda: no hace falta desplegar nada
más, ni reconfigurar ficheros, ni recompilar.

---

## 3. Gestión de la biblioteca

### 3.1 Importar libros

El botón **Import Books** de la cabecera de la biblioteca abre el menú con
**todas** las vías de entrada:

| Opción del menú | Qué hace |
| --- | --- |
| **From Local File** | Selector de ficheros. Acepta varios a la vez |
| **From Directory** | Importa una carpeta recursivamente. Solo en escritorio (el móvil no puede leer carpetas arbitrarias) |
| **From Pasted Text** | Pega un artículo o tus notas y se convierten en un libro |
| **From Web Browser** | Captura una página web abierta en el navegador del sistema. Solo escritorio |
| **From Web Novel** | Descarga los capítulos de una novela web. Solo escritorio |
| **From Feed URL** | Suscríbete a un feed RSS, Atom o JSON Feed |
| **Online Library / OPDS Catalogs** | Catálogos OPDS |

Además, y sin pasar por ese menú:

| Vía | Detalle |
| --- | --- |
| **Arrastrar y soltar** | Suelta ficheros o carpetas sobre la ventana de la biblioteca |
| **Nearby BookDrop (LocalSend)** | Transferencia entre equipos de la misma red, sin nube de por medio |
| **Extensión del navegador** | *Send to Minerva* (Chromium) recorta la página en un EPUB autónomo y lo envía a tu bandeja |
| **Correo electrónico** | Envía a la dirección *Send to Minerva* que tengas configurada |
| **Abrir con / menú compartir** | El sistema operativo entrega el fichero a Minerva. La opción *Auto-import books on open* está activa por defecto en móvil |
| **Enlace de libro compartido** | Un enlace `…/s/…` añade el libro a tu biblioteca |
| **Fichero `.rbooks`** | Paquete de biblioteca exportable e importable |

#### Importar una carpeta

El diálogo **Import Books** permite:

| Opción | Qué hace |
| --- | --- |
| **Folder** | Carpeta de origen |
| **File Formats** | Extensiones a buscar: EPUB, PDF, MOBI/AZW/AZW3, FB2, CBZ/ZIP, TXT/MD, HTML |
| **File size larger than** | Descarta ficheros por debajo de un mínimo en KB (por defecto 20 KB), para no llenar la biblioteca de ruido |
| **Read books in place** | No copia el fichero: lee el original donde está. La biblioteca lo referencia |
| **Auto-import new books from this folder** | Vigilancia de la carpeta: lo que se añada después entra solo |
| **Create groups from subfolders** | Cada subcarpeta de primer nivel se convierte en un grupo de la biblioteca |

#### Atajo por URL

La biblioteca también acepta un parámetro `?url=`, útil para scripts y para
enlaces directos a una carpeta remota.

### 3.2 Organizar

#### Estanterías (*Bookshelves*)

Las estanterías son secciones de la biblioteca con su propia configuración.
Hay cinco integradas:

| ID | Nombre por defecto |
| --- | --- |
| `recent` | Recently read |
| `audiobooks` | Audiobooks |
| `podcasts` | Podcasts |
| `default` | Default |
| `finished` | Finished books |

Puedes crear las tuyas en **View menu → Bookshelves → Manage Bookshelves**.
Cada estantería se configura por separado:

| Ajuste | Valores |
| --- | --- |
| **Layout** | Carousel / Grid / List |
| **Hide covers** | Oculta las portadas en modo lista |
| **Book covers** | Crop / Fit |
| **Skeuomorphic covers** | Portadas con relieve |
| **Grouping** | Agrupar por un criterio propio, o usar el global |
| **Sorting** | Orden propio, o usar el global |
| **Exclusive** | La estantería solo admite libros propios, no los de otras |
| **Limit** | Máximo de libros mostrados |

#### Grupos y etiquetas

- **Grupos**: *Group Books* agrupa libros por un criterio libre (una saga, un
  autor, un proyecto). Se crean, renombran y eliminan desde el menú contextual
  de un libro o en modo selección múltiple.
- **Etiquetas (*Tags*)**: el diálogo **Tag Books** asigna etiquetas a uno o
  varios libros. Se pueden crear etiquetas nuevas sobre la marcha.

#### Estado de lectura

Cada libro tiene un estado, editable desde el menú contextual:

| Estado | Etiqueta |
| --- | --- |
| Sin leer | *Unread* |
| Leyendo | *Reading* |
| Terminado | *Finished* |
| En pausa | *On hold* |

Abrir un libro lo pasa automáticamente a *Reading*; llegar al 100 % lo marca
como *Finished*.

### 3.3 Visualizar, filtrar y buscar

#### Modo de visualización

El menú **View** de la biblioteca ofrece:

| Control | Opciones |
| --- | --- |
| Modo de vista | **List** / **Grid** |
| **Columns** | Automático, o de 1 a 12 según el ancho de la ventana |
| **Group by…** | Authors · Books · Groups · Series · Tags · Subjects · Status |
| **Sort by…** | Title · Author · Format · Pages · Series · Updated · Created · Published · Progress · Time Remaining |
| **Then by…** | Un segundo criterio, con *Ascending* / *Descending* |

Los valores implícitos se muestran marcados como *(Auto)*. Por ejemplo, si
agrupas por *Authors*, el orden secundario pasa a *Series* de forma
automática.

#### Búsqueda de metadatos

El campo **Search Books...** filtra por título, autores, formato, grupo,
descripción, etiquetas, materias y columnas personalizadas de Calibre. Acepta
expresiones regulares si las escribes así.

#### Búsqueda de texto completo

El mismo campo puede alternar a **Full Text Search** (búsqueda de texto
completo), que recorre el **contenido** de todos los libros, no solo sus
metadatos.

| Modo | Qué hace |
| --- | --- |
| **Contains** | Subcadena |
| **Whole Words** | Palabras completas |
| **Regular Expression** | Expresión regular |
| **Nearby Words** | Palabras cercanas entre sí, con una ventana de 5, 10, 20 o 50 palabras |
| **Fuzzy** | Tolerante a erratas |

Opciones adicionales: **Match Case** y **Match Diacritics** (esta última se
desactiva en modo regex).

El índice se guarda en `search.db` y se reconstruye solo cuando hace falta.
La búsqueda por palabras cercanas y la difusa se ejecutan en un *Web Worker*,
de modo que la interfaz no se bloquea. Límite: 500 resultados por libro.

> Si ves *Enter at least two words*, el modo difuso exige al menos dos
> palabras. Si ves *Invalid regular expression*, corrige el patrón.

### 3.4 Metadatos

Desde el menú contextual de un libro: **Show Book Details**. El botón
**Edit Metadata** abre el editor.

| Campo | Campo |
| --- | --- |
| Cover image | Title |
| Subtitle | Author |
| Series | Series Index |
| Total in Series | ISBN |
| Publisher | Publication Date |
| Language | Identifier |
| Subjects | Tags |
| Description | |

Además:

- **Auto-Retrieve Metadata** busca la ficha en **Open Library** y en **Google
  Books** y rellena los campos vacíos.
- **Lock cover** / **Unlock cover**, y **Lock All** / **Unlock All**, fijan
  los campos para que una sincronización posterior no los sobrescriba.

Las **columnas personalizadas de Calibre** que contenga el OPF del libro se
muestran en modo solo lectura y pueden usarse como filtro de estantería.

---

## 4. Experiencia de lectura

### 4.1 Modos de vista

El menú **View** del lector cambia según el formato del libro.

#### Libros reflowable (EPUB, MOBI, FB2, TXT, HTML, Markdown)

| Modo | Atajo | Qué hace |
| --- | --- | --- |
| **Paginado** (por defecto) | — | Páginas fijas, con arrastre y volteo |
| **Scrolled Mode** | `Shift + J` | Desplazamiento continuo vertical u horizontal |
| **Paragraph Mode** | `Shift + P` | Muestra un párrafo a la vez, centrado y con foco |
| **Speed Reading Mode** (RSVP) | `Shift + V` | Presentación de una palabra por vez, con control de velocidad |
| **Auto Scroll** | `Shift + A` | Avance automático con velocidad ajustable |

El diálogo de inicio de RSVP permite elegir: *From Chapter Start*,
*Resume* o *From Current Page*.

#### Libros de maquetación fija (PDF, CBZ)

| Control | Opciones |
| --- | --- |
| **Zoom Mode** | Single Page · Auto Spread · Vertical Scrolling · Horizontal Scrolling · Fit Page · Fit Width |
| **Zoom Level** | Ajuste con *Zoom In* / *Zoom Out* / *Reset Zoom* |
| **Contrast** | *Decrease Contrast* / *Reset Contrast* / *Increase Contrast* |
| **Webtoon Mode** | Vista de historieta vertical |
| **Separate Cover Page** | La portada ocupa su propia página |
| **Right-to-Left Pages** | Orden de lectura inverso |
| **Lock Horizontal Panning** | Bloquea el arrastre horizontal |

También aplica a PDF: **Apply Theme Colors** y **Invert Image In Dark Mode**.

### 4.2 Fuentes y tipografía

**Ajustes → Font.**

| Control | Detalle |
| --- | --- |
| **Override Book Font** | Ignora la tipografía que declare el libro |
| **Default Font Size** / **Minimum Font Size** | Tamaño por defecto y mínimo permitido (de 8 a 120) |
| **Font Weight** | De 100 a 900, en pasos de 100 |
| **Font Category** | Serif / Sans-Serif |
| **Serif Font** / **Sans-Serif Font** / **Monospace Font** | Fuentes concretas de cada categoría |
| **CJK Font** | Solo visible en entorno CJK |
| **Custom Fonts → Manage Fonts** | Tus propias fuentes |

Las fuentes incluidas son **Bitter, Literata, Merriweather, Roboto Slab,
Vollkorn, PT Serif, Georgia, Times New Roman** (serif), **Roboto, Noto Sans,
Open Sans, PT Sans, Helvetica** (sans), **Fira Code, Consolas, Courier New,
Lucida Console, PT Mono** (monoespaciada) y la familia **LXGW WenKai /
Source Han / Noto Sans CJK** para chino y japonés. Además se enumeran
automáticamente las fuentes instaladas en tu sistema.

**Importar una fuente propia:** *Manage Fonts → Import Font*. Formatos
aceptados: `.ttf`, `.otf`, `.woff`, `.woff2`. Quedan guardadas en
`Minerva/Fonts` y se pueden elegir en las listas del panel *Font*.

### 4.3 Tema, colores y texturas

**Ajustes → Theme.** Hay dos ámbitos, y se cambian por separado desde el
selector segmentado **Library / Reader**:

|Ajuste | Valores |
| --- | --- |
| **Theme Mode** | Auto · Light · Dark · Ambient |
| **Theme Color** | Minerva (por defecto) · Gray · **Sepia** · Grass · Cherry · Sky · Solarized · Gruvbox · Nord · Contrast · Sunset · *Custom* |
| **Background Texture** | None · Concrete · Paper · Sand · Parchment · Scrapbook · Leaves · Moon Sky · Night Sky |
| **Invert Image In Dark Mode** | Paranight |
| **Override Book Color** | Fuerza el color del libro sobre el del tema |
| **Highlight Colors** | Los colores de tus resaltados |
| **Reading Ruler** | Una guía visual sobre la línea de lectura |
| **Dialogue Highlight** | Realce de los diálogos |
| **Code Highlighting** | Coloreado de código en libros técnicos |

> **Sobre el modo *Ambient*:** sigue el sensor de luz ambiental del dispositivo
> y conmuta entre claro y oscuro según la iluminación real. Es una función
> pensada sobre todo para Android y e-ink; solo aparece si el dispositivo
> tiene el sensor.
>
> **Sobre el *sepia*:** es un **color de tema**, no un modo aparte. Los modos
> son Auto, Light, Dark y Ambient; el sepia se elige en *Theme Color*.

El conmutador rápido del lector (en el menú **View**) recorre los modos en
ciclo: Dark → Light → Ambient → Auto.

#### Modo e-ink

**Ajustes → Comportamiento → Device → E-Ink Mode.** Convierte la interfaz para pantallas
electrónicas: sin sombras, sin degradados, con bordes de 1 px nítidos y los
acentos de bronce convertidos en tinta. La AppImage de Linux incluye un hook
que evita el aviso de *user namespaces* al ejecutarse.

### 4.4 Disposición de la página

**Ajustes → Layout.**

| Grupo | Ajustes |
| --- | --- |
| **General** | Override Book Layout · Writing Mode (Default / Horizontal / Vertical / RTL) · Border Frame |
| **Paragraph** | Use Book Layout · Paragraph Margin · Line Spacing · Word Spacing · Letter Spacing · Text Indent · Full Justification · Hyphenation |
| **Page** | Top / Bottom / Left / Right Margin · Additional Margin · Column Gap · Maximum Number of Columns · Maximum Column Height / Width |
| **Header & Footer** | Show Header / Footer · Remaining Time · Remaining Pages · Reading Progress · Progress Bar · Current Time · Use 24 Hour Clock · Battery Status · Battery Percentage · Font Size · Text / Background Color · Opacity |
| **Screen** | Orientation (Auto / Portrait / Landscape) |

Dentro del lector hay un acceso rápido: la barra inferior ofrece **Font Size**,
**Page Margin** (Small / Large), **Line Spacing** (Small / Large) y **More
Settings**.

### 4.5 Navegación, marcadores y búsqueda

#### Tabla de contenidos

La pestaña **TOC** de la barra lateral muestra el índice del libro. En un PDF
sin índice, Minerva lista todas las páginas como miniaturas.

#### Marcadores

| Acción | Cómo |
| --- | --- |
| Añadir o quitar marcador | `Ctrl + B` / `Cmd + B`, o el botón *Bookmark* |
| Marcador con arrastre | Tira del borde superior de la página para añadirlo o quitarlo |
| Ver marcadores | Pestaña **Bookmark** de la barra lateral |

#### Saltos

| Acción | Atajo |
| --- | --- |
| Ir a página | Botón *Go to Page* de la barra inferior |
| Capítulo anterior / siguiente | `Alt + ←` / `Alt + →` (o `Opt` en macOS) |
| Atrás / adelante | `Shift + H` / `Shift + L` |
| Inicio / fin del libro | `Home` / `End` |

#### Buscar dentro del libro

`Ctrl + F` / `Cmd + F` abre la búsqueda en la barra lateral, con las mismas
modalidades que la búsqueda de la biblioteca: *Contains*, *Whole Words*,
*Regular Expression*, *Nearby Words*, con *Match Case* y *Match Diacritics*.
El ámbito puede ser el **libro** entero o el **capítulo** actual.

### 4.6 Resaltados y anotaciones

Al seleccionar texto aparece la barra de herramientas flotante:

| Botón | Atajo | Qué hace |
| --- | --- | --- |
| **Copy** | `Ctrl + C` | Copia el texto |
| **Copy Link** | — | Copia un enlace a la posición exacta |
| **Highlight** | `Ctrl + H` | Resalta con el estilo y color actuales |
| **Underline** | `Ctrl + U` | Subraya |
| **Annotate** | `Ctrl + N` | Abre el editor de nota sobre la selección |
| **Photo** | — | Abre la búsqueda de imágenes (ver [sección 6](#6-búsqueda-contextual-de-imágenes)) |
| **Search** | `Ctrl + F` | Busca la selección en el libro |
| **Dictionary** | `Ctrl + D` | Consulta el diccionario |
| **Translate** | `Ctrl + T` | Traduce la selección |
| **Ask Gemini** | — | Explica la selección con la IA |
| **Speak** | `Ctrl + R` | Lee la selección en voz alta |
| **Proofread** | `Ctrl + P` | Corrige la selección |
| **Share** | — | Comparte la selección |
| **Quote Card** | — | Genera una imagen con la cita |

Los estilos de resalte son *highlight*, *underline* y *squiggly*; los colores,
rojo, amarillo, verde, azul y violeta. La opción *Apply to every occurrence
in the book* extiende el resalte a todas las apariciones del texto en la
sección.

Las anotaciones se listan en la pestaña **Annotate** de la barra lateral,
agrupadas por capítulo, con filtros por tipo, color y estilo, y con un
buscador propio. Cada fila ofrece copiar, editar y eliminar.

### 4.7 Otras funciones del lector

| Función | Acceso | Detalle |
| --- | --- | --- |
| **Lectura en voz alta (TTS)** | `T` | Reproductor con letra sincronizada, capítulos, control de velocidad y caché de audio. Admite Media Overlays de EPUB 3 y emparejamiento con audiolibros del dispositivo |
| **Traducción** | `Ctrl + T` | Traductores configurables (DeepL, Yandex, personalizados) con opción de mostrar el original |
| **Diccionario** | `Ctrl + D` | Wiktionary, Wikipedia, diccionario del sistema y diccionales importados (MDict, DICT, Slob, Babylon, Yomitan, StarDict). El plugin **Yomitan** viene incluido |
| **Word Lens** | Ajustes → Language | Glosa en tu lengua sobre las palabras difíciles |
| **Notas al pie** | Clic en la llamada | *Back* y *Jump to Location* |
| **Estadísticas de lectura** | Menú View | Tiempo, actividad, racha actual, racha más larga, total de libros y páginas |
| **Autenticación en Apple** | — | *Sign in with Apple* para servicios que lo requieren |
| **Modo de lectura a dos libros** | — | Rejilla de libros abiertos simultáneos |

---

## 5. El Cuaderno (Notebook) y las notas

El Cuaderno es la **implementación propia de Minerva**: un panel lateral con un
editor de Markdown enlazado al libro que estás leyendo.

### 5.1 Abrir el Cuaderno

| Vía | Detalle |
| --- | --- |
| Atajo `N` | Alterna la visibilidad del panel |
| Botón **Notebook** | En la barra superior del lector (icono de pluma) |
| Botón **All notes** | En el pie del propio Cuaderno: salta a la lista completa de anotaciones |

Si el Cuaderno está **anclado** (`Pin Notebook`, en la cabecera del panel),
ocupa espacio en el diseño y **no se oculta** al navegar. Si no lo está, se
comporta como una capa flotante con fondo oscurecido y se cierra con
`Escape` o con el botón atrás de Android.

Puedes **redimensionarlo** arrastrando el asa de su borde izquierdo (o con las
flechas del teclado, porque el asa es un `slider`). El ancho se guarda entre
sesiones. En móvil ocupa el ancho completo y se ajusta en vertical.

### 5.2 Estructura del Cuaderno

El Cuaderno se organiza por capítulos del libro:

| Selector | Significado |
| --- | --- |
| **All chapters** | Todo el documento en un solo flujo |
| **General notes** | Tus notas sueltas, sin capítulo asignado |
| *(cada entrada de la tabla de contenidos)* | Las notas de ese capítulo, con un contador de extractos y una marca si hay notas escritas |

El botón de brújula (*Jump to current reading chapter*) salta al capítulo que
estás leyendo ahora mismo.

> Cada capítulo se guarda separado del resto, pero el documento completo es un
> único fichero Markdown. El Cuaderno se guarda **junto al libro**, en su
> `config.json`, no en la base de datos. Eso significa que viaja con el libro
> en las copias de seguridad y en la sincronización de ficheros.

### 5.3 Escribir en Markdown

El editor es de Markdown enriquecido. La barra de herramientas ofrece:

| Control | Markdown generado |
| --- | --- |
| **Text style** → Text / Heading 1 / Heading 2 / Heading 3 | Párrafo, `#`, `##`, `###` |
| **Bold** | `**texto**` |
| **Italic** | `*texto*` |
| **Strikethrough** | `~~texto~~` |
| **Highlight** → Yellow / Mint / Blue / Coral / No highlight | `==texto==` o `<mark data-color="mint">texto</mark>` |
| **Bulleted list** | `- elemento` |
| **Numbered list** | `1. elemento` |
| **Quote** | `> cita` |
| **Quote from the book** | Inserta una cita con enlace al punto exacto (ver abajo) |

> El subrayado está deliberadamente **desactivado**: no tiene una forma
> inequívoca en Markdown portable. El HTML en crudo también está desactivado,
> por seguridad. El viaje de ida y vuelta a Markdown está garantizado por las
> pruebas del proyecto.

`Ctrl + Enter` / `Cmd + Enter` guarda. La línea de estado indica
**Saving…**, **Saved**, **Couldn't save** o **Waiting for a valid book
position**.

### 5.4 Notas sobre el texto del libro

Hay cuatro formas de crear una nota:

**A · Anotar una selección.** Selecciona texto → **Annotate** (`Ctrl + N`).
Se abre un editor sobre la propia selección. Escribe y guarda. La nota queda
**anclada al punto exacto** del libro.

**B · Copiar al Cuaderno.** Activa **Ajustes → Comportamiento → Annotation
Tools → Copy to Notebook**. A partir de entonces, la acción **Copy** de la
barra de selección además guarda el texto como *extracto* en el Cuaderno, y
avisa con *Copied to Notebook*. Este es el único camino que crea extractos.

**C · Escribir libremente.** Teclea directamente en el Cuaderno. Es el único
contenido que no necesita un ancla en el libro.

**D · Editar desde la barra lateral.** En la pestaña **Annotate**, el lápiz de
cada fila abre un editor en línea.

### 5.5 Citas que vuelven al libro

Si tienes extractos guardados, la opción **Quote from the book** de la barra
de herramientas lista cada uno con su capítulo y su página. Al insertarlo se
genera:

```markdown
> Texto citado, con los espacios normalizados.

> [Capítulo 3 · Página 42](minerva-cfi:epubcfi(/6/4))
```

Ese enlace es un **CFI de EPUB**: apunta a la posición exacta. Si haces clic
en él, el lector salta a esa página.

> **El botón aparece deshabilitado si no tienes extractos.** Activa
> *Copy to Notebook* y copia algo del libro para empezar.

### 5.6 Exportar

Aquí conviene ser preciso, porque hay una distinción importante.

| Qué se exporta | Dónde | Formato |
| --- | --- | --- |
| **Resaltados y notas de anotación** | Menú del libro → **Export Annotations** | Markdown, Plain Text o JSON (Minerva) |
| **El documento del Cuaderno** | — | **No hay exportación directa a fichero** |

El diálogo **Export Annotations** es muy configurable:

| Grupo | Opciones |
| --- | --- |
| **Format** | Markdown · Plain Text · JSON (Minerva) |
| **Format Options** | Title · Author · Export Date · Cover Image · Chapter Titles · Chapter Separator · Highlights · Context · Notes · Page Number · Note Date |
| **Annotation Link** | App Link o Web Link |
| **Filter Annotations** | Por colores y por estilos |
| **Advanced** | Plantilla personalizada con un lenguaje de plantillas completo: `{{ variable }}`, `{{ variable \| date('%Y-%m-%d') }}`, `{% if %}`, `{% for %}`, y formateadores *date*, *blockquote*, *nl2br*, *upper*, *lower*, *capitalize*, *title*, *trim*, *truncate(n)*, *replace('a','b')*, *default(val)*, *length*, *first*, *last*, *join(', ')* |

El botón **Save** guarda `<título>.md`, `<título>.txt` o
`<título>-annotations.json`. En macOS aparece además **Share**.

> **El Cuaderno queda fuera de esta exportación por diseño.** El filtro es
> explícito: solo se exportan las anotaciones, los marcadores y los
> extractos. Si necesitas el Cuaderno como Markdown, la vía es la copia
> manual de su contenido, o la copia de seguridad completa de la app, que sí
> incluye el `config.json` del libro con el Cuaderno dentro.

### 5.7 Importar anotaciones desde otras apps

Menú del libro → **Import Annotations**:

| Origen | Fichero |
| --- | --- |
| **Minerva** | `.json` exportado por Minerva |
| **Moon+ Reader** | `.mrexpt` |
| **ReadEra** | `.bak` |

### 5.8 El Chat de IA dentro del Cuaderno

Si activas **Ajustes → AI Assistant**, el Cuaderno gana una segunda pestaña,
**AI**, con un chat que responde preguntas **sobre el libro que estás
leyendo**.

**Antes de poder usarlo hay que indexar el libro.** La pestaña muestra
*Index This Book* → *Start Indexing*, y va indicando el progreso
(*`current / total chunks`*). El chat incluye título, autor y la página
actual como contexto, y las respuestas muestran sus **fuentes**: al hacer clic
en una fuente con CFI, el lector salta al pasaje citado.

| Proveedor | Clave API | Notas |
| --- | --- | --- |
| **Ollama (Local)** | No | Todo local. La opción recomendada si quieres privacidad |
| **AI Gateway (Cloud)** | Sí | Nube |
| **OpenAI Compatible** | Sí | Cualquier endpoint compatible |
| **Gemini** | Sí | Como asistente de lectura *in situ*, independiente del chat |
| **Reedy (Beta)** | — | Solo escritorio, en beta |

Si eliges *None (disable RAG)* como modelo de embeddings, el chat funciona sin
indexación por recuperación.

> **La indexación envía el texto del libro al proveedor que elijas.** Con
> Ollama, el texto no sale de tu equipo. Con un proveedor en la nube, sí.
> Decide con criterio.

---

## 6. Búsqueda contextual de imágenes

Esta es la segunda implementación propia de Minerva: **buscar imágenes de
personajes, lugares o conceptos sin salir de la lectura**.

### 6.1 Cómo se usa

1. **Selecciona el texto** que te interesa: un nombre de persona, un lugar, un
   término.
2. Pulsa el botón **Photo** de la barra de herramientas flotante (*Search photo
   or attach image*).
3. Se abre el diálogo **Search Image / Photo** con la **consulta ya
   rellenada** con tu selección, y la búsqueda **se ejecuta automáticamente**.
4. Revisa los resultados y elige uno.

También puedes abrirlo desde el botón **Photo** del editor de una nota
existente, para adjuntar una imagen a esa nota concreta.

### 6.2 De dónde salen los resultados

| Fuente | Qué aporta |
| --- | --- |
| **Wikipedia** | La imagen principal del artículo, con un resumen biográfico |
| **Wikimedia Commons** | Fotografías, retratos, pinturas y material de alta resolución |

La búsqueda se hace **en paralelo** contra las dos, y los resultados se
combinan sin duplicar URLs. Hay tres modos en el selector de segmented
control: **todas**, solo Wikipedia, solo Commons.

### 6.3 Idioma

El diálogo usa el **idioma del libro** para buscar en Wikipedia. Si no hay
resultados en ese idioma, **recae automáticamente al inglés**. Puedes cambiar
el idioma a mano.

### 6.4 Qué hace al elegir una imagen

Al confirmar con **Use this photo**, Minerva inserta Markdown en la nota:

```markdown
![Título de la imagen](https://url.de.la.imagen)

> Resumen biográfico o descripción de la imagen.
```

El resumen se añade solo si has dejado marcado **Include biographical
summary in note**. El aviso *Photo attached to note* confirma la operación.

Si no estás editando una nota, la imagen se inserta en la nota de la
selección actual.

### 6.5 Si no hay resultados

El diálogo ofrece dos salidas alternativas:

| Opción | Para qué |
| --- | --- |
| **Paste image URL instead** | Pegar la URL directa de una imagen que ya tengas |
| **Search person, character, place...** | Cambiar la consulta |

El mensaje de ayuda es explícito: *Try searching with the full name,
switching language, or paste an image URL.*

> **La vista previa requiere un enlace directo.** Si pones una URL de una
> página web en lugar de la imagen, verás *Could not load image preview.
> Check that the link is direct.*

### 6.6 Privacidad

Las consultas viajan a `wikipedia.org` y `commons.wikimedia.org`. **El texto
que selecciones sí sale de tu equipo** al hacer la consulta, pero solo la
cadena de búsqueda, no el libro. Minerva no envía el contenido del libro a
ningún servicio de imágenes.

---

## 7. Continuar lectura y atajos de teclado

### 7.1 El póster de *Continuar lectura*

Lo primero que ves al abrir la biblioteca es una pieza de composición a
tamaño completo:

| Elemento | Contenido |
| --- | --- |
| Portada | Con el **lomo**: la regla del canto que se rellena con el progreso |
| Título y autor | Del libro en curso |
| Porcentaje | La cifra grande, como protagonista |
| Barra de progreso | La misma marca del lomo, puesta horizontal |
| Tiempo restante | Estimación en minutos, calculada con la mediana de tus últimas sesiones |

Clic en cualquier punto de la portada abre el libro exactamente donde lo
dejaste.

> **La composición es una solapa de libro:** el libro y sus datos sobre el
> papel, el porcentaje impreso en un panel tonal al lado, como una solapa
> declara la edición de un clásico. El número manda; todo lo demás se reduce
> para dejarlo hablar.

**Cuándo aparece.** Solo si hay un libro en estado *Reading* con progreso
entre 0 % y 100 %, y solo en la vista **por defecto** de la biblioteca. Si
estás buscando, filtrando por un grupo o viendo una estantería concreta, el
póster desaparece: una vista filtrada es una vista sobre la colección, no un
sitio para anunciar un libro.

**El lomo.** Es la señal propia de la identidad de Minerva: la regla vertical
del canto de la portada que se rellena con el progreso de lectura. Cuando
enfocas la ficha, el lomo **se enciende**: pasa de bronce apagado a bronce
pleno. Solo color, nunca transformación.

### 7.2 Atajos de teclado

La lista completa está en **Ajustes → Keyboard Shortcuts** y en el diálogo de
ayuda, que se abre con `Shift + ?`. **Todos son remapeables.**

#### General

| Atajo | Acción |
| --- | --- |
| `Shift + ?` | Mostrar los atajos de teclado |
| `Ctrl + Shift + P` / `Cmd + Shift + P` | Paleta de comandos |
| `Shift + F` · `Ctrl + ,` · `Cmd + ,` | Abrir Ajustes |
| `Ctrl + O` / `Cmd + O` | Abrir libros |
| `N` | Mostrar/ocultar el Cuaderno |
| `S` | Mostrar/ocultar la barra lateral |
| `Ctrl + Tab` / `Opt + Tab` / `Alt + Tab` | Cambiar de pestaña en la barra lateral |
| `Ctrl + F` / `Cmd + F` | Buscar en el libro |
| `Shift + J` | Alternar modo de desplazamiento |
| `Shift + P` | Alternar modo párrafo |
| `Shift + V` | Modo de lectura rápida (RSVP) |
| `Shift + A` | Desplazamiento automático |
| `Ctrl + B` / `Cmd + B` | Alternar marcador |
| `T` | Alternar lectura en voz alta |
| `Enter` | Mostrar/ocultar la barra de herramientas |
| `Shift + R` | Recargar la página |
| `Escape` | Cerrar |

#### Selección

| Atajo | Acción |
| --- | --- |
| `Ctrl + H` / `Cmd + H` | Resaltar la selección |
| `Ctrl + U` / `Cmd + U` | Subrayar la selección |
| `Ctrl + N` / `Cmd + N` | Anotar la selección |
| `Ctrl + F` / `Cmd + F` | Buscar la selección |
| `Ctrl + C` | Copiar la selección |
| `Ctrl + T` / `Cmd + T` | Traducir la selección |
| `Ctrl + D` / `Cmd + D` | Consultar el diccionario |
| `Ctrl + R` / `Cmd + R` | Leer la selección en voz alta |
| `Ctrl + P` / `Cmd + P` / `Alt + P` | Corregir la selección |

#### Navegación

| Atajo | Acción |
| --- | --- |
| `←` · `H` | Página anterior / ir a la izquierda |
| `→` · `L` · `Espacio` | Página siguiente / ir a la derecha |
| `↑` · `K` | Subir |
| `↓` · `J` | Bajar |
| `Shift + →` · `Shift + ↓` · `AvPág` | Página siguiente |
| `Shift + ←` · `Shift + ↑` · `RePág` | Página anterior |
| `Alt + ←` / `Opt + ←` | Capítulo anterior |
| `Alt + →` / `Opt + →` | Capítulo siguiente |
| `D` | Media página abajo |
| `U` | Media página arriba |
| `Home` | Inicio del libro |
| `End` | Final del libro |
| `Shift + H` | Atrás |
| `Shift + L` | Adelante |

#### Lectura en voz alta

| Atajo | Acción |
| --- | --- |
| `Espacio` | Reproducir / pausar |
| `Ctrl + ]` / `Cmd + ]` | Frase siguiente |
| `Ctrl + [` / `Cmd + [` | Frase anterior |
| `Ctrl + Shift + }` | Párrafo siguiente |
| `Ctrl + Shift + {` | Párrafo anterior |
| `Shift + M` | Resaltar la frase actual |

#### Zoom y ventana

| Atajo | Acción |
| --- | --- |
| `Ctrl + =` / `Cmd + =` | Acercar |
| `Ctrl + -` / `Cmd + -` | Alejar |
| `Ctrl + 0` / `Cmd + 0` | Restablecer el zoom |
| `F11` | Pantalla completa |
| `Ctrl + W` / `Cmd + W` | Cerrar la ventana |
| `Ctrl + Q` / `Cmd + Q` | Salir de la app |

#### Notas

| Atajo | Acción |
| --- | --- |
| `Ctrl + Enter` / `Cmd + Enter` | Guardar la nota |

> En macOS, `Cmd` sustituye a `Ctrl` en todos los casos; Minerva muestra la
> tecla correcta según la plataforma.

---

## 8. Diferencias frente a Readest

### 8.1 Lo que Minerva añade

| Función | Qué es | Dónde |
| --- | --- | --- |
| **Cuaderno de notas en Markdown** | Panel lateral con editor de Markdown real, organizado por capítulos del libro, con citas que enlazan a la posición exacta del texto (CFI) y viaje de ida y vuelta a Markdown garantizado | `src/app/reader/components/notebook/` |
| **Búsqueda contextual de imágenes** | Desde la selección, busca en Wikipedia y Wikimedia Commons, con idioma según el libro, resumen biográfico opcional e inserción como Markdown en la nota | `src/services/imageSearch/`, `annotator/ImageSearchDialog.tsx` |
| **Póster de *Continuar lectura*** | Un póster a tamaño completo con el libro en curso, su porcentaje impreso como cifra protagonista y el tiempo restante estimado | `src/app/library/components/ContinueReadingHero.tsx` |
| **La identidad visual *Minerva*** | Bronce y oro sobre neutros cálidos, tipografía display serif, el «lomo» como señal propia, semitono, y modo e-ink sin sombras | `src/styles/themes.ts`, `globals.css`, `IDENTITY.md` |
| **Backend autoalojable** | Un Worker + D1 + R2 de tu cuenta, con un comando de despliegue, cifrado en cliente y compatibilidad KOSync | `workers/minerva-sync/`, `deploy-cloudflare.sh` |
| **Empaquetado multiplataforma propio** | Linux con runtime **CEF**, Windows con **WebView2** y el DLL de miniaturas compilado aparte, Android con **NDK 28.2** y APK arm64 | `docs/BUILD_WINDOWS_MACOS.md` |
| **Español completo** | Todo el catálogo de la interfaz, incluidas las funciones nuevas | `public/locales/es/` |

### 8.2 Lo que Minerva cambia

| Aspecto | Cambio |
| --- | --- |
| **Cuenta** | Opcional. La app se usa entero sin registrarse |
| **Sincronización** | Apunta a **tu** Worker, con cifrado en cliente. Los proveedores de ficheros (WebDAV, Google Drive, S3, OneDrive, iCloud) siguen disponibles |
| **Telemetría** | Opt-in estricto, con salida por defecto en el 90 % de las instalaciones nuevas, y sin SDK arrancado si no hay clave configurada |
| **Pagos** | En un despliegue propio (`SELF_HOSTED=true`) **todas** las funciones quedan disponibles: no hay tienda |
| **Marca** | Minerva en todas partes: nombre, icono, paleta, tipografía, textos de la interfaz y del instalador |
| **Dependencias** | Se retiraron las credenciales del servicio alojado que venían embebidas; el `.env.example` pasó de más de cien variables a nueve |
| **Datos sensibles** | Cifrados en el cliente con PBKDF2 (600 000 iteraciones) en la superficie propia; MD5 en la compatibilidad KOSync |
| **Empaquetado de Linux** | Runtime CEF en lugar de Electron: un solo binario autocontenido, sin instalar Chromium aparte |

### 8.3 Lo que Minerva elimina

| Eliminado | Detalle |
| --- | --- |
| **Credenciales embebidas del servicio alojado** | `publicDefaults.ts` (Supabase, Stripe, PostHog, Pagebound en base64) se borró del repositorio. El plugin de Calibre y el *koplugin* de KOReader dejaron de llevar la clave del servicio original |
| **Scripts de cuentas del servicio alojado** | `inspect-accounts.mjs` y `merge-accounts.mjs` eliminados |
| **Dependencia de cuenta obligatoria** | Sin registro previo para leer, importar, anotar ni usar el Cuaderno |
| **Autoinstalación del runtime en Linux** | El AppImage es autónomo |

### 8.4 Sobre las traducciones

La interfaz está disponible en **35 idiomas**:

`ar` · `bn` · `bo` · `de` · `el` · `en` · `es` · `fa` · `fr` · `he` · `hi` ·
`hu` · `id` · `it` · `ja` · `ka` · `ko` · `ms` · `nl` · `pl` · `pt` · `pt-BR` ·
`ro` · `ru` · `si` · `sl` · `sv` · `ta` · `th` · `tr` · `uk` · `uz` · `vi` ·
`zh-CN` · `zh-TW`

Minerva usa un esquema de *clave como contenido*: la cadena en inglés **es** la
clave de traducción, y el locale inglés está vacío a propósito. Los idiomas
que aún no han recibido una traducción caen con elegance al texto inglés, así
que nunca ves una cadena vacía.

El **español** y el **inglés** cubren el 100 % de las funciones, incluidas
todas las nuevas: Cuaderno, búsqueda de imágenes, póster de *Continuar
lectura*, estados de lectura y búsqueda de texto completo.

> **Sobre las funciones nuevas en los demás idiomas:** las cadenas más
> recientes —el póster de *Continuar lectura* y el diálogo de búsqueda de
> imágenes— están traducidas al español y pendientes de traducción en el resto
> de idiomas, que muestran el texto inglés hasta que se complete la
> traducción. Los demás idiomas cubren ya el Cuaderno, los estados de lectura
> y la búsqueda de texto completo.

Para cambiar el idioma: **Ajustes → Idioma → Idioma**, o el selector *System
Language* para que siga al del sistema.

---

## 9. Preguntas frecuentes (FAQ)

### 9.1 General

**¿Tengo que crear una cuenta?**
No. Minerva se usa entero sin cuenta. La cuenta solo hace falta si quieres
sincronizar entre dispositivos.

**¿Envía datos a algún servidor sin que yo lo pida?**
No. Sin backend configurado, la app no hace peticiones de cuenta. La
telemetría está apagada por defecto y su SDK ni siquiera arranca sin clave.

**¿Se puede usar sin conexión?**
Sí, por completo. La biblioteca, las notas, el Cuaderno y las
anotaciones son locales. Solo las funciones que necesitan red (sincronización,
traducción, diccionario web, búsqueda de imágenes, IA) la requieren.

**¿Qué formatos admite?**
EPUB, PDF, MOBI, AZW, AZW3, KF8, FB2, CBZ, TXT, MD, HTML, HTM, MHTML, MHT. Los
`.docx` y `.rtf` se convierten a EPUB al importarlos.

**¿Qué diferencia hay entre una nota y un extracto?**
Una **nota** (anotación) es texto tuyo anclado a una posición del libro. Un
**extracto** es texto del libro copiado al Cuaderno. Las citas del Cuaderno se
construyen a partir de extractos.

**¿Puedo editar el Markdown a mano?**
No directamente, pero el Markdown es el formato de almacenamiento: si exportas
las anotaciones en Markdown puedes editarlas y volver a importarlas.

### 9.2 Sincronización con tu propio servidor

**¿Cómo monto el servidor?**
```bash
git clone --recurse-submodules https://github.com/minerva/minerva.git
cd minerva
npx wrangler login
./deploy-cloudflare.sh
```
El script imprime la URL del Worker al terminar.

**¿Cómo conecto la app?**
1. **Ajustes → Integraciones → Minerva Cloud (Cloudflare)**.
2. Pega la URL del Worker y pulsa **Probar conexión**.
3. Regístrate con email y *passphrase*. El servidor solo guarda una
   derivación PBKDF2: **no puede recuperar tu passphrase**, así que guárdala.

**¿Puedo poner la URL de mi Worker directamente al iniciar sesión?**
Sí. En la **pantalla de autenticación** hay un campo **Servidor Cloudflare**
(placeholder `https://tu-worker.workers.dev`). Pegas ahí la URL de tu Worker
y pulsas **Iniciar sesión** o **Registrarse**: la app la sanea, la guarda en
el `localStorage` del dispositivo y a partir de ese momento habla con tu
Worker. No hace falta desplegar nada más ni reconfigurar nada.

El campo es **obligatorio** en el modo autoalojado: si no hay ninguna URL
guardada de antes, la app te la pide y no deja entrar.

**¿Qué URLs acepta?**
Solo `https://` —con la única excepción de `http://` en `localhost` y en
direcciones loopback, para pruebas locales—. La app descarta las
credenciales incrustadas en la URL (`https://usuario:clave@…`), la cadena de
consulta (`?…`) y el fragmento (`#…`), y quita las barras finales. Si la URL
no es válida, el formulario lo dice y no continúa.

**¿Y si no quiero sincronizar con nada?**
No tienes que hacer nada. La app funciona **100 % offline** con los binarios
oficiales: leer, anotar, la biblioteca, las exportaciones y el Cuaderno no
salen de tu dispositivo. La URL del Worker solo hace falta cuando quieres
sincronizar entre dispositivos o guardar tus libros en tu propio R2.

**¿Qué es exactamente el *passphrase*?**
Es la clave con la que se cifra en el cliente. El servidor guarda la sal y el
texto cifrado. Si la pierdes, los datos sincronizados de ese dispositivo no se
pueden recuperar.

**¿Puedo usar KOReader con el mismo servidor?**
Sí. **Ajustes → Integraciones → KOReader**, con la URL del Worker, tu email y
tu passphrase.

**¿Qué otros proveedores de sincronización hay?**
WebDAV, Google Drive, S3, OneDrive e iCloud para la **sincronización de
ficheros**; KOSync, BookOrbit, Readwise, Hardcover, Pagebound y Notion para
progreso y notas.

### 9.3 El Cuaderno

**¿Dónde se guarda el Cuaderno?**
En el `config.json` del propio libro, dentro de la carpeta de la biblioteca. No
en la base de datos. Por eso el Cuaderno viaja con el libro en las copias de
seguridad y en la sincronización de ficheros.

**¿Se puede exportar el Cuaderno a un fichero Markdown?**
No directamente. La exportación de anotaciones cubre resaltados, marcadores y
extractos, pero excluye el documento del Cuaderno por diseño. La vía
alternativa es copiar el contenido del panel o usar la copia de seguridad
completa de la app.

**¿Por qué el botón *Quote from the book* está deshabilitado?**
Porque no tienes extractos. Activa *Copy to Notebook* en Ajustes →
Comportamiento, y copia algo del libro.

**He perdido cambios sin guardar del Cuaderno**
Minerva guarda una copia de recuperación en localStorage cada vez que editas.
Si al abrir el libro aparece *Unsaved Notebook changes conflict with the
latest saved version*, puedes elegir **Use latest saved** o **Recover draft**.
En el diálogo de error de guardado, **Copy draft** lleva el Markdown al
portapapeles.

**¿El Cuaderno tiene límite de tamaño?**
Sí: 256 KB por libro. Si lo superas, verás *Notebook is too large to save.
Copy or remove some text to continue.*

### 9.4 Búsqueda de imágenes

**¿De dónde salen las imágenes?**
De Wikipedia y Wikimedia Commons, en paralelo y sin duplicados.

**¿Se envía el texto de mi libro a alguna parte?**
Solo la cadena de búsqueda que has seleccionado, a `wikipedia.org` y
`commons.wikimedia.org`. El libro no se envía.

**¿Por qué no aparece nada para mi consulta?**
Prueba con el nombre completo, cambia el idioma, o usa **Paste image URL
instead** para pegar la URL directa de una imagen.

**¿El idioma importa?**
Sí. La búsqueda usa el idioma del libro, y cae al inglés si no hay
resultados. Si no hay resultados en el idioma del libro, la búsqueda **recae
automáticamente al inglés**.

### 9.5 Privacidad

**¿Cómo desactivo la telemetría definitivamente?**
**Ajustes → Comportamiento → Privacy → Help improve Minerva**, y apágalo. La
decisión se guarda y sobrevive a las actualizaciones. También puedes salir
desde la paleta de comandos.

**¿Qué se envía si la activo?**
Eventos de uso anónimos, con la versión de la app. No se envían los libros,
ni el texto leído, ni las notas. Minerva no usa Recordings de sesión, ni
banderas de funcionalidad, ni encuestas.

**¿Qué cifrado usa la sincronización?**
Los campos sensibles se cifran **en el cliente** antes de subirlos. La clave se
deriva de tu *passphrase* con PBKDF2 (600 000 iteraciones). El servidor solo
almacena la sal y el texto cifrado.

---

## 10. Resolución de problemas por sistema operativo

### 10.1 Linux

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| *Permission denied* al ejecutar el AppImage | Falta el bit de ejecución | `chmod +x Minerva-1.0.5-x86_64.AppImage` |
| *AppImage needs FUSE* | FUSE no está instalado | `sudo apt install libfuse2` (Debian/Ubuntu) o `sudo dnf install fuse` (Fedora), o ejecuta con `--appimage-extract-and-run` |
| *dlopen(): libcef.so not found* | Extracción incompleta | Borra la caché de AppImages y vuelve a extraer: `rm -rf ~/.cache/appimage` |
| Aviso de *user namespaces* | El kernel pide confine | El AppImage incluye un hook que lo evita; si persiste, ejecuta `sysctl -u kernel.unprivileged_userns_clone` |
| No aparece en el menú de aplicaciones | Falta el `.desktop` | Instálalo como se indica en [2.2](#22-linux-appimage) |
| La ventana se abre en blanco | Falta WebKitGTK | En esta versión el runtime es CEF; si el error persiste, instala `libnss3`, `libgbm1`, `libasound2` y `libxkbcommon` |
| La app no arranca en una distro antigua | Glibc demasiado antiguo | Necesitas glibc 2.31 o superior |

### 10.2 Windows

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| *This app can't run on your PC* | Arquitectura o sistema demasiado antiguo | Windows 10 1809+ en x64. En ARM64, usa el emulador x64 de Windows |
| *WebView2 runtime not found* | Falta el runtime de WebView2 | Se instala solo la primera vez; si falla, descárgalo desde el sitio de Microsoft y reinicia |
| La ventana aparece en blanco | WebView2 no se cargó | Actualiza el runtime de WebView2 y reinicia la app |
| SmartScreen dice *unknown publisher* | El ejecutable no está firmado con Authenticode | Expected en esta compilación. **More info → Run anyway**, o usa una compilación firmada |
| El antivirus bloquea el `.exe` | Falso positivo por compilación con mingw | Comprueba el hash SHA-256 del fichero antes de permitirlo |
| Las miniaturas no aparecen en el Explorador | El DLL no está registrado | El registro lo hace el instalador NSIS, que necesita un equipo con Windows. Ver `docs/BUILD_WINDOWS_MACOS.md` |
| `minerva.exe` no encuentra `WebView2Loader.dll` | DLL fuera de su carpeta | Mantén los tres ficheros juntos en la misma carpeta |
| La ventana se abre detrás de otra | Hierarchy de ventanas | Alt+Tab, o `Ctrl + W` y vuelve a abrir |

### 10.3 Android

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| *App not installed* | Firma o versión previa con firma distinta | Desinstala la versión anterior. Al cambiar de clave de firma, hay que desinstalar sí o sí |
| *Parse error* al instalar | El APK está dañado | Verifica el SHA-256 y vuelve a descargarlo |
| *For Work Profile* en la instalación | Política del perfil gestionado | Instala desde el dispositivo personal |
| La app se cierra al abrir un PDF | Falta de memoria en PDF de maquetación fija | Prueba con el modo *Fit Width* para reducir el consumo |
| No encuentra los libros del almacenamiento | Permiso `MANAGE_EXTERNAL_STORAGE` no concedido | Ajustes → Aplicaciones → Minerva → Permisos → *Todos los archivos* |
| La batería se agota | Sincronización o desplazamiento automático activo | Ajustes → Integraciones: revisa la frecuencia; desactiva el auto-scroll |
| La instalación se bloquea | Android bloquea fuentes desconocidas | Ajustes → Apps → Acceso especial → *Instalar apps desconocidas* → activa el explorador que usas |

### 10.4 macOS

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| No hay `.dmg` que descargar | No se puede compilar para macOS desde Linux | Compílalo en un Mac. Ver [2.5](#25-macos) |
| *La aplicación no se puede abrir* / *app can't be opened* | Falta la firma o el permiso | `xattr -cr /Applications/Minerva.app` y ábrela otra vez |
| *macOS cannot verify the developer* | Binario sin notarizar | Requiere firma Developer ID y notarización, ambas solo en macOS |
| *The application cannot be opened* tras instalar | Gatekeeper | Ajustes → Privacidad y seguridad → *Abrir de todos modos* |
| La app no encuentra la biblioteca | Permisos de la carpeta de libros | Ajustes → Seguridad y privacidad → Acceso a archivos → añade la carpeta de la biblioteca |
| El atajo de Apple *Sign in with Apple* falla | Entorno de desarrollo | En una build de distribución hay que rehacer la firma con el certificado de Apple |

---

## 11. Referencia rápida

### 11.1 Dónde está cada cosa

| Quiero… | Dónde |
| --- | --- |
| Importar libros | Biblioteca → botón **Import Books** |
| Organizar | Menú **View** → *Group by…*, *Sort by…*, *Bookshelves* |
| Ver los detalles de un libro | Menú contextual → **Show Book Details** |
| Editar metadatos | *Show Book Details* → **Edit Metadata** |
| Buscar en el contenido | Biblioteca → campo de búsqueda → **Full Text Search** |
| Cambiar el tema | Ajustes → Theme |
| Cambiar la fuente | Ajustes → Font |
| Cambiar los márgenes | Ajustes → Layout |
| Abrir el Cuaderno | `N` o el botón **Notebook** |
| Exportar resaltados | Menú del libro → **Export Annotations** |
| Importar anotaciones | Menú del libro → **Import Annotations** |
| Buscar una imagen | Seleccionar texto → botón **Photo** |
| Conectar el servidor | Ajustes → Integraciones → **Minerva Cloud (Cloudflare)** |
| Activar la IA | Ajustes → AI Assistant |
| Ver los atajos | `Shift + ?` |
| Ver las estadísticas | Menú **View** → **Reading Statistics** |
| Activar el modo e-ink | Ajustes → Comportamiento → Device → **E-Ink Mode** |

### 11.2 Atajos que se olvidan

| Atajo | Por qué |
| --- | --- |
| `N` | El Cuaderno es la función propia de Minerva |
| `Ctrl + N` | Anotar la selección sin ratón |
| `Shift + ?` | La lista completa de atajos, sin buscar en el manual |
| `Ctrl + Shift + P` | La paleta de comandos tiene casi todos los ajustes |
| `Shift + J` / `Shift + P` | Cambio rápido entre paginado y desplazamiento |
| `Ctrl + B` | Marcador, siempre a mano |

### 11.3 Documentos relacionados

| Documento | Contenido |
| --- | --- |
| [`README.md`](../README.md) | Qué es el repositorio, despliegue del backend, estructura del proyecto |
| [`BUILD_WINDOWS_MACOS.md`](BUILD_WINDOWS_MACOS.md) | Compilación cruzada para Windows, el DLL de miniaturas, los bloqueadores de macOS, el estado del `Cargo.lock` |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Runbook del backend: migraciones, verificación, copias de seguridad, rollback |
| [`SECURITY.md`](../SECURITY.md) | Modelo de amenazas, superficies de ataque y mitigaciones |
| [`NOTICE`](../NOTICE) | Autoría original y atribuciones |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Cómo contribuir |

---

## Licencia y atribución

Minerva es software libre bajo la **GNU Affero General Public License v3.0** o
posterior. El texto completo está en [`LICENSE`](../LICENSE).

Minerva es un proyecto independiente. Deriva de
[Readest](https://github.com/readest/readest), © Bilingify LLC y los
contribuyentes de Readest, y conserva sus avisos de autoría originales, como
exige la licencia. Los componentes de terceros conservan sus propias licencias;
la lista está en el *Acknowledgments* del [`README.md`](../README.md).

> Si usas Minerva modificado a través de una red, la sección 13 de la AGPL te
> obliga a ofrecer el código fuente correspondiente. Publica tu repositorio y
> apunta a él en el diálogo **About Minerva**.
