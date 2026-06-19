// MOS 6581 SID — pragmatic but musical emulation.
// 3 voices (tri/saw/pulse/noise + ADSR), a resonant multimode filter, and the
// OSC3/ENV3 read-back registers ($d41b/$d41c) that this demo uses to drive video.
// Not reSID-accurate, but reproduces the melody/bass/drums/drone faithfully.

const PAL_CLOCK = 985248;

// Canonical SID ADSR times (seconds), indexed 0..15.
const ATTACK_S = [0.002,0.008,0.016,0.024,0.038,0.056,0.068,0.080,0.100,0.250,0.500,0.800,1.000,3.000,5.000,8.000];
const DECAY_S  = [0.006,0.024,0.048,0.072,0.114,0.168,0.204,0.240,0.300,0.750,1.500,2.400,3.000,9.000,15.000,24.000];

class Voice {
  constructor(){
    this.acc=0; this.freq=0; this.pw=0; this.ctrl=0;
    this.attack=0; this.decay=0; this.sustain=0; this.release=0;
    this.env=0; this.phase='release'; // attack|decay|sustain|release
    this.noise=0x7ffff8; this.lastBit19=0; this.noiseOut=0;
    this.synced=null; this.msbRising=false; this.prevAcc=0;
  }
  gate(on){
    if(on && this.phase==='release'){ this.phase='attack'; }
    else if(!on){ this.phase='release'; }
  }
  setCtrl(v){
    const wasGate=this.ctrl&1; this.ctrl=v;
    if((v&1)&&!wasGate){ this.phase='attack'; }
    else if(!(v&1)&&wasGate){ this.phase='release'; }
  }
  clockEnv(sr){
    // per-sample envelope update
    if(this.phase==='attack'){
      this.env += 1/(ATTACK_S[this.attack]*sr);
      if(this.env>=1){ this.env=1; this.phase='decay'; }
    } else if(this.phase==='decay'){
      const s=this.sustain/15;
      this.env = s + (this.env-s)*Math.exp(-1/(DECAY_S[this.decay]*sr*0.45));
      if(this.env<s+0.0005) this.env=s;
    } else if(this.phase==='release'){
      this.env *= Math.exp(-1/(DECAY_S[this.release]*sr*0.45));
      if(this.env<0.0001) this.env=0;
    }
    // sustain phase: hold
  }
  output(cyclesPerSample){
    // advance phase accumulator
    this.prevAcc=this.acc;
    const sync=(this.ctrl&2)&&this.synced && this.msbRising; // hard sync handled by caller
    this.acc=(this.acc + this.freq*cyclesPerSample) & 0xffffff;
    this.msbRising = (!(this.prevAcc&0x800000)) && (this.acc&0x800000);
    // noise LFSR clocked on bit19 rising
    const bit19=(this.acc>>19)&1;
    if(bit19 && !this.lastBit19){
      const b=((this.noise>>22)^(this.noise>>17))&1;
      this.noise=((this.noise<<1)|b)&0x7fffff;
      this.noiseOut=(((this.noise>>20)&1)<<7)|(((this.noise>>18)&1)<<6)|(((this.noise>>14)&1)<<5)|
                    (((this.noise>>11)&1)<<4)|(((this.noise>>9)&1)<<3)|(((this.noise>>5)&1)<<2)|
                    (((this.noise>>2)&1)<<1)|((this.noise>>0)&1);
    }
    this.lastBit19=bit19;

    const wf=this.ctrl&0xf0;
    let out=0.5;
    let have=false, acc=this.acc;
    // build each active waveform as 0..1, combine by AND-ish (multiply) for combined
    let val=1.0;
    if(wf&0x10){ // triangle
      let t=(acc^((this.ctrl&0x04)&&this.synced?this.synced.acc:0))&0xffffff;
      const ph=t/0x1000000; const tri=ph<0.5?ph*2:(1-ph)*2; val*=tri; have=true;
    }
    if(wf&0x20){ const saw=acc/0x1000000; val=have?val*saw:saw; have=true; }
    if(wf&0x40){ const p=((acc>>12)>= (this.pw||1))?1:0; val=have?val*p:p; have=true; }
    if(wf&0x80){ const n=this.noiseOut/255; val=have?val*n:n; have=true; }
    if(!have) return 0; // no waveform selected -> silence (test bit etc.)
    out=val;
    return (out-0.5)*2*this.env; // -1..1 scaled by envelope
  }
  osc3_8(){ return (this.acc>>16)&0xff; }
  env3_8(){ return Math.max(0,Math.min(255,Math.round(this.env*255))); }
}

