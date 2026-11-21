'use strict';
const assert = require('node:assert/strict');
const bridge = require('./musicue-bridge.js');
function fixture() {
  const n = 200;
  return {
    schema:'camino.music.analysis.draft.v2', bpm:120, duration_sec:8,
    beats:Array.from({length:16},(_,i)=>({t:i*.5,bar:Math.floor(i/4)+1})),
    timeline_alignment:{canonical_timebase:'clean_audio',sequence_available:true,
      sequence_status:'verified',sequence_offset_sec:2,sequence_duration_sec:11,grid_bpm:120},
    energy_curves:Object.fromEntries(
      ['rms_fast','rms_drums','rms_bass','rms_vocals','rms_other'].map(k =>
        [k,{hop_sec:.04,values:Array.from({length:n},(_,i)=> k==='rms_bass' ? .2 + .01*(i%5) : .1)}])),
    events:{drum_hits:[{t:1,strength:1}],instrument_onsets:{bass:[{t:1,strength:1}],vocals:[],other:[]}}
  };
}
let passed=0;
function test(name,fn){try{fn();passed++;console.log('PASS',name)}catch(e){console.error('FAIL',name,e);process.exitCode=1}}
test('exposes clean -> sequence offset and tempo',()=>{
  const m=bridge.inspect(fixture());assert.equal(m.offset,2);assert.equal(m.bpm,120);assert.equal(m.sequenceDuration,11);
});
test('adds offset once to beats and preserves ordered grid',()=>{
  const a=bridge.buildAudioLike(fixture());assert.equal(a.beats[0],2);assert.equal(a.beats[1],2.5);
});
test('provides energy at native 25 Hz without audio buffer',()=>{
  const a=bridge.buildAudioLike(fixture());assert.equal(a.energyRate,25);
  assert.equal(a.energy.length,275);assert.equal(a.energy[0],0);assert.equal(a.energy[24],0);
  assert.ok(a.energy[60]>0);assert.equal(a.buffer,undefined);assert.equal(a.peaks,undefined);
});
test('instrument region wins only inside selected interval',()=>{
  const f=fixture();const a=bridge.buildAudioLike(f,{defaultSource:'drums',regions:[
    {start:3,end:4,source:'bass',mode:'energy'}]});
  assert.equal(a.energy[75]>0,true);assert.equal(a.bridgeMeta.regionCount,1);
});
test('attack mode responds at shifted bass onset',()=>{
  const f=fixture();const a=bridge.buildAudioLike(f,{defaultSource:'bass',defaultMode:'onsets'});
  assert.equal(a.energy[50],0);assert.ok(a.energy[75]>.9);assert.ok(a.energy[80]<.1);
});
test('baseline is zero before start and after clean source',()=>{
  const a=bridge.buildAudioLike(fixture());assert.equal(a.energy[25],0);assert.equal(a.energy[250],0);
});
test('manual timing takes precedence and original project stays intact',()=>{
  const f=fixture();const original={lyrics:'[00:03.00]hola',typeset:true,timing:{lineTimes:{0:3}}};
  const p=bridge.prepareProject(original,f,{lineTimes:{1:4}});
  assert.deepEqual(p.timing.lineTimes,{0:3,1:4});
  assert.equal(original.timing.lineTimes[1],undefined);assert.equal(original.typeset,true);
  assert.equal(p.typeset,false);assert.equal(p.timing.snap,false);
});
test('bridge plan calls real JIZURA plan contract without patching J',()=>{
  const f=fixture(), p={lyrics:'[00:03.00]hola',timing:{}};
  const J={plan:(project,audio)=>({project,audio})};
  const out=bridge.makePlan(J,p,f);
  assert.equal(out.audio.beats[0],2);assert.equal(out.project.timing.bpm,120);
  assert.equal(out.audio.buffer,undefined);
});
test('rejects unverified sequences and wrong timebase',()=>{
  const f=fixture();f.timeline_alignment.sequence_status='unverified';
  assert.throws(()=>bridge.buildAudioLike(f),/no verificada/);
  f.timeline_alignment.sequence_status='verified';f.timeline_alignment.canonical_timebase='sequence';
  assert.throws(()=>bridge.buildAudioLike(f),/base temporal/);
});
test('rejects invalid regions, overlap, and unsupported instruments',()=>{
  const f=fixture();
  assert.throws(()=>bridge.buildAudioLike(f,{regions:[{start:1,end:4,source:'bass'}, {start:3,end:5,source:'drums'}]}),/superpuestas/);
  assert.throws(()=>bridge.buildAudioLike(f,{regions:[{start:3,end:4,source:'guitar'}]}),/fuente inválida/);
});
console.log(passed+'/10 tests passed');
if(passed!==10)process.exitCode=1;
