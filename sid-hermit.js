// sid-hermit.js — 6581/8580 SID synthesis adapted from jsSID by Hermit (Mihály Horváth),
// http://hermit.sidrip.com — original jsSID is released under the WTFPL ("do what the fuck you
// want with this code"). This is a faithful port of jsSID's SID-chip math into this project's
// SID interface (register write/read + generateSplit + per-voice scope taps).
//
// Why this is license-clean for an MIT project: Hermit's combined-waveform model is ALGORITHMIC
// (reverse-engineered from the SID schematic / wave-selector wiring), NOT copied from reSID's
// GPL chip-sampled lookup tables. WTFPL is permissive and GPL-free; credit retained as requested.
//
// Models both chip revisions: 6581 (original, warm/dirty, nonlinear filter) and 8580 (cleaner).

const PAL_CLOCK = 985248;

// --- combined-waveform tables: generated algorithmically (Hermit's method). Hermit's 6581 just masks
// the table index (its combined waveforms become "halved" 8580-like) — faithful to his code, but for
// pulse+saw it reads the saw at the *wrong* (low) phase exactly when the pulse gates it through, so a
// high-duty voice like this demo's drone collapses to a DC-pinned ~1/3-amplitude stub. The real 6581's
// pulse+saw is weaker and grittier than the 8580's, but a *proper* waveform. PulseSaw_6581 below models
// that with the SAME algorithm at dirtier coupling (stronger neighbour bleed + higher MOSFET threshold);
// the optional '6581a' core (combFix) uses it INSTEAD of the fold. See README "Fidelity". ---
const TriSaw = new Float64Array(4096), PulseSaw = new Float64Array(4096), PulseTriSaw = new Float64Array(4096);
const PulseSaw_6581 = new Float64Array(4096);   // 6581 pulse+saw rendered WITHOUT the index-fold (full-saw core)
function createCombinedWF(arr, bitmul, bitstrength, treshold){
  for(let i=0;i<4096;i++){
    let v=0;
    for(let j=0;j<12;j++){
      let bitlevel=0;
      for(let k=0;k<12;k++) bitlevel += (bitmul/Math.pow(bitstrength, Math.abs(k-j))) * (((i>>k)&1)-0.5);
      v += (bitlevel>=treshold) ? Math.pow(2,j) : 0;
    }
    arr[i]=v*12;
  }
}
createCombinedWF(TriSaw, 0.8, 2.4, 0.64);
createCombinedWF(PulseSaw, 1.4, 1.9, 0.68);
createCombinedWF(PulseTriSaw, 0.8, 2.5, 0.64);
// 6581: bitstrength 1.9->1.6 (more neighbour coupling = dirtier) and treshold 0.68->0.72 (weaker).
// For this demo's drone it reads the table's high extreme, so it lands ~full strength (validated);
// the dirtier params carry the 6581's grittier character across other pulse+saw content.
createCombinedWF(PulseSaw_6581, 1.4, 1.6, 0.72);

// envelope rate-counter exp prescaler table (256 entries), verbatim from jsSID
const ADSR_exptable = new Uint16Array([1,30,30,30,30,30,30,16,16,16,16,16,16,16,16,8,8,8,8,8,8,8,8,8,8,8,8,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]);

const GATE=0x01, SYNC=0x02, RING=0x04, TEST=0x08, TRI=0x10, SAW=0x20, PULSE=0x40, NOISE=0x80;
const HOLDZERO=0x10, DECAYSUSTAIN=0x40, ATTACK=0x80;
const LP=0x10, BP=0x20, HP=0x40, OFF3=0x80;

