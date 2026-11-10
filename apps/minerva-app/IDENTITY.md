# Minerva — identity brief

The visual identity of the fork's app, in one page. The rules themselves live in
[`DESIGN.md`](./DESIGN.md); this is the *why* behind them and the brief they
were built from.

## The brief

```
Producto y dominio : Minerva — lector de ebooks multiplataforma (web / Tauri /
                      iOS / Android / e-ink). La biblioteca es el muelle de
                      partida; la lectura ocurre en otra pantalla. Las cifras que
                      importan: páginas leídas / totales, tiempo restante y el
                      estado de lectura (unread / reading / finished / abandoned).
Modo               : Operate (app)
Dirección repartida: minerva-ivory (claro) + minerva-bronze (acento) ·
                      display Cormorant Garamond · body Inter · mono IBM Plex Mono ·
                      composición number-poster · shell top-nav · densidad airy ·
                      motivo halftone · forma round-friendly
Invención libre    : "El Lomo" — un componente firma: la regla vertical del
                      canto de la portada que se rellena con el progreso de
                      lectura, con el folio (contador de páginas) en mono.
Por qué sirve      : el usuario de un lector no quiere una rejilla de miniaturas;
                      quiere saber por dónde iba. El lomo convierte el estado en
                      algo legible de un vistazo, sin badges ni colores que
                      tengan que significar algo.
Pieza protagonista : el póster de la biblioteca — el libro en curso con su
                      porcentaje impreso en grande.
Momento firma      : "el lomo se enciende" — la regla del canto pasa de bronce
                      apagado a bronce pleno al enfocar la ficha. Solo color.
Lo que evitamos    : cuatro tarjetas KPI, violeta/índigo/celeste, sombras duras
                      sin tinte, degradados en texto, emojis como iconos,
                      fuentes desde CDN, un display para todo.
```

La marca manda sobre el reparto: acento, fondo y tipografías están bloqueados a
la identidad de Minerva (`themes.ts`), y todo lo demás —composición, motivo,
momento, invención— se reparte para que no se repita con otros proyectos.

## Las tres señales

Implementadas una sola vez en `src/styles/globals.css` y usadas por clase:

| Señal | Clase | Qué hace |
| --- | --- | --- |
| **El lomo** | `.minerva-spine` | La regla del canto de la portada con el progreso de lectura. Solo aparece en libros ya abiertos. |
| **Semitono** | `.minerva-halftone` | La trama de impresión que sangra por la esquina de una superficie. |
| **El momento dorado** | `.minerva-spine-host` | El lomo se enciende al enfocar. Color, nunca transform. |

Bajo `[data-eink='true']` el lomo pasa a ser una regla de 1 px, el semitono
desaparece y los acentos de bronce se vuelven tinta: una pantalla e-ink dibuja
todo lo que la identidad pide.

## Cómo verlo

```bash
cd apps/minerva-app
pnpm dev-web          # servidor web en http://localhost:3001
pnpm build-web        # build de producción
pnpm lint             # tsc + biome
pnpm test             # vitest
```

La app necesita una biblioteca para mostrar la pantalla principal: importa un
EPUB desde *Biblioteca → Importar libros*.

## Límites conocidos

- La identidad vive sobre el tema por defecto (`default`, "Minerva"). Los otros
  diez temas heredan la estructura, no el particular.
- El lomo solo se dibuja en la rejilla y en el panel de detalle; la vista de
  lista mantiene la fila de Adwaita.
- El semitono es decorativo y no se dibuja en e-ink.
- Los textos nuevos de los paneles de Ajustes están traducidos solo en `es`;
  el resto de idiomas usan el texto inglés (el fallback de i18next).
