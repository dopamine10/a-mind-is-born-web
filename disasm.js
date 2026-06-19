// Tiny 6502 disassembler (legal + undocumented) for the live trace / step view.
// TABLE[opcode] = "mnemonic mode". Decoded against live memory so self-modified
// code and the famous overlapping-instruction tricks show their true form.

const T = [
// 0x
'brk imp','ora izx','jam imp','slo izx','nop zp','ora zp','asl zp','slo zp',
'php imp','ora imm','asl acc','anc imm','nop abs','ora abs','asl abs','slo abs',
// 1x
'bpl rel','ora izy','jam imp','slo izy','nop zpx','ora zpx','asl zpx','slo zpx',
'clc imp','ora aby','nop imp','slo aby','nop abx','ora abx','asl abx','slo abx',
// 2x
'jsr abs','and izx','jam imp','rla izx','bit zp','and zp','rol zp','rla zp',
'plp imp','and imm','rol acc','anc imm','bit abs','and abs','rol abs','rla abs',
// 3x
'bmi rel','and izy','jam imp','rla izy','nop zpx','and zpx','rol zpx','rla zpx',
'sec imp','and aby','nop imp','rla aby','nop abx','and abx','rol abx','rla abx',
// 4x
'rti imp','eor izx','jam imp','sre izx','nop zp','eor zp','lsr zp','sre zp',
'pha imp','eor imm','lsr acc','asr imm','jmp abs','eor abs','lsr abs','sre abs',
// 5x
'bvc rel','eor izy','jam imp','sre izy','nop zpx','eor zpx','lsr zpx','sre zpx',
'cli imp','eor aby','nop imp','sre aby','nop abx','eor abx','lsr abx','sre abx',
// 6x
'rts imp','adc izx','jam imp','rra izx','nop zp','adc zp','ror zp','rra zp',
'pla imp','adc imm','ror acc','arr imm','jmp ind','adc abs','ror abs','rra abs',
// 7x
'bvs rel','adc izy','jam imp','rra izy','nop zpx','adc zpx','ror zpx','rra zpx',
'sei imp','adc aby','nop imp','rra aby','nop abx','adc abx','ror abx','rra abx',
// 8x
'nop imm','sta izx','nop imm','sax izx','sty zp','sta zp','stx zp','sax zp',
'dey imp','nop imm','txa imp','ane imm','sty abs','sta abs','stx abs','sax abs',
// 9x
'bcc rel','sta izy','jam imp','sha izy','sty zpx','sta zpx','stx zpy','sax zpy',
'tya imp','sta aby','txs imp','shs aby','shy abx','sta abx','shx aby','sha aby',
// Ax
'ldy imm','lda izx','ldx imm','lax izx','ldy zp','lda zp','ldx zp','lax zp',
'tay imp','lda imm','tax imp','lax imm','ldy abs','lda abs','ldx abs','lax abs',
// Bx
'bcs rel','lda izy','jam imp','lax izy','ldy zpx','lda zpx','ldx zpy','lax zpy',
'clv imp','lda aby','tsx imp','las aby','ldy abx','lda abx','ldx aby','lax aby',
// Cx
'cpy imm','cmp izx','nop imm','dcp izx','cpy zp','cmp zp','dec zp','dcp zp',
'iny imp','cmp imm','dex imp','sbx imm','cpy abs','cmp abs','dec abs','dcp abs',
// Dx
'bne rel','cmp izy','jam imp','dcp izy','nop zpx','cmp zpx','dec zpx','dcp zpx',
'cld imp','cmp aby','nop imp','dcp aby','nop abx','cmp abx','dec abx','dcp abx',
// Ex
'cpx imm','sbc izx','nop imm','isb izx','cpx zp','sbc zp','inc zp','isb zp',
'inx imp','sbc imm','nop imp','sbc imm','cpx abs','sbc abs','inc abs','isb abs',
// Fx
'beq rel','sbc izy','jam imp','isb izy','nop zpx','sbc zpx','inc zpx','isb zpx',
'sed imp','sbc aby','nop imp','isb aby','nop abx','sbc abx','inc abx','isb abx',
];

const LEN = { imp:1, acc:1, imm:2, zp:2, zpx:2, zpy:2, izx:2, izy:2, rel:2, abs:3, abx:3, aby:3, ind:3 };
const hx2 = v => v.toString(16).padStart(2,'0');
const hx4 = v => v.toString(16).padStart(4,'0');

export function disasm(read, addr){
  const op = read(addr&0xffff);
  const [m, mode] = T[op].split(' ');
  const len = LEN[mode];
  const b1 = read((addr+1)&0xffff), b2 = read((addr+2)&0xffff);
  let oper='';
  switch(mode){
    case 'imp': oper=''; break;
    case 'acc': oper='a'; break;
    case 'imm': oper='#$'+hx2(b1); break;
    case 'zp':  oper='$'+hx2(b1); break;
    case 'zpx': oper='$'+hx2(b1)+',x'; break;
    case 'zpy': oper='$'+hx2(b1)+',y'; break;
    case 'izx': oper='($'+hx2(b1)+',x)'; break;
    case 'izy': oper='($'+hx2(b1)+'),y'; break;
    case 'abs': oper='$'+hx4(b1|(b2<<8)); break;
    case 'abx': oper='$'+hx4(b1|(b2<<8))+',x'; break;
    case 'aby': oper='$'+hx4(b1|(b2<<8))+',y'; break;
    case 'ind': oper='($'+hx4(b1|(b2<<8))+')'; break;
    case 'rel': oper='$'+hx4((addr+2+(b1<128?b1:b1-256))&0xffff); break;
  }
  const bytes=[op]; for(let i=1;i<len;i++) bytes.push(read((addr+i)&0xffff));
  return { text:(m+(oper?' '+oper:'')), len, bytes, mnem:m };
}

export { hx2, hx4 };
