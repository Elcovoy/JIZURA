/* Camino MusicCue -> JIZURA bridge v1
 * External adapter. Does NOT modify JIZURA renderer, audio analyzer or UI.
 * Browser: window.CaminoMusicueBridge
 * Node: require('./musicue-bridge.js')
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CaminoMusicueBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.1.0';
  const SOURCES = Object.freeze({
    general: 'rms_fast', drums: 'rms_drums', bass: 'rms_bass',
    vocals: 'rms_vocals', other: 'rms_other'
  });
  const MODES = ['energy', 'onsets', 'both'];
  const number = x => typeof x === 'number' && Number.isFinite(x);
  const clamp = x => Math.max(0, Math.min(1, x));
  const assert = (ok, msg) => { if (!ok) throw new Error('MusicCue Bridge: ' + msg); };
  const copy = v => JSON.parse(JSON.stringify(v));
  // Accept one MusicCue document as JSON object, JSON string or a one-document JSONL.
  // A JSONL with multiple unrelated records must be assembled upstream: no guessing.
  function parseInput(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    assert(typeof raw === 'string' && raw.trim(), 'se esperaba objeto, JSON o JSONL');
    try { const value = JSON.parse(raw); assert(value && !Array.isArray(value) && typeof value === 'object', 'JSON raíz debe ser objeto'); return value; }
    catch (err) {
      if (/MusicCue Bridge:/.test(String(err))) throw err;
      const lines = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      assert(lines.length === 1, 'JSONL debe contener exactamente un documento completo');
      try { const value = JSON.parse(lines[0]); assert(value && !Array.isArray(value) && typeof value === 'object', 'línea JSONL no es objeto'); return value; }
      catch (e) { throw new Error('MusicCue Bridge: JSON/JSONL inválido: ' + e.message); }
    }
  }
  function percentile95(values) {
    const s = values.filter(v => number(v) && v >= 0).slice().sort((a, b) => a - b);
    return s.length ? Math.max(0.000001, s[Math.min(s.length - 1, Math.floor((s.length - 1) * 0.95))]) : 1;
  }
  function inspect(input) {
    assert(input && typeof input === 'object' && !Array.isArray(input), 'se requiere un objeto JSON de MusicCue');
    assert(number(input.bpm) && input.bpm > 0, 'bpm ausente o inválido');
    assert(number(input.duration_sec) && input.duration_sec > 0, 'duration_sec inválido');
    const a = input.timeline_alignment;
    assert(a && a.sequence_available === true && a.sequence_status === 'verified', 'secuencia no verificada');
    assert(a.canonical_timebase === 'clean_audio', 'base temporal no reconocida; no desplazar dos veces');
    assert(number(a.sequence_offset_sec) && a.sequence_offset_sec >= 0, 'offset de secuencia inválido');
    const duration = a.sequence_duration_sec ?? input.sequence_reference?.sequence_duration_sec;
    assert(number(duration) && duration > 0, 'duración de secuencia ausente');
    assert(a.sequence_offset_sec + input.duration_sec <= duration + 1.0, 'offset + audio limpio excede secuencia');
    const energy = input.energy_curves;
    assert(energy && typeof energy === 'object', 'faltan curvas de energía');
    const base = energy.rms_fast;
    assert(base && number(base.hop_sec) && base.hop_sec > 0 && Array.isArray(base.values) && base.values.length > 0, 'rms_fast inválida');
    const available = [];
    for (const [source, key] of Object.entries(SOURCES)) {
      const c = energy[key];
      if (c == null) continue; // only general energy is obligatory
      assert(Array.isArray(c.values) && c.values.length > 0 && number(c.hop_sec) && c.hop_sec > 0, 'curva inválida: ' + source);
      assert(c.values.every(v => number(v) && v >= 0), 'valores RMS inválidos: ' + source);
      assert(c.values.length * c.hop_sec >= input.duration_sec - Math.max(0.2, 2 * c.hop_sec),
        'curva incompleta: ' + source);
      available.push(source);
    }
    assert(Array.isArray(input.beats) && input.beats.length > 0, 'beats ausentes');
    return {
      schema: input.schema,
      bpm: a.grid_bpm || input.bpm,
      cleanDuration: input.duration_sec,
      sequenceDuration: duration,
      offset: a.sequence_offset_sec,
      firstBeatClean: a.first_downbeat_clean_sec ?? input.beat_grid_origin_sec,
      sourceNames: available,
      hasOnsets: Object.keys(input.events?.instrument_onsets || {}),
      sequenceStatus: a.sequence_status,
      energyHz: 1 / base.hop_sec
    };
  }
  function checkedRegions(regions, duration) {
    assert(Array.isArray(regions), 'regions debe ser arreglo');
    const r = regions.map((x, i) => {
      assert(x && number(x.start) && number(x.end) && x.start >= 0 && x.end > x.start && x.end <= duration + 0.001,
        'intervalo inválido en regions[' + i + '] (tiempo DE SECUENCIA)');
      const source = x.source || 'general', mode = x.mode || 'energy';
      assert(Object.hasOwn(SOURCES, source), 'fuente inválida: ' + source);
      assert(MODES.includes(mode), 'modo inválido: ' + mode);
      const attackBoost = x.attackBoost == null ? 0.35 : x.attackBoost;
      assert(number(attackBoost) && attackBoost >= 0 && attackBoost <= 1, 'attackBoost debe estar entre 0 y 1');
      return { start:x.start, end:x.end, source, mode, attackBoost };
    }).sort((a, b) => a.start - b.start);
    for (let i = 1; i < r.length; i++)
      assert(r[i].start >= r[i - 1].end - 0.000001, 'regions superpuestas');
    return r;
  }
  function onsetList(input, source, offset) {
    let arr;
    if (source === 'drums') arr = input.events?.drum_hits;
    else if (source === 'general') {
      const combined = [...(input.events?.drum_hits || [])];
      for (const list of Object.values(input.events?.instrument_onsets || {}))
        if (Array.isArray(list)) combined.push(...list);
      arr = combined;
    }
    else arr = input.events?.instrument_onsets?.[source];
    return Array.isArray(arr)
      ? arr.filter(x => number(x.t) && number(x.strength) && x.t >= 0)
        .map(x => ({t:x.t + offset, strength:clamp(x.strength)})).sort((a,b)=>a.t-b.t)
      : [];
  }
  function normalizeCurve(input, source) {
    const c = input.energy_curves[SOURCES[source]];
    assert(c, 'la fuente seleccionada no está disponible: ' + source);
    const p95 = percentile95(c.values);
    return { values:c.values, hop:c.hop_sec, p95 };
  }
  function buildAudioLike(input, options = {}) {
    input = parseInput(input);
    const meta = inspect(input);
    const defaultSource = options.defaultSource || 'general';
    const defaultMode = options.defaultMode || 'energy';
    assert(Object.hasOwn(SOURCES, defaultSource), 'defaultSource inválido');
    assert(MODES.includes(defaultMode), 'defaultMode inválido');
    const boost = options.attackBoost == null ? 0.35 : options.attackBoost;
    assert(number(boost) && boost >= 0 && boost <= 1, 'attackBoost inválido');
    const regions = checkedRegions(options.regions || [], meta.sequenceDuration);
    const hz = options.energyRate ?? meta.energyHz;
    assert(number(hz) && hz >= 1 && hz <= 200, 'energyRate fuera de rango');
    const n = Math.ceil(meta.sequenceDuration * hz);
    assert(n <= 1000000, 'demasiadas muestras');
    const energy = new Float32Array(n);
    const active = new Set([defaultSource, ...regions.map(r => r.source)]);
    const curves = Object.fromEntries([...active].map(s => [s, normalizeCurve(input,s)]));
    const onsets = Object.fromEntries([...active].map(s => [s, onsetList(input,s,meta.offset)]));
    const attacks = {};
    for (const s of active) {
      const seq = new Float32Array(n);
      for (const hit of onsets[s]) {
        const start = Math.max(0, Math.ceil(hit.t * hz));
        for (let j = start; j < Math.min(n, start + Math.ceil(0.16 * hz)); j++) {
          const dt = j / hz - hit.t;
          if (dt < -0.001) continue;
          seq[j] = Math.max(seq[j], hit.strength * Math.exp(-dt * 24));
        }
      }
      attacks[s] = seq;
    }
    const defaultRegion = {source:defaultSource, mode:defaultMode, attackBoost:boost};
    let ri = 0;
    for (let i = 0; i < n; i++) {
      const t = i / hz, cleanT = t - meta.offset;
      while (ri < regions.length && t >= regions[ri].end) ri++;
      const region = ri < regions.length && t >= regions[ri].start ? regions[ri] : defaultRegion;
      if (cleanT < 0 || cleanT >= meta.cleanDuration) continue; // guide/click preroll stays visually quiet
      const curve = curves[region.source];
      const index = Math.min(curve.values.length - 1, Math.floor(cleanT / curve.hop));
      const continuous = clamp(curve.values[index] / curve.p95);
      const attack = attacks[region.source][i];
      energy[i] = region.mode === 'onsets' ? attack
        : region.mode === 'both' ? clamp(continuous * (1 - region.attackBoost) + attack * region.attackBoost)
        : continuous;
    }
    assert(input.beats.every(x => x && number(x.t) && x.t >= 0), 'beats[].t debe ser un número de segundos de audio limpio');
    const beats = input.beats.map(x => x.t + meta.offset)
      .filter(x => x >= 0 && x < meta.sequenceDuration).sort((a,b)=>a-b);
    assert(beats.length > 0, 'no hay beats en el tiempo de secuencia');
    // STRICT JIZURA AUDIO CONTRACT: do not expose bridge metadata or extra fields.
    // The existing J.plan() consumes only beats, energy, energyRate, duration.
    return { beats, energy, energyRate: hz, duration: meta.sequenceDuration };
  }
  function prepareProject(project, input, options = {}) {
    input = parseInput(input);
    const meta = inspect(input);
    assert(project && typeof project === 'object', 'se requiere proyecto JIZURA');
    const p = copy(project);
    const bpm = input.timeline_alignment.grid_bpm || input.bpm;
    p.timing = Object.assign({}, p.timing || {}, { bpm, snap: options.snapCuts === true,
      useAudioLength: true });
    // NEVER alter project.lyrics or word/line timestamps. Existing manual lineTimes and
    // LRC markers are owned by Camino Lyrics and must be in sequence seconds.
    if (options.lineTimes) {
      assert(typeof options.lineTimes === 'object' && !Array.isArray(options.lineTimes), 'lineTimes inválido');
      for (const t of Object.values(options.lineTimes)) assert(number(t) && t >= 0 && t < meta.sequenceDuration, 'lineTimes debe estar dentro de la duración de secuencia');
      p.timing.lineTimes = Object.assign({}, p.timing.lineTimes || {}, options.lineTimes);
    }
    if (p.timing.lineTimes) for (const t of Object.values(p.timing.lineTimes))
      assert(number(t) && t >= 0 && t < meta.sequenceDuration,
        'lineTimes del proyecto fuera del reloj de la secuencia');
    // JIZURA's optional typesetting mode shifts text 0.2s before vocal timing.
    // To honor precise supplied timestamps, disable only for bridge project clone.
    if (options.preserveExactTiming !== false) p.typeset = false;
    return p;
  }
  function prepare(project, input, options = {}) {
    const parsed = parseInput(input);
    return { project: prepareProject(project, parsed, options), audioLike: buildAudioLike(parsed, options) };
  }
  function makePlan(J, project, input, options = {}) {
    assert(J && typeof J.plan === 'function', 'JIZURA J.plan no está disponible');
    const data = prepare(project, input, options);
    return J.plan(data.project, data.audioLike);
  }
  return Object.freeze({ VERSION, SOURCES, parseInput, inspect, buildAudioLike, prepareProject, prepare, makePlan });
});
