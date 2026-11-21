#!/usr/bin/env node
/* Offline MusicCue -> JIZURA bridge validation.
 * Usage:
 * node integrations/musicue-bridge/validate-musicue.cjs /path/song.json [--source=bass] [--mode=both]
 * Does not connect to audio, modify MusicCue, or emit sensitive source data.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Bridge = require('./musicue-bridge.js');
const [file, ...flags] = process.argv.slice(2);
if (!file || file === '--help' || file === '-h') {
  console.log('Uso: node validate-musicue.cjs <archivo.json|jsonl> [--source=general|bass|drums|vocals|other] [--mode=energy|onsets|both]');
  process.exit(file ? 0 : 1);
}
function flag(name, fallback) {
  const found = flags.find(x => x.startsWith('--' + name + '='));
  return found ? found.slice(name.length + 3) : fallback;
}
try {
  const json = Bridge.parseInput(fs.readFileSync(path.resolve(file), 'utf8'));
  const options = {defaultSource:flag('source','general'), defaultMode:flag('mode','energy')};
  const meta = Bridge.inspect(json);
  const audioLike = Bridge.buildAudioLike(json,options);
  const project = Bridge.prepareProject({lyrics:'Verificación de contrato', timing:{lineTimes:{0:meta.offset}}}, json);
  // Exercise the public integration call using the native J.plan(project, audio) shape;
  // do not claim a real renderer was run.
  const fakeJizura = {plan:(p,a)=>({project:p,audio:a})};
  const handed = Bridge.makePlan(fakeJizura, project, json,options);
  const expectedKeys = ['beats','duration','energy','energyRate'].sort();
  const actualKeys = Object.keys(audioLike).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) throw Error('salida no es contrato nativo JIZURA');
  if (handed.audio.beats.length !== audioLike.beats.length || handed.project.timing.bpm !== meta.bpm)
    throw Error('contrato J.plan incorrecto');
  const summary = {
    status:'OK', schema:meta.schema, version:Bridge.VERSION,
    timebase:'sequence', sequenceOffsetSec:meta.offset,
    sequenceDurationSec:meta.sequenceDuration,
    bpm:meta.bpm, beatCount:audioLike.beats.length,
    firstBeatSequenceSec:audioLike.beats[0],
    energyRateHz:audioLike.energyRate, energySamples:audioLike.energy.length,
    availableSources:meta.sourceNames,
    selectedSource:options.defaultSource, selectedMode:options.defaultMode,
    outputFields:actualKeys,
    hasAudioBuffer:!!audioLike.buffer, passedNativePlannerContract:true
  };
  console.log(JSON.stringify(summary,null,2));
} catch (e) {
  console.error('MusicCue Bridge validation FAIL:',e.message);
  process.exitCode=1;
}
