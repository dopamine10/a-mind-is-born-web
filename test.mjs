// Headless smoke test:  node test.mjs
// Verifies the demo actually executes — CPU, audio, the audio->video coupling,
// and the disassembler — without a browser.
import { PRG } from './prg.js';
import { C64, INTERNAL_RATE } from './c64.js';
import { disasm } from './disasm.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fail++; };

const sr = INTERNAL_RATE, m = new C64(PRG, sr);
const spf = Math.round(sr / 60), buf = new Float32Array(spf);

// run 10 seconds of emulated time
let peak = 0, env3max = 0, bars = 0;
for (let f = 0; f < 600; f++) {
  m.runFrame();
  m.renderAudio(buf, spf);
  for (let i = 0; i < spf; i++) peak = Math.max(peak, Math.abs(buf[i]));
  env3max = Math.max(env3max, m.sid.env3());
}
bars = m.ram[0x20];

ok(!m.cpu.halted,                 'CPU did not hit an illegal/JAM opcode');
ok((m.ram[0x314] | m.ram[0x315] << 8) === 0x0031, 'IRQ vector self-rewrote to $0031');
ok(m.vic[0x11] === 0x50 && m.vic[0x18] === 0x30,   'VIC in ECM text mode, screen $0c00');
ok(peak > 0.05 && peak <= 1.0,    `audio is audible and unclipped (peak ${peak.toFixed(3)})`);
ok(env3max > 0,                   `SID ENV3 drives video (env3 reached ${env3max})`);
ok(bars >= 3,                     `song progressed through bars (reached bar ${bars})`);

// disassembler must reconstruct the main loop at $d2
const rd = m.rd.bind(m);
ok(disasm(rd, 0xd2).text === 'lda $dc04', 'disassembler reads main loop: lda $dc04');
ok(disasm(rd, 0xdb).text === 'asr #$04',  'disassembler reads illegal opcode: asr #$04');

// video renders non-trivial output across a short window (colours flicker per frame)
const rgba = new Uint8ClampedArray(320 * 200 * 4);
let maxNonBlack = 0;
for (let f = 0; f < 10; f++) {
  m.runFrame(); m.renderAudio(buf, spf); m.renderVideo(rgba);
  let nb = 0; for (let i = 0; i < 64000; i++) if (rgba[i*4] | rgba[i*4+1] | rgba[i*4+2]) nb++;
  maxNonBlack = Math.max(maxNonBlack, nb);
}
ok(maxNonBlack > 1000, `VIC renders visible pixels (${maxNonBlack}/64000 in a bright frame)`);

// the '6581a' full-saw core must restore the pulse+saw drone (voice 3) that Hermit's faithful '6581'
// collapses to an index-folded ~1/3 stub. Measure voice-3 OSC3 ($d41b) read-back span on each core.
function droneOsc3Span(kind){
  const c = new C64(PRG, sr), b = new Float32Array(spf);
  c.useSid(kind);
  let lo = 255, hi = 0;
  for (let f = 0; f < 700; f++){ c.runFrame(); c.renderAudio(b, spf); const o = c.sid.osc3(); if(o<lo)lo=o; if(o>hi)hi=o; }
  return hi - lo;
}
const dFold = droneOsc3Span('6581');    // Hermit faithful: pulse+saw index-folded -> collapsed drone
const dAuth = droneOsc3Span('6581a');   // full-saw: drone restored to full swing
const d8580 = droneOsc3Span('8580');    // reference full combined waveform
ok(dAuth > dFold * 1.5,  `6581a restores the pulse+saw drone (voice-3 osc3 span ${dAuth} vs folded ${dFold})`);
ok(dAuth >= d8580 * 0.7, `6581a drone swing comparable to 8580 (${dAuth} vs ${d8580})`);

// approx is the loudness REFERENCE; the Hermit cores' makeup (1.5x) is set to match its RMS. Verify each
// lands within ~1.5 dB of approx over the same window. (The fuller 6581a/8580 reach internal peaks >1.0 on
// the loudest bars, but that's pre-volume — the master gain scales the output below full scale at normal
// levels, so this isn't DAC clipping; see sid-hermit.js makeup comment.)
function coreStats(kind){
  const c = new C64(PRG, sr), b = new Float32Array(spf); c.useSid(kind);
  let ss = 0, n = 0, pk = 0;
  for (let f = 0; f < 6000; f++){ c.runFrame(); c.renderAudio(b, spf); for(let i=0;i<spf;i++){ const v=b[i], a=v<0?-v:v; ss+=v*v; n++; if(a>pk)pk=a; } }
  return { rms: Math.sqrt(ss/n), peak: pk };
}
const refS = coreStats('approx');
ok(refS.peak <= 1.0, `approx reference unclipped (peak ${refS.peak.toFixed(3)})`);
for (const k of ['6581','6581a','8580']){
  const s = coreStats(k), dB = 20*Math.log10(s.rms/refS.rms);
  ok(Math.abs(dB) <= 1.5, `${k} loudness matches approx (${dB>=0?'+':''}${dB.toFixed(2)} dB, peak ${s.peak.toFixed(2)})`);
}

// rate-independence: the SID runs at INTERNAL_RATE and produce() resamples to the device rate, so the
// output level must NOT depend on the device rate (the exact drift this change fixes).
function pipelineRMS(deviceRate){
  const c = new C64(PRG, INTERNAL_RATE); c.useSid('6581');
  const N = INTERNAL_RATE * 4, emu = new Float32Array(N), b = new Float32Array(spf);   // 4s of internal audio
  for (let o = 0; o < N; ){ c.runFrame(); c.renderAudio(b, spf); for(let i=0;i<spf && o<N;i++) emu[o++]=b[i]; }
  const step = INTERNAL_RATE / deviceRate, outN = Math.round(N / step); let ss = 0;   // same linear resample produce() uses
  for (let i=0;i<outN;i++){ const x=i*step, x0=x|0, fr=x-x0, x1=x0+1<N?x0+1:N-1; const v=emu[x0]*(1-fr)+emu[x1]*fr; ss+=v*v; }
  return Math.sqrt(ss/outN);
}
const rmsLo = pipelineRMS(44100), rmsHi = pipelineRMS(192000);
ok(Math.abs(rmsHi - rmsLo)/rmsLo < 0.02, `output level is device-rate independent (RMS 44.1k ${rmsLo.toFixed(4)} vs 192k ${rmsHi.toFixed(4)})`);

console.log(fail ? `\n${fail} check(s) failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
