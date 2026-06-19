; A Mind is Born by Linus Akesson
; https://linusakesson.net/scene/a-mind-is-born/index.php
; transcribed to 64tass and further commented by J.B. Langston

; important locations after program is copied to zero page

vmptr      = $cb        ; video matrix
clock      = $13        ; global clock lsb - indicates position within bar
clock_msb  = $20        ; global clock msb - indicates bar of song
script     = $21        ; poke table
const_d3ff = $03        ; location holding constant $d3ff
const_d01c = $0f        ; location holding constant $d01c
mel_lfsr   = $14        ; melody LFSR
sid        = $0a        ; sid register shadow buffer
mod_op1    = $d5        ; first opcode that gets modified
mod_op2    = $d7        ; second opcode that gets modified
basstbl    = $f3        ; bass notes
freqtbl    = $f7        ; melody notes

        * = $0801

; basic bootstrap program

        .byte $0D,$08                   ; pointer to next line
        .byte $FF,$D3                   ; line number 54271
        .byte $9E,$32,$32,$32,$35       ; $9E=SYS + 2225 in PETSCII

; end of line/end of program markers overlap with first 3 bytes of sid table

; sid register shadow buffer; copied to sid registers at the end of every interrupt cycle
; voice 1: kick drum and bass

        .byte $00       ; $D400: voice 1 frequency lsb
        .byte $00       ; $D401: voice 1 frequency msb
        .byte $00       ; $D402: voice 1 pulse width lsb
        .byte $19       ; $D403: voice 1 pulse width msb
        .byte $41       ; $D404: voice 1 control register
        .byte $1C       ; $D405: voice 1 attack/decay
        .byte $D0       ; $D406: voice 1 sustain/release

; voice 2: melody

        .byte $00       ; $D407: voice 2 frequency lsb          $D020: border color
        .byte $DC       ; $D408: voice 2 frequency msb          $D021: background color 0
        .byte $00       ; $D409: voice 2 pulse width lsb        $D022: background color 1
        .byte $00       ; $D40A: voice 2 pulse width msb        $D023: background color 2
        .byte $11       ; $D40B: voice 2 control register       $D024: background color 3
        .byte $D0       ; $D40C: voice 2 attack/decay
        .byte $E0       ; $D40D: voice 2 sustain/release

; voice 3: drone

        .byte $0B       ; $D40E: voice 3 frequency lsb
        .byte $10       ; $D40F: voice 3 frequency msb
        .byte $33       ; $D410: voice 3 pulse width lsb
        .byte $0E       ; $D411: voice 3 pulse width msb
        .byte $61       ; $D412: voice 3 control register
        .byte $90       ; $D413: voice 3 attack/decay
        .byte $F5       ; $D414: voice 3 sustain/release

; filter

        .byte $07       ; $D415: filter cutoff lsb
        .byte $00       ; $D417: filter cutoff msb
        .byte $FF       ; $D418: filter resonance
        .byte $1F       ; $D419: filter control; $1F = low pass filter all channels and max volume

; poke table with eight entries: first byte is target address in zero-page, second byte is value to write.
; entry for bars $00-$07 overlaps with last two sid registers above; performs dummy write to $ff

        .byte $14,$41   ; bars $08-$0f: repeatedly reset LFSR seed to $41 to stutter melody
        .byte $D5,$24   ; bars $10-$17: overwrite ora opcode with bit to enable color and stop resetting LFSR
        .byte $15,$25   ; bars $18-$1f: change color to green; voice 1 waveform $25 (sounds same as $21)
        .byte $15,$53   ; bars $20-$27: change color to cyan; voice 1 waveform to $53 (hardsync)
        .byte $15,$61   ; bars $28-$2f: change color to white; voice 1 to $61 (disable hardsync)
        .byte $D5,$29   ; bars $30-$37: overwrite bit opcode with and to make visuals brighter
        .byte $1B,$0F   ; bars $38-$3f: change voice 3 pulse width to $f for brighter timbre

; interrupt handler

        inc     clock                   ; increment global clock lsb by 2
        inc     clock
        bne     noc1                    ; skip msb unless lsb wrapped to 0
        inc     clock_msb               ; increment global clock msb by 1
noc1
        lda     #$61                    ; set gate bit for drone
        sta     sid+2*7+4               ; via control reg for voice 3
        lax     clock_msb               ; load current bar # into X and A
        cpx     #$3f                    ; switch to high pass filter for final bar
        beq     highpass
        bcc     noend                   ; skip finale until after final bar
        lsr     $d011                   ; fade to black
        jmp     ($fffc)                 ; kernal reset vector