export class SIDHermit {
  constructor(sampleRate){
    this.sampleRate = sampleRate;
    this.reg = new Uint8Array(0x20);
    this.model = 6581;                 // 6581 (default, the classic sound) or 8580
    this.combFix = false;              // '6581a' full-saw core: use the un-folded pulse+saw table, not the index-fold
    this.clk = PAL_CLOCK / sampleRate;
    // Hermit's cutoff curve is tuned for ~44.1 kHz; we evaluate it at this reference rate and re-map
    // the result to the device's actual rate (this.srRatio) so the filter sounds the same everywhere.
    const REF=44100;
    this.crRef8580 = -2*Math.PI*(12500/256)/REF;
    this.crRef6581 = -2*Math.PI*(20000/256)/REF;
    this.srRatio = REF/sampleRate;
    this._cutCo=-1; this._cutoff=0.035; this._cutR=-1; this._reso=1.41;   // per-bar cutoff/reso cache
    const p0 = Math.max(this.clk, 9);
    this.ADSRperiods = [p0,32,63,95,149,220,267,313,392,977,1954,3126,3907,11720,19532,31251];
    this.ADSRstep    = [Math.ceil(p0/9),1,1,1,1,1,1,1,1,1,1,1,1,1,1,1];
    // per-voice state (3 voices)
    this.ADSRstate=[HOLDZERO,HOLDZERO,HOLDZERO];
    this.ratecnt=[0,0,0]; this.envcnt=[0,0,0]; this.expcnt=[0,0,0]; this.prevSR=[0,0,0];
    this.phaseaccu=[0,0,0]; this.prevaccu=[0,0,0];
    this.noise=[0x7FFFF8,0x7FFFF8,0x7FFFF8];
    this.prevwfout=[0,0,0]; this.prevwavdata=[0,0,0];
    this.srcMSBrise=0; this.srcMSB=0;
    this.prevlp=0; this.prevbp=0;
    this._osc3=0; this._env3=0;        // voice-3 waveform/envelope read-back ($d41b/$d41c); methods below
    this._v=[0,0,0]; this._p=[0,0,0];   // per-voice scope taps (signal, phase)
  }
  // `model` drives both the cutoff and resonance curves, so any change must invalidate their cache.
  // (Today useSid() builds a fresh instance per chip, but this keeps an in-place model swap correct too.)
  get model(){ return this._model; }
  set model(v){ this._model=v; this._cutCo=-1; this._cutR=-1; }
  write(r,val){ this.reg[r&0x1f]=val&0xff; }
  read(r){ r&=0x1f; if(r===0x1b) return this._osc3&0xff; if(r===0x1c) return this._env3&0xff; return this.reg[r]; }
  // env3()/osc3() mirror sid.js's accessor names so both SID cores share one duck-typed interface
  // (read(0x1c)/read(0x1b) works on both too). env3_8()/osc3_8() are kept for existing callers.
  env3(){ return this._env3&0xff; } osc3(){ return this._osc3&0xff; }
  env3_8(){ return this._env3&0xff; } osc3_8(){ return this._osc3&0xff; }

