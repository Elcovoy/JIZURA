# Camino MusicCue ↔ JIZURA Bridge v1

Adaptador externo en integrations/musicue-bridge. NO modifica el motor, la interfaz ni el analizador original de JIZURA.

## Entrada MusicCue
- JSON esquema camino.music.analysis.draft.v2.
- timeline_alignment: canonical_timebase=clean_audio, sequence_status=verified, sequence_available=true, sequence_offset_sec, sequence_duration_sec, grid_bpm.
- beats[].t en segundos de audio limpio.
- energy_curves: rms_fast, rms_drums, rms_bass, rms_vocals, rms_other, cada uno con values y hop_sec.
- events.drum_hits e instrument_onsets son opcionales.
- Proyecto JIZURA con letras y lineTimes en segundos DE SECUENCIA (no en tiempo de audio limpio).

## API de JavaScript
- inspect(musicue): valida y resume el esquema y el tiempo de referencia.
- buildAudioLike(musicue, options): devuelve beats[], energy Float32Array, energyRate, duration. Nunca devuelve audio buffer.
- prepareProject(project, musicue, options): clona proyecto, adopta BPM aprobado, deshabilita snap y typeset en la copia si se prioriza timing vocal.
- makePlan(J, project, musicue, options): llama a J.plan preparado. No sobrescribe J.plan ni J.analyzeAudio.

Ejemplo de host futuro:

    const plan = CaminoMusicueBridge.makePlan(J, project, musicueJSON, {
      defaultSource: 'general',
      defaultMode: 'energy',
      regions: [
        {start: 48, end: 56, source: 'bass', mode: 'both', attackBoost: 0.4},
        {start: 56, end: 63, source: 'vocals', mode: 'energy'}
      ]
    });

Cargar el script musicue-bridge.js una vez DESPUÉS de que JIZURA esté disponible. En Node se puede usar require('./musicue-bridge.js').

## Opciones
- defaultSource: general (predeterminado), bass, drums, vocals, other.
- defaultMode: energy (predeterminado), onsets, both.
- regions: intervalos [start, end) NO SUPERPUESTOS en segundos de secuencia.
- attackBoost: proporción de energía de ataques para modo both, entre 0 y 1; por defecto 0.35.
- snapCuts: true solo si el host desea deliberadamente alinear cortes internos al beat.
- lineTimes: tiempos explícitos de inicio de líneas de letras, en segundos de secuencia.
- preserveExactTiming: true por defecto, deshabilita anticipación tipográfica de 0.2 s solo en copia temporal del proyecto.

## Tiempo, música y prioridad
- El reloj maestro es la SECUENCIA; no el audio limpio. El offset no se hardcodea y se toma de timeline_alignment.sequence_offset_sec.
- Música limpia para análisis: beats y energía se trasladan por el mismo offset; preludio sin música tiene energía cero.
- La curva seleccionada se normaliza por su percentil 95 a rango 0..1. JIZURA recibe energyRate correcto aunque sea 25 Hz, no 50 Hz.
- Las regiones pueden dar predominio al bajo, batería, voces u otros. 'Guitarra' independiente NO está garantizada: el esquema tiene el stem 'other'.
- En modo onsets los ataques proceden de la pista seleccionada; en modo both se mezclan con su energía. NO se sustituyen los beats del compás.
- El puente tiene prioridad únicamente cuando el host llama makePlan; no modifica los botones del editor JIZURA.
- El proyecto original, el detector de audio y el renderizador permanecen sin modificaciones.

## Alcance y límites de esta versión
- No crea botón en MusicCue, no edita Camino Lyrics y no modifica src/ de JIZURA.
- No traduce por sí solo palabras a cortes, no cambia el editor de reflujo y no hace render/exportación de video.
- Un futuro host debe introducir los tiempos vocales ya en el reloj de la secuencia.
- No todos los efectos JIZURA consultan env.energy; algunos solo consultan el tiempo, otros env.beat.
- Su funcionamiento JS está probado sobre fixtures de contrato; la reproducción visual dentro del JIZURA completo queda pendiente de probar.
- No se sube el JSON real de MusicCue al repositorio.

## Tests sin dependencias

    node integrations/musicue-bridge/musicue-bridge.test.cjs

Referencias del motor intactas: src/08_planner.js, src/09_render.js, src/10_audio.js y src/12_ui.js.
