# Attribution

## The demo

**A Mind Is Born** — a 256-byte Commodore 64 demo.
Program, music, and concept © **Linus Åkesson**, 2017.

- Page & write-up: https://linusakesson.net/scene/a-mind-is-born/
- Original binary: https://hd0.linusakesson.net/files/a_mind_is_born.prg

`a_mind_is_born.prg` here is that exact, unmodified file (SHA-256
`7da29c8eed5acc39c5a1d3f0d40f5057c516cb6d2a04a18b15d71e6f8903f1f5`). It is included
solely to run and study the work. All rights to the demo remain with Linus Åkesson.

## The assembly

`a_mind_is_born.asm` is the source as transcribed to the
[64tass](https://sourceforge.net/projects/tass64/) assembler and commented by
**J.B. Langston**:

- https://gist.github.com/jblang/3eb7844b7a3134be243acaa57ce4dc9a

It assembles back to the original 256-byte binary, byte-for-byte. The underlying
program is Linus Åkesson's; the transcription and comments are J.B. Langston's.

## The emulator

Everything outside `reference/` — the 6502/SID/VIC-II emulator and front-end — is
original work for this project, released under the MIT License (see `../LICENSE`).
It does not incorporate code from VICE, reSID, or any other emulator.
