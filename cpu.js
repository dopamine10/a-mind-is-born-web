// MOS 6510/6502 CPU core — full legal set + the undocumented (illegal) opcodes
// that "A Mind Is Born" depends on (LAX, ALR/asr, SRE, AXS/sbx, ...).
// Bus access is injected: read(addr)->byte, write(addr,byte).

const N=0x80, V=0x40, B=0x10, D=0x08, I=0x04, Z=0x02, C=0x01;

export class CPU {
  constructor(read, write) {
    this.read = read; this.write = write;
    this.a=0; this.x=0; this.y=0; this.s=0xfd; this.pc=0;
    // flags as a byte (bit5 always set)
    this.p = 0x24;
    this.cycles = 0;
    this.halted = false;
  }
  reset() {
    this.pc = this.read(0xfffc) | (this.read(0xfffd)<<8);
    this.s = 0xfd; this.p = 0x24; this.halted=false;
  }
  // flag helpers
  setZN(v){ v&=0xff; this.p = (this.p & ~(Z|N)) | (v===0?Z:0) | (v&N); }
  getflag(f){ return (this.p&f)!==0; }
  setflag(f,on){ this.p = on ? (this.p|f) : (this.p&~f); }

  push(v){ this.write(0x100|this.s, v&0xff); this.s=(this.s-1)&0xff; }
  pop(){ this.s=(this.s+1)&0xff; return this.read(0x100|this.s); }

  irq(){
    if (this.getflag(I)) return false;
    this.push((this.pc>>8)&0xff); this.push(this.pc&0xff);
    this.push((this.p & ~B) | 0x20);
    this.setflag(I,true);
    this.pc = this.read(0xfffe) | (this.read(0xffff)<<8);
    this.cycles += 7;
    return true;
  }
  nmi(){
    this.push((this.pc>>8)&0xff); this.push(this.pc&0xff);
    this.push((this.p & ~B) | 0x20);
    this.setflag(I,true);
    this.pc = this.read(0xfffa) | (this.read(0xfffb)<<8);
    this.cycles += 7;
  }

  rd8(){ const v=this.read(this.pc); this.pc=(this.pc+1)&0xffff; return v; }
  rd16(){ const lo=this.rd8(); const hi=this.rd8(); return lo|(hi<<8); }

  // addressing -> effective address
  a_imm(){ const a=this.pc; this.pc=(this.pc+1)&0xffff; return a; }
  a_zp(){ return this.rd8(); }
  a_zpx(){ return (this.rd8()+this.x)&0xff; }
  a_zpy(){ return (this.rd8()+this.y)&0xff; }
  a_abs(){ return this.rd16(); }
  a_abx(){ return (this.rd16()+this.x)&0xffff; }
  a_aby(){ return (this.rd16()+this.y)&0xffff; }
  a_izx(){ const z=(this.rd8()+this.x)&0xff; return this.read(z)|(this.read((z+1)&0xff)<<8); }
  a_izy(){ const z=this.rd8(); return ((this.read(z)|(this.read((z+1)&0xff)<<8))+this.y)&0xffff; }
  a_ind(){ const p=this.rd16(); const lo=this.read(p); const hi=this.read((p&0xff00)|((p+1)&0xff)); return lo|(hi<<8); } // 6502 page-wrap bug

  branch(cond){ const off=this.rd8(); if(cond){ const t=(this.pc + ((off<128)?off:off-256))&0xffff; this.cycles += ((t&0xff00)!==(this.pc&0xff00))?2:1; this.pc=t; } }

