// Minimal C64 wired around the CPU + SID, enough to run "A Mind Is Born" byte-for-byte.
// We don't ship ROMs; the handful of KERNAL entry points the demo calls are trapped in JS.
import { CPU } from './cpu.js';
import { SID } from './sid.js';

const PAL_CLOCK = 985248;
const IRQ_PERIOD = 16421;           // KERNAL CIA Timer-A reload -> ~60 Hz tick

// C64 16-colour PAL palette (RGB), VICE "Pepto" values.
export const PALETTE = [
  [0,0,0],[255,255,255],[136,57,50],[103,182,189],
  [139,63,150],[85,160,73],[64,49,141],[191,206,114],
  [139,84,41],[87,66,0],[184,105,98],[80,80,80],
  [120,120,120],[148,224,137],[120,105,196],[159,159,159]
];

export class C64 {
  constructor(prg, sampleRate){
    this.ram = new Uint8Array(0x10000);
    this.vic = new Uint8Array(0x40);
    this.color = new Uint8Array(0x400);   // color RAM $d800 (low nibble)
    this.cia1 = new Uint8Array(0x10);
    this.sid = new SID(sampleRate);
    this.prg = prg;
    this.cpu = new CPU(this.rd.bind(this), this.wr.bind(this));
    this.sampleRate = sampleRate;
    this.cyclesPerSample = PAL_CLOCK/sampleRate;
    this.totalCycles = 0;
    this.cyclesToIRQ = IRQ_PERIOD;
    this.inIRQ = false;
    this.heat = new Float32Array(256);   // per-byte execution heat (1=just executed, decays in UI)
    this.init();
  }

  init(){
    this.ram.fill(0);
    this.vic.fill(0);
    this.color.fill(0);
    // KERNAL default state the demo relies on:
    this.ram[0x0314]=0x31; this.ram[0x0315]=0xea;   // CINV -> $EA31 (demo rewrites hi byte to $00)
    this.ram[0x0001]=0x37;                          // default banking
    // reset / irq hardware vectors (we trap execution at these addresses)
    this.ram[0xfffc]=0xe2; this.ram[0xfffd]=0xfc;   // RESET -> trap $FCE2
    this.ram[0xfffe]=0x48; this.ram[0xffff]=0xff;   // IRQ -> $FF48 (handled in JS)
    // load the .prg at its load address ($0801)
    const load = this.prg[0]|(this.prg[1]<<8);
    for(let i=2;i<this.prg.length;i++) this.ram[(load+i-2)&0xffff]=this.prg[i];
    // enter via SYS 2225 == $08B1, registers as after a cold BASIC SYS
    this.cpu.a=0; this.cpu.x=0; this.cpu.y=0; this.cpu.s=0xfd; this.cpu.p=0x24;
    this.cpu.pc=0x08b1; this.cpu.halted=false;
    this.totalCycles=0; this.cyclesToIRQ=IRQ_PERIOD; this.inIRQ=false;
    if(this.heat) this.heat.fill(0);
  }

  // ---- bus ----
  rd(addr){
    addr&=0xffff;
    if(addr>=0xd000 && addr<=0xdfff){
      if(addr<0xd400){ // VIC (mirrors every $40)
        return this.vic[(addr-0xd000)&0x3f];
      } else if(addr<0xd800){ // SID (mirrors every $20)
        return this.sid.read((addr-0xd400)&0x1f);
      } else if(addr<0xdc00){ // color RAM
        return 0xf0 | (this.color[(addr-0xd800)&0x3ff]&0x0f);
      } else if(addr<0xdd00){ // CIA1
        const r=(addr-0xdc00)&0x0f;
        if(r===0x04) return (PAL_CLOCK - (this.totalCycles % IRQ_PERIOD)) & 0xff; // free-running timer-A lo
        if(r===0x05) return ((PAL_CLOCK - (this.totalCycles % IRQ_PERIOD))>>8) & 0xff;
        return this.cia1[r];
      }
      return 0;
    }
    return this.ram[addr];
  }
  wr(addr,val){
    addr&=0xffff; val&=0xff;
    if(addr>=0xd000 && addr<=0xdfff){
      if(addr<0xd400){ this.vic[(addr-0xd000)&0x3f]=val; return; }
      if(addr<0xd800){ this.sid.write((addr-0xd400)&0x1f, val); return; }
      if(addr<0xdc00){ this.color[(addr-0xd800)&0x3ff]=val&0x0f; return; }
      if(addr<0xdd00){ this.cia1[(addr-0xdc00)&0x0f]=val; return; }
      return; // dd00/de00 ignored
    }
    this.ram[addr]=val;
  }

  // ---- KERNAL traps & IRQ ----
  kernalClearScreen(){
    // $E544: clear default screen $0400 with spaces, color RAM = current text colour ($0286)
    for(let i=0;i<1000;i++){ this.ram[0x0400+i]=0x20; this.color[i]=this.ram[0x0286]&0x0f; }
  }