export class SID {
  constructor(sampleRate){
    this.sr=sampleRate;
    this.cyclesPerSample=PAL_CLOCK/sampleRate;
    this.reg=new Uint8Array(0x20);
    this.v=[new Voice(),new Voice(),new Voice()];
    this.v[0].synced=this.v[2]; this.v[1].synced=this.v[0]; this.v[2].synced=this.v[1];
    this._vout=new Float32Array(3);   // last per-voice output the scopes show (filtered if routed)
    // Per-voice filter state. The state-variable filter is linear, so filtering each routed
    // voice on its own and summing is identical to filtering their sum (the mix is unchanged) —
    // but it also lets each per-voice scope show the *filtered* waveform, i.e. the shaped,
    // ringing curves a real SID actually produces, instead of the raw oscillator.
    this.lp=[0,0,0]; this.bp=[0,0,0];
    this.vol=15; this.fmode=0; this.fcut=0; this.fres=0; this.froute=0;
  }
  write(r, val){
    r&=0x1f; this.reg[r]=val&0xff;
    const vi=Math.floor(r/7);
    if(r<21){
      const v=this.v[vi]; const o=r%7;
      switch(o){
        case 0: v.freq=(v.freq&0xff00)|val; break;
        case 1: v.freq=(v.freq&0x00ff)|(val<<8); break;
        case 2: v.pw=(v.pw&0xf00)|val; break;
        case 3: v.pw=(v.pw&0x0ff)|((val&0x0f)<<8); break;
        case 4: v.setCtrl(val); break;
        case 5: v.attack=(val>>4)&0xf; v.decay=val&0xf; break;
        case 6: v.sustain=(val>>4)&0xf; v.release=val&0xf; break;
      }
    } else {
      switch(r){
        case 21: this.fcut=(this.fcut&0x7f8)|(val&7); break;
        case 22: this.fcut=(this.fcut&0x007)|(val<<3); break;
        case 23: this.fres=(val>>4)&0xf; this.froute=val&0xf; break;
        case 24: this.vol=val&0xf; this.fmode=(val>>4)&0xf; break;
      }
    }
  }
  read(r){
    r&=0x1f;
    if(r===0x1b) return this.v[2].osc3_8();
    if(r===0x1c) return this.v[2].env3_8();
    return this.reg[r];
  }
  // ENV3/OSC3 helpers for the video side
  env3(){ return this.v[2].env3_8(); }
  osc3(){ return this.v[2].osc3_8(); }

  sample(){
    // cutoff: map 11-bit to frequency (approx SID 6581 curve)
    const fc=this.fcut/2048;
    let f=1.16*( 0.06 + fc*fc*0.9 ); if(f>0.95)f=0.95;
    const q=1.0 - this.fres/15*0.85; // resonance -> damping
    let mix=0;
    for(let i=0;i<3;i++){
      const v=this.v[i];
      v.clockEnv(this.sr);
      const s=v.output(this.cyclesPerSample);
      let vo;
      if(this.froute&(1<<i)){
        // resonant state-variable filter, one instance per routed voice (sums to the same mix)
        this.lp[i] += f*this.bp[i];
        const hp = s - this.lp[i] - q*this.bp[i];
        this.bp[i] += f*hp;
        vo = (this.fmode&1?this.lp[i]:0) + (this.fmode&2?this.bp[i]:0) + (this.fmode&4?hp:0);
      } else {
        vo = s;   // unrouted voice -> straight through, unfiltered
      }
      this._vout[i]=vo;          // per-voice scope shows the filtered (or, if unrouted, raw) signal
      mix += vo;
    }
    let out=mix*(this.vol/15);
    // soft clip (tanh) for analog-ish warmth instead of harsh digital clipping
    return Math.tanh(out*0.42)*0.6;
  }
  generate(buf, n){
    for(let i=0;i<n;i++) buf[i]=this.sample();
  }
  // Like generate(), but also captures each voice's raw (post-envelope, pre-filter)
  // signal into vb = [v0, v1, v2], so the UI can scope the three voices individually.
  generateSplit(mix, vb, n){
    const a=vb[0], b=vb[1], c=vb[2];
    for(let i=0;i<n;i++){
      mix[i]=this.sample();
      a[i]=this._vout[0]; b[i]=this._vout[1]; c[i]=this._vout[2];
    }
  }
}