  // one output sample; mirrors jsSID's SID() for a single chip (num=0, base regs at $00)
  step(){
    const m=this.reg, clk=this.clk;
    let filtin=0, output=0, wfout=0;
    for(let ch=0; ch<3; ch++){
      const b=ch*7, ctrl=m[b+4], wf=ctrl&0xF0, test=ctrl&TEST, SR=m[b+6];
      const prevgate=this.ADSRstate[ch]&GATE;
      let tmp=0, step, period;
      // ADSR gate edge
      if(prevgate !== (ctrl&GATE)){
        if(prevgate) this.ADSRstate[ch] &= 0xFF-(GATE|ATTACK|DECAYSUSTAIN);
        else { this.ADSRstate[ch]=(GATE|ATTACK|DECAYSUSTAIN); if((SR&0xF)>(this.prevSR[ch]&0xF)) tmp=1; }
      }
      this.prevSR[ch]=SR;
      this.ratecnt[ch]+=clk; if(this.ratecnt[ch]>=0x8000) this.ratecnt[ch]-=0x8000;
      if(this.ADSRstate[ch]&ATTACK){ step=m[b+5]>>4; period=this.ADSRperiods[step]; }
      else if(this.ADSRstate[ch]&DECAYSUSTAIN){ step=m[b+5]&0xF; period=this.ADSRperiods[step]; }
      else { step=SR&0xF; period=this.ADSRperiods[step]; }
      step=this.ADSRstep[step];
      if(this.ratecnt[ch]>=period && this.ratecnt[ch]<period+clk && tmp===0){
        this.ratecnt[ch]-=period;
        if((this.ADSRstate[ch]&ATTACK) || ++this.expcnt[ch]===ADSR_exptable[this.envcnt[ch]]){
          if(!(this.ADSRstate[ch]&HOLDZERO)){
            if(this.ADSRstate[ch]&ATTACK){
              this.envcnt[ch]+=step; if(this.envcnt[ch]>=0xFF){ this.envcnt[ch]=0xFF; this.ADSRstate[ch]&=0xFF-ATTACK; }
            } else if(!(this.ADSRstate[ch]&DECAYSUSTAIN) || this.envcnt[ch]>(SR>>4)+(SR&0xF0)){
              this.envcnt[ch]-=step; if(this.envcnt[ch]<=0 && this.envcnt[ch]+step!==0){ this.envcnt[ch]=0; this.ADSRstate[ch]|=HOLDZERO; }
            }
          }
          this.expcnt[ch]=0;
        }
      }
      this.envcnt[ch]&=0xFF;
      // waveform phase accumulator + sync
      const accuadd=(m[b]+m[b+1]*256)*clk;
      if(test || ((ctrl&SYNC) && this.srcMSBrise)) this.phaseaccu[ch]=0;
      else { this.phaseaccu[ch]+=accuadd; if(this.phaseaccu[ch]>0xFFFFFF) this.phaseaccu[ch]-=0x1000000; }
      const MSB=this.phaseaccu[ch]&0x800000;
      this.srcMSBrise=(MSB>(this.prevaccu[ch]&0x800000))?1:0;
      // waveform selector
      if(wf&NOISE){
        let t=this.noise[ch];
        if(((this.phaseaccu[ch]&0x100000)!==(this.prevaccu[ch]&0x100000)) || accuadd>=0x100000){
          const s=(t&0x400000)^((t&0x20000)<<5);
          t=((t<<1)+((s>0||test)?1:0))&0x7FFFFF; this.noise[ch]=t;
        }
        wfout=(wf&0x70)?0:((t&0x100000)>>5)+((t&0x40000)>>4)+((t&0x4000)>>1)+((t&0x800)<<1)+((t&0x200)<<2)+((t&0x20)<<5)+((t&0x04)<<7)+((t&0x01)<<8);
      } else if(wf&PULSE){
        let pw=(m[b+2]+(m[b+3]&0xF)*256)*16;
        tmp=accuadd>>9; if(0<pw && pw<tmp) pw=tmp; tmp^=0xFFFF; if(pw>tmp) pw=tmp; tmp=this.phaseaccu[ch]>>8;
        if(wf===PULSE){
          step=256/(accuadd>>16);
          if(test) wfout=0xFFFF;
          else if(tmp<pw){ let lim=(0xFFFF-pw)*step; if(lim>0xFFFF)lim=0xFFFF; wfout=lim-(pw-tmp)*step; if(wfout<0)wfout=0; }
          else { let lim=pw*step; if(lim>0xFFFF)lim=0xFFFF; wfout=(0xFFFF-tmp)*step-lim; if(wfout>=0)wfout=0xFFFF; wfout&=0xFFFF; }
        } else {
          wfout=(tmp>=pw||test)?0xFFFF:0;
          if(wf&TRI){
            if(wf&SAW) wfout=wfout?this._comb(ch,PulseTriSaw,tmp>>4,1):0;
            else { let t2=this.phaseaccu[ch]^((ctrl&RING)?this.srcMSB:0); wfout=wfout?this._comb(ch,PulseSaw,(t2^(t2&0x800000?0xFFFFFF:0))>>11,0):0; }
          } else if(wf&SAW) wfout=wfout?this._comb(ch,PulseSaw,tmp>>4,1):0;
        }
      } else if(wf&SAW){
        wfout=this.phaseaccu[ch]>>8;
        if(wf&TRI) wfout=this._comb(ch,TriSaw,wfout>>4,1);
        else { step=accuadd/0x1200000; wfout+=wfout*step; if(wfout>0xFFFF) wfout=0xFFFF-(wfout-0x10000)/step; }
      } else if(wf&TRI){
        let t2=this.phaseaccu[ch]^((ctrl&RING)?this.srcMSB:0);
        wfout=(t2^(t2&0x800000?0xFFFFFF:0))>>7;
      }
      if(wf) this.prevwfout[ch]=wfout; else wfout=this.prevwfout[ch];
      this.prevaccu[ch]=this.phaseaccu[ch]; this.srcMSB=MSB;
      // per-voice scope tap (pre-filter), normalised ~ -1..1
      this._v[ch]=((wfout-0x8000)*(this.envcnt[ch]/256))/32768;
      this._p[ch]=this.phaseaccu[ch]/0x1000000;
      // route to filter or straight to output
      if(m[0x17] & (1<<ch)) filtin += (wfout-0x8000)*(this.envcnt[ch]/256);
      else if(ch!==2 || !(m[0x18]&OFF3)) output += (wfout-0x8000)*(this.envcnt[ch]/256);
    }
    // OSC3 / ENV3 read-back from voice 3 (the demo reads $d41c=ENV3 to drive its visuals). NOTE: the
    // '6581a' core changes OSC3 ($d41b, the waveform byte) for a pulse+saw voice but NOT ENV3 ($d41c,
    // the envelope) — so this demo's ENV3-driven visuals are identical; a program sampling $d41b would differ.
    this._osc3=wfout>>8; this._env3=this.envcnt[2];
    // two-integrator state-variable filter, per-model cutoff/resonance curves
    // cutoff/resonance change at most once per bar, so cache them (and the per-sample trig)
    const co=(m[0x15]&7)/8 + m[0x16] + 0.2;
    if(co!==this._cutCo){
      this._cutCo=co;
      // coefficient at the 44.1 kHz reference rate (Hermit's tuning)
      const c44 = (this.model===8580) ? 1-Math.exp(co*this.crRef8580)
                                      : (co<24 ? 0.035 : 1-1.263*Math.exp(co*this.crRef6581));
      // re-map to this device's rate, keeping the cutoff FREQUENCY constant:
      //   c44 = 2·sin(π·fc/REF)  ->  c = 2·sin((REF/sr)·asin(c44/2))
      // This stays positive at any sample rate (the old direct formula went negative at 96/192 kHz
      // and blew the filter up to NaN).
      let c = 2*Math.sin(this.srRatio * Math.asin(c44/2));
      if(c<0) c=0; else if(c>0.96) c=0.96;   // safety (only bites for sample rates below 44.1 kHz)
      this._cutoff=c;
    }
    const cutoff=this._cutoff;
    if(m[0x17]!==this._cutR){
      this._cutR=m[0x17];
      this._reso = (this.model===8580) ? Math.pow(2,((4-(m[0x17]>>4))/8)) : ((m[0x17]>0x5F)?8/(m[0x17]>>4):1.41);
    }
    const reso=this._reso;
    let t=filtin + this.prevbp*reso + this.prevlp;
    if(m[0x18]&HP) output-=t;
    t=this.prevbp - t*cutoff; this.prevbp=t;
    if(m[0x18]&BP) output-=t;
    t=this.prevlp + t*cutoff; this.prevlp=t;
    if(m[0x18]&LP) output+=t;
    if(!Number.isFinite(this.prevlp)||!Number.isFinite(this.prevbp)){ this.prevlp=0; this.prevbp=0; }   // never let the filter die permanently
    // Makeup gain. 'approx' (sid.js, tanh*0.6) is the loudness REFERENCE; 1.5x matches the Hermit cores'
    // RMS to it (~0.34, measured across bars 0-63 / multiple LFSR loops). The fuller 6581a/8580 reach
    // internal sample peaks >1.0 on the loudest bars (8580 ~1.24), but that's BEFORE the master volume:
    // at the default 62% the 8580 output peaks ~0.77, so it only actually clips the DAC above ~81% volume.
    return (output/(0x10000*3*16)) * (m[0x18]&0xF) * 1.5;
  }
  _comb(ch, arr, index, differ6581){
    if(differ6581 && this.model===6581){
      // full-saw 6581: read the un-folded pulse+saw table at the true phase; otherwise Hermit's coarse fold.
      // (saw+tri / pulse+saw+tri keep the fold — those genuinely ARE near-useless on a real 6581.)
      if(this.combFix && arr===PulseSaw) arr=PulseSaw_6581;
      else index&=0x7FF;
    }
    const w=(arr[index]+this.prevwavdata[ch])/2; this.prevwavdata[ch]=arr[index]; return w;
  }
  generate(buf,n){ for(let i=0;i<n;i++) buf[i]=this.step(); }
  generateSplit(mix, vb, n, ph){
    const a=vb[0],b=vb[1],c=vb[2], p0=ph&&ph[0],p1=ph&&ph[1],p2=ph&&ph[2];
    for(let i=0;i<n;i++){
      mix[i]=this.step();
      a[i]=this._v[0]; b[i]=this._v[1]; c[i]=this._v[2];
      if(ph){ p0[i]=this._p[0]; p1[i]=this._p[1]; p2[i]=this._p[2]; }
    }
  }
}
