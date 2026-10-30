# BLUEPRINT DE ESPECIFICACIÓN TÉCNICA (PRD) — PARTE 2
## Minerva (Fork de Readest) — Asistente de Comprensión de Lectura con Google Gemini (Modo Dual) e Infraestructura

- **Versión:** 2.0.0
- **Documento:** `BACKEND_SPEC_2.md` (Continuación aditiva de `BACKEND_SPEC.md`)
- **Estado:** Especificación Validada
- **Módulos Abarcados:**
  - Lector Inmersivo y Anotador (`readest/apps/readest-app/src/app/reader/`)
  - Servicio de IA Multimodelo (`readest/apps/readest-app/src/services/ai/`)
  - Sincronización en Cloudflare D1 de Notas IA (`readest/apps/readest-app/workers/readest-sync/`)
- **Objetivo:** Permitir al lector comprender oraciones complejas, conceptos abstractos y personajes en tiempo real con Google Gemini, eligiendo entre un HUD flotante in-situ o delegando a la app oficial de Gemini en Android/escritorio, con persistencia sincronizada.

---

## 1. Resumen Ejecutivo y Flujos de Interacción

### 1.1. Filosofía de UX y Valor Diferencial
Minerva extiende el lector de Readest con comprensión literaria instantánea sin romper el estado de concentración:
- **Cero Fricción:** Sin paneles laterales obligatorios ni ventanas modales que tapen la lectura.
- **Enfoque Dual Flexible:**
  - **Modo 1 (In-Situ HUD):** Micro-tarjeta flotante que explica la frase o concepto en 2 a 3 viñetas mediante streaming ultrarrápido con Gemini 1.5/2.0 Flash (API gratuita).
  - **Modo 2 (App Handoff):** Envío directo mediante Intent nativo a la app oficial de Gemini en Android (o versión web en escritorio) para diálogo extendido.
- **Persistencia en Minerva Sync (D1):** Cualquier explicación generada por Gemini puede guardarse con un solo toque como una nota al margen en la tabla `book_notes` del Cloudflare Worker.

### 1.2. Diagrama de Flujo

```
[ Usuario selecciona texto en el lector (EPUB / PDF) ]
                         │
                         ▼
   [ Barra de Selección / AnnotationTools ]
   ├── [ 💡 Explicar con Gemini ] ──► MODO 1: Popover In-Situ
   └── [ ↗️ Abrir en App Gemini ]  ──► MODO 2: Intent / Handoff
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
[ Modo 1: Popover Flotante ]      [ Modo 2: Deep Link Nativo ]
├── Píldoras rápidas:             ├── En Android (Capacitor):
│   • 💡 Simplificar/Parafrasear  │     Intent a 'com.google.android.apps.bard'
│   • 📜 Contexto histórico       └── En Web / Linux:
│   • 🧩 ¿Quién es el personaje?        Abre 'https://gemini.google.com/app'
├── Streaming SSE en tiempo real
└── [ 📌 Guardar como Nota ]
         │
         ▼
[ Sincronización a Cloudflare D1 ] ──► (POST /api/sync)
```

---

## 2. Arquitectura y Contratos de Interfaz

### 2.1. Ficheros del Proyecto Involucrados
```text
readest/apps/readest-app/
├── src/
│   ├── services/
│   │   └── ai/
│   │       ├── types.ts                    <-- Añadir 'gemini' a AIProviderName y ajustes en AISettings
│   │       ├── providers/
│   │       │   ├── GeminiProvider.ts       <-- Proveedor nativo con streaming REST de Google Gemini
│   │       │   └── index.ts                <-- Exportación y registro del provider
│   │       └── prompts.ts                  <-- Prompt conciso anti-spoilers para comprensión in-situ
│   ├── app/
│   │   └── reader/
│   │       ├── components/
│   │       │   └── annotator/
│   │       │       ├── AnnotationTools.tsx <-- Añadir botón 'gemini' a la barra de selección
│   │       │       └── GeminiReadingPopup.tsx <-- Componente HUD flotante con streaming
│   │       └── utils/
│   │           └── geminiIntent.ts         <-- Despachador de intents para Android/Desktop
│   └── components/
│       └── settings/
│           └── AISettings.tsx              <-- Configuración de clave Gemini y modo predeterminado
```

### 2.2. Modelo de Tipos (`src/services/ai/types.ts`)
```typescript
export type AIProviderName = 'ollama' | 'ai-gateway' | 'openrouter' | 'gemini';

export interface AISettings {
  // Campos existentes conservados intactos...
  geminiApiKey?: string;
  geminiModel?: 'gemini-1.5-flash' | 'gemini-2.0-flash' | 'gemini-1.5-pro';
  geminiDefaultAction?: 'popover' | 'external' | 'ask';
}
```

