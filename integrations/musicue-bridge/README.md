# Camino MusicCue → JIZURA Bridge 1.1

> Adaptador externo y aislado. **No modifica** `src/08_planner.js`, `src/09_render.js`, `src/10_audio.js`, los efectos registrados ni los controles visuales de JIZURA.

## Objetivo

Traducir N fuentes y eventos musicales de MusicCue a **exactamente cuatro campos nativos del objeto musical** que el planificador original JIZURA ya consume. MusicCue no necesita entregar ningún WAV/MP3 a JIZURA y JIZURA no recibe un nuevo tipo de señal.

| Campo nativo JIZURA | Procedencia MusicCue |
| --- | --- |
| `beats` | `beats[].t` + `timeline_alignment.sequence_offset_sec` |
| `energy` | **una** fuente seleccionada entre `rms_fast`, `rms_drums`, `rms_bass`, `rms_vocals`, `rms_other`; normalizada 0–1, opcionalmente combinada con ataques |
| `energyRate` | `1 / energy_curves.rms_fast.hop_sec`, o un valor explícito del host |
| `duration` | `timeline_alignment.sequence_duration_sec` |

Cuatro parámetros temporales existentes del **proyecto** se conservan o preparan en su ubicación nativa: `project.timing.bpm`, `project.timing.snap`, `project.timing.lineTimes` y `project.timing.useAudioLength`. El BPM aprobado procede de `timeline_alignment.grid_bpm` (en su defecto `bpm`).

Solo `energy` cambia al seleccionar un instrumento. `beats`, `energyRate` y `duration` mantienen los mismos valores. La selección de instrumento ocurre **dentro del puente**, sin pasar identificadores de stems al motor.

## Llamada del host (futuro Camino Lyrics)

```js
// Cargar previamente musicueJSON y el proyecto JIZURA desde Camino Lyrics.
// En navegador: incluir musicue-bridge.js después de cargar JIZURA.
const plan = CaminoMusicueBridge.makePlan(J, project, musicueJSON, {
  defaultSource: 'general',    // predeterminado: composición general
  defaultMode: 'energy',       // predeterminado: curva de intensidad
  regions: [
    { start: 48, end: 56, source: 'bass', mode: 'both', attackBoost: 0.35 },
    { start: 56, end: 64, source: 'drums', mode: 'energy' }
  ],
  snapCuts: false,            // preservar cortes exactos
  preserveExactTiming: true  // no anticipar letras 0.2 s
});
// El J.Renderer original dibuja el plan, sin cambios internos.
```

También puede utilizarse una integración de dos fases que mantiene las entradas separadas:

```js
const { project: preparedProject, audioLike } = CaminoMusicueBridge.prepare(project, musicueJSON, options);
const plan = J.plan(preparedProject, audioLike);
// audioLike tiene exactamente: beats, energy, energyRate, duration.
```

## API

- `parseInput(raw)`: acepta objeto JSON o texto JSON (JSONL con un único documento completo). No concatena registros JSONL independientes.
- `inspect(musicue)`: valida tiempo de secuencia, BPM, beats, curvas; lista las fuentes disponibles.
- `buildAudioLike(musicue, options)`: produce únicamente los cuatro campos musicales nativos (incluida la energía `Float32Array`).
- `prepareProject(project, musicue, options)`: clona el proyecto, prepara BPM y controles temporales **existentes**. Sin mutar datos originales.
- `prepare(project, musicue, options)`: devuelve `{ project, audioLike }`, listo para llamar `J.plan`.
- `makePlan(J, project, musicue, options)`: única llamada a `J.plan()` del motor original. No intercepta ni ejecuta el analizador `J.analyzeAudio()`.

## Opciones de control interno (no son salidas a JIZURA)

- `defaultSource`: `general`, `bass`, `drums`, `vocals`, `other`.
- `defaultMode`: `energy` (recomendado), `onsets` o `both`.
- `regions`: intervalos **sin superponer** `[start, end)` en **segundos de la secuencia**. Cada intervalo puede seleccionar un source, modo y attackBoost.
- `attackBoost`: 0..1; peso de los ataques al combinar con intensidad (`both`).
- `energyRate`: frecuencia de muestreo de salida, por defecto 25 Hz en el JSON real auditado.
- `snapCuts`: por defecto `false`, para respetar marcas temporales del host.
- `lineTimes`: tiempos de entrada por línea, en segundos de la **secuencia**.
- `preserveExactTiming`: por defecto `true`; desactiva `typeset` solamente en la copia del proyecto para evitar el adelanto de 0.2 s del motor.

**Importante:** `other` es la categoría de instrumentos restantes; el JSON analizado no tiene una pista de guitarra independiente. La interfaz de MusicCue podrá permitir seleccionar la fuente de cada composición y entregará estas opciones al puente. Aún no se ha añadido ese botón.

## Reloj maestro y validaciones

El JSON debe indicar `timeline_alignment.canonical_timebase = clean_audio`, `sequence_status = verified`, `sequence_available = true`, `sequence_offset_sec` y `sequence_duration_sec`. Las curvas y ataques están originalmente en tiempo de música limpia, el adaptador los mueve al tiempo de secuencia y deja en silencio visual el pre-roll. El desplazamiento no está codificado fijo: lo trae cada canción.

Las letras/manual `lineTimes` del host tienen que estar **ya en tiempo de secuencia**; el puente nunca les suma nuevamente el offset. Se rechazan tiempos negativos o superiores a la duración de secuencia y curvas truncadas. La base de beats conserva el mismo ritmo, independientemente del instrumento seleccionado. JIZURA no recibe el búfer de audio, sus picos de waveform ni nuevos controles gráficos.

La curva RMS se normaliza contra su percentil 95 a `0..1`. Esta operación emula el tipo de dato que espera JIZURA; no es una prueba de paridad visual perfecta con su propio detector de audio. Solo los efectos que consultan `env.energy` responderán al cambio instrumental.

## Pruebas

```bash
node integrations/musicue-bridge/musicue-bridge.test.cjs
node integrations/musicue-bridge/musicue-bridge.contract.test.cjs

# Prueba adicional usando un archivo real, sin subirlo a GitHub:
node integrations/musicue-bridge/validate-musicue.cjs '/ruta/cancion.json'
node integrations/musicue-bridge/validate-musicue.cjs '/ruta/cancion.json' --source=bass --mode=both
```

El validador devuelve un resumen sin publicar el JSON privado. GitHub Actions ejecuta automáticamente las pruebas sintéticas cuando cambia el adaptador.

## Estado y alcance

- Módulo y pruebas disponibles en rama `feature/musicue-bridge-v1`, sin fusionar con `main`.
- El planificador JIZURA original no ha sido modificado; la integración final se hace desde Camino Lyrics usando `makePlan` o `prepare`.
- **No** se ha conectado el botón de MusicCue ni se ha realizado una prueba visual completa de renderizado en navegador. Esa validación corresponde a la integración posterior.
- No se implementa una traducción exacta por palabra a efectos nuevos; solo se respeta el `lineTimes` existente compatible con JIZURA.
- El archivo musical de la biblioteca no se sube al repositorio.

## Referencias del motor original

- `src/08_planner.js` — `J.plan(project, audio)`, `plan.beats`, `plan.energy`, `plan.energyRate` y la duración.
- `src/09_render.js` — `env.beat`, `env.energy`, funciones de animación intactas.
- `src/10_audio.js` — analizador nativo disponible si JIZURA funciona independientemente.
- `src/12_ui.js` — UI original sin cambios.
