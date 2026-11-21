'use strict';
const a = require('node:assert/strict');
const B = require('./musicue-bridge.js');
let n = 0;
function check(name, fn) {
  try { fn(); n++; console.log('PASS', name); }
  catch(e) { console.error('FAIL', name, e); process.exitCode = 1; }
}
function fixture() {
  const len = 200;
  const curve = (kind) => ({ hop_sec: 0.04,
    values: Array.from({length:len}, (_,i) => kind === 'bass' ? 0.1 + (i%8)*0.025 :
      kind === 'drums' ? 0.15 + (i%5)*0.012 : 0.12) });
  return { schema: 'camino.music.analysis.draft.v2',
    duration_sec: 8, bpm: 120, beat_grid_origin_sec: 0,
    beats: Array.from({length:16},(_,i)=>({t:i*0.5,bar:Math.floor(i/4)+1})),
    timeline_alignment: { canonical_timebase:'clean_audio', sequence_available:true,
      sequence_status:'verified', sequence_offset_sec:2,
      sequence_duration_sec:11, grid_bpm:120 },
    energy_curves: { rms_fast:curve('general'), rms_bass:curve('bass'), rms_drums:curve('drums'),
      rms_vocals:curve('vocals'), rms_other:curve('other') },
    events: { drum_hits:[{t:1,strength:0.9}],
      instrument_onsets:{ bass:[{t:1,strength:1}],vocals:[{t:1.5,strength:.5}],other:[] } }
  };
}
check('Strict native output has exactly 4 keys, never audio', () => {
  const x = B.buildAudioLike(fixture());
  a.deepEqual(Object.keys(x).sort(), ['beats','energy','energyRate','duration'].sort());
  a.equal(x.buffer,undefined); a.ok(x.energy instanceof Float32Array);
});
check('prepare supplies native project and audio-like structures only', () => {
  const p = B.prepare({lyrics:'hola', timing:{lineTimes:{0:2.5}}},fixture());
  a.deepEqual(Object.keys(p),['project','audioLike']);
  a.equal(p.project.timing.bpm,120);
  a.deepEqual(Object.keys(p.audioLike).sort(), ['beats','energy','energyRate','duration'].sort());
});
check('MusicCue JSON text accepted by public integration API', () => {
  const x = B.buildAudioLike(JSON.stringify(fixture()));
  a.equal(x.duration,11); a.equal(x.beats[0],2);
});
check('MusicCue single JSONL record accepted', () => {
  const x = B.buildAudioLike(JSON.stringify(fixture())+'\n');
  a.equal(x.beats[1],2.5);
});
check('Malformed or multi-record JSONL fails explicitly', () => {
  a.throws(()=>B.buildAudioLike('{}\n{}'),/exactamente un documento/);
});
check('Available sources reflect real MusicCue content', () => {
  const x=fixture();delete x.energy_curves.rms_bass;
  a.deepEqual(B.inspect(x).sourceNames.sort(), ['general','drums','vocals','other'].sort());
  a.equal(B.buildAudioLike(x).energyRate,25);
});
check('Selecting unavailable bass fails; general continues working',()=>{
  const x=fixture();delete x.energy_curves.rms_bass;
  a.throws(()=>B.buildAudioLike(x,{defaultSource:'bass'}),/no está disponible/);
});
check('BPM and beat interval remain unchanged by selected instrument',()=>{
  const x=fixture(),a0=B.buildAudioLike(x),a1=B.buildAudioLike(x,{defaultSource:'bass'});
  a.deepEqual(a0.beats,a1.beats);a.equal(a0.energyRate,a1.energyRate);
  a.equal(a0.duration,a1.duration);
});
check('Selecting bass changes energy only',()=>{
  const x=fixture(),a0=B.buildAudioLike(x),a1=B.buildAudioLike(x,{defaultSource:'bass'});
  a.notDeepEqual([...a0.energy.slice(70,100)],[...a1.energy.slice(70,100)]);
});
check('Bass region ends and original general signal resumes',()=>{
  const x=fixture(), general=B.buildAudioLike(x);
  const bass=B.buildAudioLike(x,{regions:[{start:4,end:5,source:'bass'}]});
  a.equal(bass.energy[60],general.energy[60]);
  a.notEqual(bass.energy[104],general.energy[104]);
  a.equal(bass.energy[150],general.energy[150]);
});
check('Onset affects energy, never changes beat times or rate',()=>{
  const f=fixture(), continuous=B.buildAudioLike(f,{defaultSource:'bass'});
  const hits=B.buildAudioLike(f,{defaultSource:'bass',defaultMode:'both',attackBoost:1});
  a.deepEqual(continuous.beats,hits.beats);
  a.equal(continuous.energyRate,hits.energyRate);
  a.ok(hits.energy[75]>.9);
});
check('Beat and attack onset are shifted exactly once to sequence',()=>{
  const f=fixture();const x=B.buildAudioLike(f,{defaultSource:'bass',defaultMode:'onsets'});
  a.equal(x.beats[0],2);a.ok(x.energy[75]>.9);a.equal(x.energy[25],0);
});
check('No energy in clean-audio preroll or after clean audio ends',()=>{
  const x=B.buildAudioLike(fixture());
  a.equal(x.energy[25],0);a.equal(x.energy[255],0);
});
check('Explicit line timing preserved and clone never changes user project',()=>{
  const p={lyrics:'hola',timing:{lineTimes:{0:2.4}},typeset:true};
  const cloned=B.prepareProject(p,fixture(),{lineTimes:{1:3.8}});
  a.deepEqual(cloned.timing.lineTimes,{0:2.4,1:3.8});
  a.deepEqual(p.timing.lineTimes,{0:2.4});a.equal(p.typeset,true);
  a.equal(cloned.typeset,false);
});
check('Invalid project line time cannot silently exceed the sequence',()=>{
  const p={lyrics:'x',timing:{lineTimes:{0:20}}};
  a.throws(()=>B.prepareProject(p,fixture()),/fuera del reloj/);
});
check('Rejects energy stem shorter than clean song',()=>{
  const f=fixture();f.energy_curves.rms_bass.values.length=10;
  a.throws(()=>B.buildAudioLike(f),/curva incompleta/);
});
check('Refuses invalid beats and unknown source names',()=>{
  const f=fixture();f.beats[1].t='wrong';
  a.throws(()=>B.buildAudioLike(f),/beats/);
  a.throws(()=>B.buildAudioLike(fixture(),{regions:[{start:3,end:4,source:'guitar'}]}),/fuente inválida/);
});
check('Priority means invoking native J.plan, never invoking its audio analyzer',()=>{
  const f=fixture(), p={lyrics:'hola'};
  const J={analyzeAudio:()=>{throw Error('AUDIO ANALYZER MUST NOT RUN')},
    plan:(project,audio)=>({project,audio})};
  const x=B.makePlan(J,p,f);
  a.equal(x.audio.beats[0],2);a.equal(x.audio.buffer,undefined);
});
check('Deterministic results without mutating MusicCue input data',()=>{
  const f=fixture(),old=JSON.stringify(f);
  const x=B.buildAudioLike(f),y=B.buildAudioLike(f);
  a.deepEqual([...x.energy],[...y.energy]);a.equal(JSON.stringify(f),old);
});
console.log(n+'/19 integration-contract tests passed');
if(n!==19)process.exitCode=1;