  // Map a runtime execution address to a cell in the live 256-byte zero-page image
  // ($00-$FF) — where the program actually runs after the loader copies itself there.
  // The one-shot init code at $08xx maps to the same low cells it is copying into.
  addrToCell(a){
    if(a>=0 && a<=0xff) return a;
    if(a>=0x0800 && a<=0x08ff) return a&0xff;
    return -1;
  }

  // One atomic step: a single instruction, an IRQ entry, an IRQ exit, or a ROM trap.
  // Returns a small record describing what happened, for the heat map / trace view.
  stepOne(){
    const c=this.cpu;
    // service a due IRQ at the next instruction boundary (only when not already in one)
    if(!this.inIRQ && this.cyclesToIRQ<=0 && !c.getflag(0x04)){
      this.cyclesToIRQ += IRQ_PERIOD;
      c.push((c.pc>>8)&0xff); c.push(c.pc&0xff); c.push((c.p&~0x10)|0x20); c.setflag(0x04,true);
      c.push(c.a); c.push(c.x); c.push(c.y);              // KERNAL $FF48 saves A,X,Y
      c.pc = this.rd(0x0314)|(this.rd(0x0315)<<8);        // JMP ($0314)
      this.inIRQ=true;
      return {addr:-1, kind:'irq', cell:-1};
    }
    const pc=c.pc;
    if(pc===0xe544){ // KERNAL clear-screen, called once during init
      this.kernalClearScreen();
      const lo=c.pop(),hi=c.pop(); c.pc=((lo|(hi<<8))+1)&0xffff;
      this.totalCycles+=12; this.cyclesToIRQ-=12; return {addr:pc,kind:'kernal',cell:-1};
    }
    if(pc===0xea7e){ // KERNAL IRQ exit: restore Y,X,A then RTI
      c.y=c.pop(); c.x=c.pop(); c.a=c.pop();
      c.p=(c.pop()&~0x10)|0x20; const lo=c.pop(),hi=c.pop(); c.pc=lo|(hi<<8);
      this.inIRQ=false; this.totalCycles+=6; this.cyclesToIRQ-=6;
      return {addr:pc,kind:'rti',cell:-1};
    }
    if(pc===0xfce2){ this.init(); return {addr:pc,kind:'reset',cell:-1}; } // finale -> restart
    const used=c.step();
    this.totalCycles+=used; this.cyclesToIRQ-=used;
    const cell=this.addrToCell(pc);
    if(cell>=0) this.heat[cell]=1;
    return {addr:pc, kind:'op', cell, used};
  }

  // Run one ~1/60s tick: step until a full IRQ period has elapsed and any IRQ in flight finishes.
  runFrame(){
    const target=this.totalCycles+IRQ_PERIOD;
    let guard=0;
    while((this.totalCycles<target || this.inIRQ) && guard++<800000) this.stepOne();
  }

  // Generate `n` audio samples (mono, -1..1) for the current SID state.
  renderAudio(buf, n){ this.sid.generate(buf, n); }

  // ---- VIC-II extended-colour text rendering into an ImageData-sized RGBA buffer ----
  // 320x200 inner; we render the 40x25 char matrix.
  renderVideo(rgba){
    const d011=this.vic[0x11], d018=this.vic[0x18], d016=this.vic[0x16];
    const ecm=(d011&0x40)!==0, mcm=(d016&0x10)!==0;
    const screenBase=((d018>>4)&0xf)*0x400;
    const charBase=((d018>>1)&0x7)*0x800;
    const bg=[this.vic[0x21]&0xf,this.vic[0x22]&0xf,this.vic[0x23]&0xf,this.vic[0x24]&0xf];
    const W=320;
    for(let row=0; row<25; row++){
      for(let col=0; col<40; col++){
        const sc=this.ram[(screenBase+row*40+col)&0xffff];
        const fg=this.color[row*40+col]&0xf;
        let charcode=sc, bgi=0;
        if(ecm){ charcode=sc&0x3f; bgi=(sc>>6)&3; }
        const glyph=charBase+charcode*8;
        const back=bg[bgi];
        for(let py=0; py<8; py++){
          const bits=this.ram[(glyph+py)&0xffff];
          const y=row*8+py;
          let o=(y*W + col*8)*4;
          for(let px=0; px<8; px++){
            const on=(bits>>(7-px))&1;
            const ci=on?fg:back;
            const rgb=PALETTE[ci];
            rgba[o++]=rgb[0]; rgba[o++]=rgb[1]; rgba[o++]=rgb[2]; rgba[o++]=255;
          }
        }
      }
    }
  }
}

export { IRQ_PERIOD, PAL_CLOCK };
