// Headless smoke test:  node test.mjs
// Verifies the demo actually executes — CPU, audio, the audio->video coupling,
// and the disassembler — without a browser.
import { PRG } from './prg.js';
import { C64 } from './c64.js';
import { disasm } from './disasm.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fail++; };

const sr = 44100, m = new C64(PRG, sr);
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

console.log(fail ? `\n${fail} check(s) failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