highpass
        ldy     #$6d
        sty     sid+$18                 ; switch for high pass filter 
        sty     mod_op2                 ; change ora to adc (stop blinking)
noend
        lsr                             ; calculate address into poke table:
        asr     #$1c                    ;       ((bar >> 1) and $1c) >> 1
        tay                             ; save result fo later

; beat generation

        lda     clock                   ; check what part of current bar we're in
        and     #$30                    ; only duck during third quarter of beat
        bne     noduck
        dec     sid+2*7+4               ; turn off gate bit to start release of note`
noduck
        cpx     #$2f                    ; turn bass off during bar 2f
        beq     bassoff
        bcs     nointro                 ; During bars $00-$2e we keep playing the same bass
        ldx     #2                      ; note, from offset 2 in the bass table.
nointro
        cmp     #$10                    ; turn bass off after first quarter of beat
        beq     bassoff
        txa                             ; x contains either 2 or current bar count
        and     #3                      ; mask off last two bits of bar
        tax                             
        lda     basstbl,x               ; use as index into bass note table
        sta     sid+0*7+0               ; poke into sid voice 1 frequency msb

        .byte    $2d                    ; and absolute will eat the next instr and its operand
bassoff
        lax     #0                      ; Safe when the operand is zero.
        bcs     bassdone                ; Carry will be set if we got here via bassoff.

        ; Carry was not set by cmp #$10, so we are in the
        ; first 25% of a beat. Throw away the computed bass note
        ; and play a drum instead.

        ; But handle the script first.

        lax     script+1,y              ; load poke byte into A+X
        ldx     script,y                ; load poke address into X
        sta     0,x                     ; poke accumulator into address from script

        lda     clock                   ; get clock
        asr     #$0e                    ; mask 00001110, then shift right
        tax                             ; A goes from 0 to 7 during the first 25% of the beat
        sbx     #256-8                  ; update the video matrix pointer
        stx     vmptr+1
        eor     #$07                    ; invert the value to obtain the pitch of the drum sound
bassdone
        sta     sid+0*7+1               ; store in voice 1 freq msb

; melody generation

        lda     clock                   ; 16th notes last for for 8 interrupts
        and     #$0f
        bne     nomel

        lda     #$b8                    ; load lfsr seed
        sre     mel_lfsr                ; shift right and exclusive or
        bcc     noc2                    ; only write it back if a bit shifted out

        sta     mel_lfsr
noc2
        and     #7                      ; use bottom 3 bits of lfsr as index into note table
        tax
        lda     freqtbl,x               ; look up note from note table
        sta     sid+1*7+1               ; store in voice 2 freq msb
nomel
        ldy     #8
vicloop
        lax     sid+3,y                 ; copy stuff from shadow buffer to vic registers $d01c-$d024
        sta     (const_d01c),y
        dey
        bpl     vicloop
        tay                             ; loop leaves $19 in accumulator; transfer to Y
loop
        lax     sid-1,y                 ; copy stuff from shadow buffer to sid registers $d400-$d418
        sta     (const_d3ff),y
        dey
        bne     loop
        jmp     $ea7e                   ; jump into to last part of standard interrupt handler

; initialization

        sei
        stx     $286                    ; set foreground text color to black
        stx     $d021                   ; set background 0 color to black
        jsr     $e544                   ; kernal clear screen routine

        ldx     #$fd                    ; copy program from $0802-$08FF to zero page ($02-$FF)
initloop
        lda     $802,x
        sta     $02,x
        dex
        bne     initloop

        stx     $315                    ; clear high byte of interrupt vector; int handler now = $31
        jmp     $cc                     ; jump to main routine in zero page

; main routine

        lda     #$50                    ; enable extended color text mode; set YSCROLL to 0
        sta     $d011
        cli                             ; enable interrupts

mainloop
        lda     $dc04                   ; get timer A low byte
;mod_op1
        ldy     #$c3                    ; forces background color 2 or 3 
;mod_op2
        ora     $d41c                   ; manipulate font using opcode set by poke table
        pha                             ; push it on the stack, where the vic is looking for font data
        asr     #$04
        ldy     #$30                    ; tell vic to find video matrix at $0c00, font at $0000.
        sty     $d018
        adc     (vmptr),y               ; read and combine two consecutive values (horizontal neighbors)
        inc     vmptr
        adc     (vmptr),y
        ror
        ora     clock_msb
        ldy     #$30+40                 ; write back 40 bytes later
        ora     mod_op1                 ; only use characters from stack page
        sta     (vmptr),y
        bne     mainloop                ; Always branches.

;basstbl
        .byte $2B,$AA,$02,$62           ; bass notes
;freqtbl
        .byte $00,$18,$26,$20           ; melody notes
        .byte $12,$24,$13,$10