  // ALU helpers
  _adc(v){
    const a=this.a;
    if (this.getflag(D)) {
      // BCD — not used by this demo, but implement for completeness
      let lo=(a&0x0f)+(v&0x0f)+(this.getflag(C)?1:0);
      let hi=(a>>4)+(v>>4);
      if(lo>9){lo+=6;hi++;}
      this.setflag(V, (~(a^v)&(a^(hi<<4))&0x80)!==0);
      if(hi>9)hi+=6;
      this.setflag(C,hi>15);
      const r=((hi<<4)|(lo&0x0f))&0xff;
      this.setZN(r); this.a=r;
    } else {
      const sum=a+v+(this.getflag(C)?1:0);
      this.setflag(C,sum>0xff);
      this.setflag(V, (~(a^v)&(a^sum)&0x80)!==0);
      this.a=sum&0xff; this.setZN(this.a);
    }
  }
  _sbc(v){ this._adc(v^0xff); }
  _cmp(reg,v){ const r=reg-v; this.setflag(C,reg>=v); this.setZN(r&0xff); }

  step(){
    if (this.halted) { this.cycles+=1; return 1; }
    const start=this.cycles;
    const op=this.rd8();
    const R=this.read.bind(this), W=this.write.bind(this);
    let a; // effective addr
    switch(op){
      // ---- ORA ----
      case 0x09: this.a|=R(this.a_imm()); this.setZN(this.a); this.cycles+=2; break;
      case 0x05: this.a|=R(this.a_zp()); this.setZN(this.a); this.cycles+=3; break;
      case 0x15: this.a|=R(this.a_zpx()); this.setZN(this.a); this.cycles+=4; break;
      case 0x0d: this.a|=R(this.a_abs()); this.setZN(this.a); this.cycles+=4; break;
      case 0x1d: this.a|=R(this.a_abx()); this.setZN(this.a); this.cycles+=4; break;
      case 0x19: this.a|=R(this.a_aby()); this.setZN(this.a); this.cycles+=4; break;
      case 0x01: this.a|=R(this.a_izx()); this.setZN(this.a); this.cycles+=6; break;
      case 0x11: this.a|=R(this.a_izy()); this.setZN(this.a); this.cycles+=5; break;
      // ---- AND ----
      case 0x29: this.a&=R(this.a_imm()); this.setZN(this.a); this.cycles+=2; break;
      case 0x25: this.a&=R(this.a_zp()); this.setZN(this.a); this.cycles+=3; break;
      case 0x35: this.a&=R(this.a_zpx()); this.setZN(this.a); this.cycles+=4; break;
      case 0x2d: this.a&=R(this.a_abs()); this.setZN(this.a); this.cycles+=4; break;
      case 0x3d: this.a&=R(this.a_abx()); this.setZN(this.a); this.cycles+=4; break;
      case 0x39: this.a&=R(this.a_aby()); this.setZN(this.a); this.cycles+=4; break;
      case 0x21: this.a&=R(this.a_izx()); this.setZN(this.a); this.cycles+=6; break;
      case 0x31: this.a&=R(this.a_izy()); this.setZN(this.a); this.cycles+=5; break;
      // ---- EOR ----
      case 0x49: this.a^=R(this.a_imm()); this.setZN(this.a); this.cycles+=2; break;
      case 0x45: this.a^=R(this.a_zp()); this.setZN(this.a); this.cycles+=3; break;
      case 0x55: this.a^=R(this.a_zpx()); this.setZN(this.a); this.cycles+=4; break;
      case 0x4d: this.a^=R(this.a_abs()); this.setZN(this.a); this.cycles+=4; break;
      case 0x5d: this.a^=R(this.a_abx()); this.setZN(this.a); this.cycles+=4; break;
      case 0x59: this.a^=R(this.a_aby()); this.setZN(this.a); this.cycles+=4; break;
      case 0x41: this.a^=R(this.a_izx()); this.setZN(this.a); this.cycles+=6; break;
      case 0x51: this.a^=R(this.a_izy()); this.setZN(this.a); this.cycles+=5; break;
      // ---- ADC ----
      case 0x69: this._adc(R(this.a_imm())); this.cycles+=2; break;
      case 0x65: this._adc(R(this.a_zp())); this.cycles+=3; break;
      case 0x75: this._adc(R(this.a_zpx())); this.cycles+=4; break;
      case 0x6d: this._adc(R(this.a_abs())); this.cycles+=4; break;
      case 0x7d: this._adc(R(this.a_abx())); this.cycles+=4; break;
      case 0x79: this._adc(R(this.a_aby())); this.cycles+=4; break;
      case 0x61: this._adc(R(this.a_izx())); this.cycles+=6; break;
      case 0x71: this._adc(R(this.a_izy())); this.cycles+=5; break;
      // ---- SBC ----
      case 0xe9: case 0xeb: this._sbc(R(this.a_imm())); this.cycles+=2; break;
      case 0xe5: this._sbc(R(this.a_zp())); this.cycles+=3; break;
      case 0xf5: this._sbc(R(this.a_zpx())); this.cycles+=4; break;
      case 0xed: this._sbc(R(this.a_abs())); this.cycles+=4; break;
      case 0xfd: this._sbc(R(this.a_abx())); this.cycles+=4; break;
      case 0xf9: this._sbc(R(this.a_aby())); this.cycles+=4; break;
      case 0xe1: this._sbc(R(this.a_izx())); this.cycles+=6; break;
      case 0xf1: this._sbc(R(this.a_izy())); this.cycles+=5; break;
      // ---- CMP / CPX / CPY ----
      case 0xc9: this._cmp(this.a,R(this.a_imm())); this.cycles+=2; break;
      case 0xc5: this._cmp(this.a,R(this.a_zp())); this.cycles+=3; break;
      case 0xd5: this._cmp(this.a,R(this.a_zpx())); this.cycles+=4; break;
      case 0xcd: this._cmp(this.a,R(this.a_abs())); this.cycles+=4; break;
      case 0xdd: this._cmp(this.a,R(this.a_abx())); this.cycles+=4; break;
      case 0xd9: this._cmp(this.a,R(this.a_aby())); this.cycles+=4; break;
      case 0xc1: this._cmp(this.a,R(this.a_izx())); this.cycles+=6; break;
      case 0xd1: this._cmp(this.a,R(this.a_izy())); this.cycles+=5; break;
      case 0xe0: this._cmp(this.x,R(this.a_imm())); this.cycles+=2; break;
      case 0xe4: this._cmp(this.x,R(this.a_zp())); this.cycles+=3; break;
      case 0xec: this._cmp(this.x,R(this.a_abs())); this.cycles+=4; break;
      case 0xc0: this._cmp(this.y,R(this.a_imm())); this.cycles+=2; break;
      case 0xc4: this._cmp(this.y,R(this.a_zp())); this.cycles+=3; break;
      case 0xcc: this._cmp(this.y,R(this.a_abs())); this.cycles+=4; break;
      // ---- LDA ----
      case 0xa9: this.a=R(this.a_imm()); this.setZN(this.a); this.cycles+=2; break;
      case 0xa5: this.a=R(this.a_zp()); this.setZN(this.a); this.cycles+=3; break;
      case 0xb5: this.a=R(this.a_zpx()); this.setZN(this.a); this.cycles+=4; break;
      case 0xad: this.a=R(this.a_abs()); this.setZN(this.a); this.cycles+=4; break;
      case 0xbd: this.a=R(this.a_abx()); this.setZN(this.a); this.cycles+=4; break;
      case 0xb9: this.a=R(this.a_aby()); this.setZN(this.a); this.cycles+=4; break;
      case 0xa1: this.a=R(this.a_izx()); this.setZN(this.a); this.cycles+=6; break;
      case 0xb1: this.a=R(this.a_izy()); this.setZN(this.a); this.cycles+=5; break;
      // ---- LDX ----
      case 0xa2: this.x=R(this.a_imm()); this.setZN(this.x); this.cycles+=2; break;
      case 0xa6: this.x=R(this.a_zp()); this.setZN(this.x); this.cycles+=3; break;
      case 0xb6: this.x=R(this.a_zpy()); this.setZN(this.x); this.cycles+=4; break;
      case 0xae: this.x=R(this.a_abs()); this.setZN(this.x); this.cycles+=4; break;
      case 0xbe: this.x=R(this.a_aby()); this.setZN(this.x); this.cycles+=4; break;
      // ---- LDY ----
      case 0xa0: this.y=R(this.a_imm()); this.setZN(this.y); this.cycles+=2; break;
      case 0xa4: this.y=R(this.a_zp()); this.setZN(this.y); this.cycles+=3; break;
      case 0xb4: this.y=R(this.a_zpx()); this.setZN(this.y); this.cycles+=4; break;
      case 0xac: this.y=R(this.a_abs()); this.setZN(this.y); this.cycles+=4; break;
      case 0xbc: this.y=R(this.a_abx()); this.setZN(this.y); this.cycles+=4; break;
      // ---- STA ----
      case 0x85: W(this.a_zp(),this.a); this.cycles+=3; break;
      case 0x95: W(this.a_zpx(),this.a); this.cycles+=4; break;
      case 0x8d: W(this.a_abs(),this.a); this.cycles+=4; break;
      case 0x9d: W(this.a_abx(),this.a); this.cycles+=5; break;
      case 0x99: W(this.a_aby(),this.a); this.cycles+=5; break;
      case 0x81: W(this.a_izx(),this.a); this.cycles+=6; break;
      case 0x91: W(this.a_izy(),this.a); this.cycles+=6; break;
      // ---- STX / STY ----
      case 0x86: W(this.a_zp(),this.x); this.cycles+=3; break;
      case 0x96: W(this.a_zpy(),this.x); this.cycles+=4; break;
      case 0x8e: W(this.a_abs(),this.x); this.cycles+=4; break;
      case 0x84: W(this.a_zp(),this.y); this.cycles+=3; break;
      case 0x94: W(this.a_zpx(),this.y); this.cycles+=4; break;
      case 0x8c: W(this.a_abs(),this.y); this.cycles+=4; break;
      // ---- transfers ----
      case 0xaa: this.x=this.a; this.setZN(this.x); this.cycles+=2; break; // TAX
      case 0xa8: this.y=this.a; this.setZN(this.y); this.cycles+=2; break; // TAY
      case 0x8a: this.a=this.x; this.setZN(this.a); this.cycles+=2; break; // TXA
      case 0x98: this.a=this.y; this.setZN(this.a); this.cycles+=2; break; // TYA
      case 0xba: this.x=this.s; this.setZN(this.x); this.cycles+=2; break; // TSX
      case 0x9a: this.s=this.x; this.cycles+=2; break;                     // TXS
      // ---- inc/dec ----
      case 0xe8: this.x=(this.x+1)&0xff; this.setZN(this.x); this.cycles+=2; break; // INX
      case 0xc8: this.y=(this.y+1)&0xff; this.setZN(this.y); this.cycles+=2; break; // INY
      case 0xca: this.x=(this.x-1)&0xff; this.setZN(this.x); this.cycles+=2; break; // DEX
      case 0x88: this.y=(this.y-1)&0xff; this.setZN(this.y); this.cycles+=2; break; // DEY
      case 0xe6: a=this.a_zp(); { let v=(R(a)+1)&0xff; W(a,v); this.setZN(v); } this.cycles+=5; break;
      case 0xf6: a=this.a_zpx(); { let v=(R(a)+1)&0xff; W(a,v); this.setZN(v); } this.cycles+=6; break;
      case 0xee: a=this.a_abs(); { let v=(R(a)+1)&0xff; W(a,v); this.setZN(v); } this.cycles+=6; break;
      case 0xfe: a=this.a_abx(); { let v=(R(a)+1)&0xff; W(a,v); this.setZN(v); } this.cycles+=7; break;
      case 0xc6: a=this.a_zp(); { let v=(R(a)-1)&0xff; W(a,v); this.setZN(v); } this.cycles+=5; break;
      case 0xd6: a=this.a_zpx(); { let v=(R(a)-1)&0xff; W(a,v); this.setZN(v); } this.cycles+=6; break;
      case 0xce: a=this.a_abs(); { let v=(R(a)-1)&0xff; W(a,v); this.setZN(v); } this.cycles+=6; break;
      case 0xde: a=this.a_abx(); { let v=(R(a)-1)&0xff; W(a,v); this.setZN(v); } this.cycles+=7; break;
      // ---- shifts/rotates ----
      case 0x0a: this.setflag(C,(this.a&0x80)!==0); this.a=(this.a<<1)&0xff; this.setZN(this.a); this.cycles+=2; break; // ASL A
      case 0x06: a=this.a_zp(); this._asl(a); this.cycles+=5; break;
      case 0x16: a=this.a_zpx(); this._asl(a); this.cycles+=6; break;
      case 0x0e: a=this.a_abs(); this._asl(a); this.cycles+=6; break;
      case 0x1e: a=this.a_abx(); this._asl(a); this.cycles+=7; break;
      case 0x4a: this.setflag(C,(this.a&1)!==0); this.a=this.a>>1; this.setZN(this.a); this.cycles+=2; break; // LSR A
      case 0x46: a=this.a_zp(); this._lsr(a); this.cycles+=5; break;
      case 0x56: a=this.a_zpx(); this._lsr(a); this.cycles+=6; break;
      case 0x4e: a=this.a_abs(); this._lsr(a); this.cycles+=6; break;
      case 0x5e: a=this.a_abx(); this._lsr(a); this.cycles+=7; break;
      case 0x2a: { const c=this.getflag(C)?1:0; this.setflag(C,(this.a&0x80)!==0); this.a=((this.a<<1)|c)&0xff; this.setZN(this.a);} this.cycles+=2; break; // ROL A
      case 0x26: a=this.a_zp(); this._rol(a); this.cycles+=5; break;
      case 0x36: a=this.a_zpx(); this._rol(a); this.cycles+=6; break;
      case 0x2e: a=this.a_abs(); this._rol(a); this.cycles+=6; break;
      case 0x3e: a=this.a_abx(); this._rol(a); this.cycles+=7; break;
      case 0x6a: { const c=this.getflag(C)?0x80:0; this.setflag(C,(this.a&1)!==0); this.a=(this.a>>1)|c; this.setZN(this.a);} this.cycles+=2; break; // ROR A
      case 0x66: a=this.a_zp(); this._ror(a); this.cycles+=5; break;
      case 0x76: a=this.a_zpx(); this._ror(a); this.cycles+=6; break;
      case 0x6e: a=this.a_abs(); this._ror(a); this.cycles+=6; break;
      case 0x7e: a=this.a_abx(); this._ror(a); this.cycles+=7; break;
      // ---- BIT ----
      case 0x24: a=R(this.a_zp()); this.setflag(Z,(this.a&a)===0); this.setflag(N,(a&0x80)!==0); this.setflag(V,(a&0x40)!==0); this.cycles+=3; break;
      case 0x2c: a=R(this.a_abs()); this.setflag(Z,(this.a&a)===0); this.setflag(N,(a&0x80)!==0); this.setflag(V,(a&0x40)!==0); this.cycles+=4; break;
      // ---- branches ----
      case 0x10: this.cycles+=2; this.branch(!this.getflag(N)); break; // BPL
      case 0x30: this.cycles+=2; this.branch(this.getflag(N)); break;  // BMI
      case 0x50: this.cycles+=2; this.branch(!this.getflag(V)); break; // BVC
      case 0x70: this.cycles+=2; this.branch(this.getflag(V)); break;  // BVS
      case 0x90: this.cycles+=2; this.branch(!this.getflag(C)); break; // BCC
      case 0xb0: this.cycles+=2; this.branch(this.getflag(C)); break;  // BCS
      case 0xd0: this.cycles+=2; this.branch(!this.getflag(Z)); break; // BNE
      case 0xf0: this.cycles+=2; this.branch(this.getflag(Z)); break;  // BEQ
      // ---- jumps/calls ----
      case 0x4c: this.pc=this.a_abs(); this.cycles+=3; break;
      case 0x6c: this.pc=this.a_ind(); this.cycles+=5; break;
      case 0x20: { const t=this.a_abs(); const r=(this.pc-1)&0xffff; this.push((r>>8)&0xff); this.push(r&0xff); this.pc=t; } this.cycles+=6; break; // JSR
      case 0x60: { const lo=this.pop(); const hi=this.pop(); this.pc=((lo|(hi<<8))+1)&0xffff; } this.cycles+=6; break; // RTS
      case 0x40: { this.p=(this.pop()&~B)|0x20; const lo=this.pop(); const hi=this.pop(); this.pc=lo|(hi<<8); } this.cycles+=6; break; // RTI
      case 0x00: { this.pc=(this.pc+1)&0xffff; this.push((this.pc>>8)&0xff); this.push(this.pc&0xff); this.push(this.p|B|0x20); this.setflag(I,true); this.pc=R(0xfffe)|(R(0xffff)<<8);} this.cycles+=7; break; // BRK
      // ---- flags ----
      case 0x18: this.setflag(C,false); this.cycles+=2; break;
      case 0x38: this.setflag(C,true); this.cycles+=2; break;
      case 0x58: this.setflag(I,false); this.cycles+=2; break;
      case 0x78: this.setflag(I,true); this.cycles+=2; break;
      case 0xb8: this.setflag(V,false); this.cycles+=2; break;
      case 0xd8: this.setflag(D,false); this.cycles+=2; break;
      case 0xf8: this.setflag(D,true); this.cycles+=2; break;
      // ---- stack ----
      case 0x48: this.push(this.a); this.cycles+=3; break; // PHA
      case 0x68: this.a=this.pop(); this.setZN(this.a); this.cycles+=4; break; // PLA
      case 0x08: this.push(this.p|B|0x20); this.cycles+=3; break; // PHP
      case 0x28: this.p=(this.pop()&~B)|0x20; this.cycles+=4; break; // PLP
      // ---- NOPs (legal + undocumented) ----
      case 0xea: this.cycles+=2; break;
      case 0x1a: case 0x3a: case 0x5a: case 0x7a: case 0xda: case 0xfa: this.cycles+=2; break;
      case 0x80: case 0x82: case 0x89: case 0xc2: case 0xe2: this.a_imm(); this.cycles+=2; break;
      case 0x04: case 0x44: case 0x64: this.a_zp(); this.cycles+=3; break;
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xd4: case 0xf4: this.a_zpx(); this.cycles+=4; break;
      case 0x0c: this.a_abs(); this.cycles+=4; break;
      case 0x1c: case 0x3c: case 0x5c: case 0x7c: case 0xdc: case 0xfc: this.a_abx(); this.cycles+=4; break;

      // ============ UNDOCUMENTED ============
      // LAX = LDA+LDX
      case 0xab: a=R(this.a_imm()); this.a=a; this.x=a; this.setZN(a); this.cycles+=2; break; // LAX #imm (a.k.a. LXA)
      case 0xa7: a=R(this.a_zp()); this.a=a; this.x=a; this.setZN(a); this.cycles+=3; break;
      case 0xb7: a=R(this.a_zpy()); this.a=a; this.x=a; this.setZN(a); this.cycles+=4; break;
      case 0xaf: a=R(this.a_abs()); this.a=a; this.x=a; this.setZN(a); this.cycles+=4; break;
      case 0xbf: a=R(this.a_aby()); this.a=a; this.x=a; this.setZN(a); this.cycles+=4; break;
      case 0xa3: a=R(this.a_izx()); this.a=a; this.x=a; this.setZN(a); this.cycles+=6; break;
      case 0xb3: a=R(this.a_izy()); this.a=a; this.x=a; this.setZN(a); this.cycles+=5; break;
      // SAX = store A&X
      case 0x87: W(this.a_zp(), this.a&this.x); this.cycles+=3; break;
      case 0x97: W(this.a_zpy(), this.a&this.x); this.cycles+=4; break;
      case 0x8f: W(this.a_abs(), this.a&this.x); this.cycles+=4; break;
      case 0x83: W(this.a_izx(), this.a&this.x); this.cycles+=6; break;
      // ALR (asr) = AND #imm then LSR A
      case 0x4b: { this.a&=R(this.a_imm()); this.setflag(C,(this.a&1)!==0); this.a>>=1; this.setZN(this.a);} this.cycles+=2; break;
      // ANC = AND #imm, C=N
      case 0x0b: case 0x2b: { this.a&=R(this.a_imm()); this.setZN(this.a); this.setflag(C,(this.a&0x80)!==0);} this.cycles+=2; break;
      // ARR = AND #imm then ROR A (with odd flag behavior)
      case 0x6b: { this.a&=R(this.a_imm()); const c=this.getflag(C)?0x80:0; this.a=(this.a>>1)|c; this.setZN(this.a); this.setflag(C,(this.a&0x40)!==0); this.setflag(V,(((this.a>>6)^(this.a>>5))&1)!==0);} this.cycles+=2; break;
      // AXS (sbx) = X = (A&X) - imm
      case 0xcb: { const t=(this.a&this.x); const v=R(this.a_imm()); this.setflag(C,t>=v); this.x=(t-v)&0xff; this.setZN(this.x);} this.cycles+=2; break;
      // SLO = ASL mem then ORA
      case 0x07: a=this.a_zp(); this._slo(a); this.cycles+=5; break;
      case 0x17: a=this.a_zpx(); this._slo(a); this.cycles+=6; break;
      case 0x0f: a=this.a_abs(); this._slo(a); this.cycles+=6; break;
      case 0x1f: a=this.a_abx(); this._slo(a); this.cycles+=7; break;
      case 0x1b: a=this.a_aby(); this._slo(a); this.cycles+=7; break;
      case 0x03: a=this.a_izx(); this._slo(a); this.cycles+=8; break;
      case 0x13: a=this.a_izy(); this._slo(a); this.cycles+=8; break;
      // RLA = ROL mem then AND
      case 0x27: a=this.a_zp(); this._rla(a); this.cycles+=5; break;
      case 0x37: a=this.a_zpx(); this._rla(a); this.cycles+=6; break;
      case 0x2f: a=this.a_abs(); this._rla(a); this.cycles+=6; break;
      case 0x3f: a=this.a_abx(); this._rla(a); this.cycles+=7; break;
      case 0x3b: a=this.a_aby(); this._rla(a); this.cycles+=7; break;
      case 0x23: a=this.a_izx(); this._rla(a); this.cycles+=8; break;
      case 0x33: a=this.a_izy(); this._rla(a); this.cycles+=8; break;
      // SRE = LSR mem then EOR
      case 0x47: a=this.a_zp(); this._sre(a); this.cycles+=5; break;
      case 0x57: a=this.a_zpx(); this._sre(a); this.cycles+=6; break;
      case 0x4f: a=this.a_abs(); this._sre(a); this.cycles+=6; break;
      case 0x5f: a=this.a_abx(); this._sre(a); this.cycles+=7; break;
      case 0x5b: a=this.a_aby(); this._sre(a); this.cycles+=7; break;
      case 0x43: a=this.a_izx(); this._sre(a); this.cycles+=8; break;
      case 0x53: a=this.a_izy(); this._sre(a); this.cycles+=8; break;
      // RRA = ROR mem then ADC
      case 0x67: a=this.a_zp(); this._rra(a); this.cycles+=5; break;
      case 0x77: a=this.a_zpx(); this._rra(a); this.cycles+=6; break;
      case 0x6f: a=this.a_abs(); this._rra(a); this.cycles+=6; break;
      case 0x7f: a=this.a_abx(); this._rra(a); this.cycles+=7; break;
      case 0x7b: a=this.a_aby(); this._rra(a); this.cycles+=7; break;
      case 0x63: a=this.a_izx(); this._rra(a); this.cycles+=8; break;
      case 0x73: a=this.a_izy(); this._rra(a); this.cycles+=8; break;
      // DCP = DEC mem then CMP
      case 0xc7: a=this.a_zp(); this._dcp(a); this.cycles+=5; break;
      case 0xd7: a=this.a_zpx(); this._dcp(a); this.cycles+=6; break;
      case 0xcf: a=this.a_abs(); this._dcp(a); this.cycles+=6; break;
      case 0xdf: a=this.a_abx(); this._dcp(a); this.cycles+=7; break;
      case 0xdb: a=this.a_aby(); this._dcp(a); this.cycles+=7; break;
      case 0xc3: a=this.a_izx(); this._dcp(a); this.cycles+=8; break;
      case 0xd3: a=this.a_izy(); this._dcp(a); this.cycles+=8; break;
      // ISC/ISB = INC mem then SBC
      case 0xe7: a=this.a_zp(); this._isc(a); this.cycles+=5; break;
      case 0xf7: a=this.a_zpx(); this._isc(a); this.cycles+=6; break;
      case 0xef: a=this.a_abs(); this._isc(a); this.cycles+=6; break;
      case 0xff: a=this.a_abx(); this._isc(a); this.cycles+=7; break;
      case 0xfb: a=this.a_aby(); this._isc(a); this.cycles+=7; break;
      case 0xe3: a=this.a_izx(); this._isc(a); this.cycles+=8; break;
      case 0xf3: a=this.a_izy(); this._isc(a); this.cycles+=8; break;
      // LAS
      case 0xbb: { a=R(this.a_aby())&this.s; this.a=a; this.x=a; this.s=a; this.setZN(a);} this.cycles+=4; break;
      // unstable stores SHA/SHX/SHY/SHS (best-effort; unused by demo)
      case 0x9f: a=this.a_aby(); W(a, this.a&this.x&(((a>>8)+1)&0xff)); this.cycles+=5; break;
      case 0x93: a=this.a_izy(); W(a, this.a&this.x&(((a>>8)+1)&0xff)); this.cycles+=6; break;
      case 0x9e: a=this.a_aby(); W(a, this.x&(((a>>8)+1)&0xff)); this.cycles+=5; break;
      case 0x9c: a=this.a_abx(); W(a, this.y&(((a>>8)+1)&0xff)); this.cycles+=5; break;
      case 0x9b: a=this.a_aby(); this.s=this.a&this.x; W(a, this.s&(((a>>8)+1)&0xff)); this.cycles+=5; break;
      case 0x8b: this.a=(this.a|0xee)&this.x&R(this.a_imm()); this.setZN(this.a); this.cycles+=2; break; // ANE (unstable)
      // JAM/KIL
      case 0x02: case 0x12: case 0x22: case 0x32: case 0x42: case 0x52:
      case 0x62: case 0x72: case 0x92: case 0xb2: case 0xd2: case 0xf2:
        this.halted=true; this.pc=(this.pc-1)&0xffff; this.cycles+=1; break;
      default:
        // should never happen — all 256 covered
        this.cycles+=2; break;
    }
    return this.cycles-start;
  }
  _asl(a){ let v=this.read(a); this.setflag(C,(v&0x80)!==0); v=(v<<1)&0xff; this.write(a,v); this.setZN(v); }
  _lsr(a){ let v=this.read(a); this.setflag(C,(v&1)!==0); v=v>>1; this.write(a,v); this.setZN(v); }
  _rol(a){ let v=this.read(a); const c=this.getflag(C)?1:0; this.setflag(C,(v&0x80)!==0); v=((v<<1)|c)&0xff; this.write(a,v); this.setZN(v); }
  _ror(a){ let v=this.read(a); const c=this.getflag(C)?0x80:0; this.setflag(C,(v&1)!==0); v=(v>>1)|c; this.write(a,v); this.setZN(v); }
  _slo(a){ this._asl(a); this.a|=this.read(a); this.setZN(this.a); }
  _rla(a){ this._rol(a); this.a&=this.read(a); this.setZN(this.a); }
  _sre(a){ this._lsr(a); this.a^=this.read(a); this.setZN(this.a); }
  _rra(a){ this._ror(a); this._adc(this.read(a)); }
  _dcp(a){ let v=(this.read(a)-1)&0xff; this.write(a,v); this._cmp(this.a,v); }
  _isc(a){ let v=(this.read(a)+1)&0xff; this.write(a,v); this._sbc(v); }
}
