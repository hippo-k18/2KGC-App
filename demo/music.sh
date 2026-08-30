#!/bin/bash
# Synthesise the backing track: simple solo piano.
#
# No licensed library here, and a borrowed track is a licence problem waiting to
# surface, so the music is generated. A piano note is a short attack and a long
# exponential decay over a handful of harmonics — that is enough to read as a
# piano rather than as a sine tone, which is what the previous pad sounded like.
#
# C – G – Am – F at 108bpm, eighth notes, four bars, looped. Major key and
# roughly twice the tempo of the first pass, which was Am at 66 and read as
# wistful rather than as demo music.
set -euo pipefail
cd "$(dirname "$0")"

DUR=${1:-260}
BEAT=0.278                  # 108bpm, eighth notes
mkdir -p work/notes

# A struck note: fundamental plus four harmonics at falling amplitude, each
# shaped by the same exponential decay. `sin(2*PI*f*t)` is written out per
# partial because aevalsrc has no loop construct.
note () { # note <freq> <seconds> <out>
  local f=$1 d=$2 out=$3
  ffmpeg -v error -y -f lavfi \
    -i "aevalsrc=\
0.50*sin(2*PI*${f}*t)*exp(-2.6*t)\
+0.26*sin(2*PI*${f}*2*t)*exp(-3.6*t)\
+0.13*sin(2*PI*${f}*3*t)*exp(-4.6*t)\
+0.07*sin(2*PI*${f}*4*t)*exp(-5.8*t)\
+0.04*sin(2*PI*${f}*5*t)*exp(-7.0*t)\
:s=44100:d=${d}" \
    -af "afade=t=in:st=0:d=0.006,volume=0.5" -c:a pcm_s16le "$out"
}

# One bar = four notes. Chord tones only, so any ordering stays consonant.
# Eight eighth-notes a bar, rising then falling, an octave up from the first
# pass so it sits above the visuals rather than under them.
#  C : C4 261.63 E4 329.63 G4 392   C5 523.25
#  G : B3 246.94 D4 293.66 G4 392   B4 493.88
#  Am: A3 220    C4 261.63 E4 329.63 A4 440
#  F : F3 174.61 A3 220    C4 261.63 F4 349.23
BAR_A="261.63 329.63 392 523.25 392 329.63 392 523.25"
BAR_F="246.94 293.66 392 493.88 392 293.66 392 493.88"
BAR_C="220 261.63 329.63 440 329.63 261.63 329.63 440"
BAR_G="174.61 220 261.63 349.23 261.63 220 261.63 349.23"

# Notes ring for two beats and overlap, which is what makes it sound played
# rather than sequenced.
# Shorter ring at this tempo, or the notes smear into a chord.
RING=$(python3 -c "print($BEAT*3.2)")

idx=0
inputs=()
delays=()
for bar in "$BAR_A" "$BAR_F" "$BAR_C" "$BAR_G"; do
  beat=0
  for f in $bar; do
    note "$f" "$RING" "work/notes/n${idx}.wav"
    ms=$(python3 -c "print(int(($idx)*$BEAT*1000))")
    inputs+=(-i "work/notes/n${idx}.wav")
    delays+=("[${idx}:a]adelay=${ms}|${ms}[d${idx}];")
    idx=$((idx+1))
    beat=$((beat+1))
  done
done

# Lay every note on one timeline at its own offset.
mix=""
for ((i=0;i<idx;i++)); do mix="${mix}[d${i}]"; done
ffmpeg -v error -y "${inputs[@]}" \
  -filter_complex "$(printf '%s' "${delays[@]}")${mix}amix=inputs=${idx}:normalize=0[o]" \
  -map "[o]" -c:a pcm_s16le work/loop.wav

LOOP=$(python3 -c "print($BEAT*32)")
REPS=$(python3 -c "print(int($DUR/$LOOP)+2)")

# A little room, then normalise to -23 LUFS: a background bed, audible but well
# under speech level. An earlier pass set a raw gain and landed at -47 dB, which
# is inaudible on a laptop.
ffmpeg -v error -y -stream_loop "$REPS" -i work/loop.wav -t "$DUR" \
  -af "aecho=0.85:0.62:190|370:0.18|0.11,lowpass=f=6800,loudnorm=I=-23:TP=-2:LRA=9,afade=t=in:st=0:d=2.5,afade=t=out:st=$(python3 -c "print($DUR-5)"):d=5" \
  -ac 2 -c:a pcm_s16le work/music.wav

echo "music: $(ffprobe -v error -show_entries format=duration -of csv=p=0 work/music.wav)s"