### 2.3. Proveedor Gemini (`GeminiProvider.ts`)
Implementa la interfaz estándar `AIProvider`:
```typescript
import type { AIProvider, AIProviderName } from '../types';

export class GeminiProvider implements AIProvider {
  id: AIProviderName = 'gemini';
  name = 'Google Gemini';
  requiresAuth = true;

  constructor(private apiKey?: string, private model = 'gemini-1.5-flash') {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}?key=${this.apiKey}`
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  // Streaming directo de texto para el HUD
  async streamExplanation(
    selectedText: string,
    mode: 'explain' | 'context' | 'character',
    context: { bookTitle: string; author?: string; currentPage?: number },
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    // Manejo de SSE y despacho de fragmentos al callback onChunk
    // ...
  }
}
```

### 2.4. Handoff Externo (`geminiIntent.ts`)
```typescript
export function openInGeminiApp(selectedText: string, action = 'explain'): void {
  const query = `Por favor, explica y contextualiza el siguiente fragmento del libro:\n\n"${selectedText}"`;
  
  // 1. Android (Contenedor Capacitor)
  if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform()) {
    const intentUrl = `intent://send?text=${encodeURIComponent(query)}#Intent;package=com.google.android.apps.bard;action=android.intent.action.SEND;type=text/plain;end`;
    window.location.href = intentUrl;
    return;
  }

  // 2. Navegador Web / Linux Desktop
  const webUrl = `https://gemini.google.com/app?q=${encodeURIComponent(query)}`;
  window.open(webUrl, '_blank', 'noopener,noreferrer');
}
```

---

## 3. Directivas de Prompt In-Situ (Comprensión Inmersiva)

Para respetar el ritmo de lectura:
- **Longitud acotada:** Máximo 60-80 palabras.
- **Formato:** 2 viñetas concisas y un breve resumen.
- **Regla Anti-Spoilers estricta:** No anticipar giros ni desenlaces posteriores a la página actual.

---

## 4. Casos Borde y Resiliencia

1. **Sin Conexión:** Si no hay internet, el popover notifica amablemente y ofrece guardar el texto seleccionado como nota pendiente.
2. **Sin API Key configurada:** El popover muestra un acceso directo para pegar la clave gratuita de Google AI Studio o derivar directamente al Modo 2 (App externa).
3. **Cancelación por scroll o toque:** Si el lector avanza la página o toca fuera, se emite `AbortController.abort()` para liberar recursos de inmediato.
4. **App no instalada en Android:** El intent cuenta con fallback automático para abrir la versión web en el navegador móvil sin romper la app.

---

## 5. Reglas de Calidad para el Agente

1. **Tipado Estricto:** Prohibido `any` implícito. Compilación limpia con `cd readest/apps/readest-app && npx tsc --noEmit`.
2. **Estilo y Temas:** Respetar los temas existentes (oscuro, sepia, claro) de Readest para el diseño del popover.
3. **Persistencia Transparente:** La opción de "Guardar como nota" utiliza el flujo nativo de anotaciones existente, sincronizándose con Cloudflare D1 vía `POST /api/sync`.

---

## 6. Prompt Maestro de Ejecución (Para Agentes de Código)

```markdown
<TASK>
Implementar la especificación BACKEND_SPEC_2.md en Minerva (Readest): Asistente de comprensión de lectura con Google Gemini (Modo Dual).

INSTRUCCIONES PASO A PASO:
1. SERVICIO IA:
   - En `readest/apps/readest-app/src/services/ai/types.ts`, amplía `AIProviderName` con `'gemini'` y agrega `geminiApiKey`, `geminiModel`, `geminiDefaultAction` a `AISettings`.
   - Crea `readest/apps/readest-app/src/services/ai/providers/GeminiProvider.ts` con streaming REST (`streamGenerateContent?alt=sse`).
   - Registra el proveedor en `readest/apps/readest-app/src/services/ai/providers/index.ts`.

2. HANDOFF EXTERNO:
   - Crea `readest/apps/readest-app/src/app/reader/utils/geminiIntent.ts` con `openInGeminiApp()` soportando intent de Android y fallback web.

3. INTERFAZ EN EL LECTOR:
   - En `readest/apps/readest-app/src/app/reader/components/annotator/AnnotationTools.tsx`, agrega la herramienta 'gemini' a la barra de selección de texto.
   - Crea `readest/apps/readest-app/src/app/reader/components/annotator/GeminiReadingPopup.tsx` para mostrar el popover in-situ con opciones de simplificar, ver contexto y guardar nota.
   - Enlaza el componente dentro de `AnnotationPopup.tsx`.

4. CONFIGURACIÓN:
   - Añade el panel de configuración de Gemini en `AISettings.tsx`.

CRITERIOS DE ÉXITO:
- `cd readest/apps/readest-app && npx tsc --noEmit` retorna 0 errores.
- La barra de selección de texto ofrece la opción Gemini en popover y en handoff externo.
</TASK>
```
