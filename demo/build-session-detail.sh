#!/bin/bash
# Compose kgc-session-and-speaker-detail.mp4 from one capture and two cards.
#
# Same grade as build.sh — 1920x1080 / 30fps / yuv420p, the capture sped up 1.5x
# (caption holds in act4 are authored 1.5x long to land back at their intended
# duration), 0.6s crossfades, and the same synthesised piano bed. It is a
# separate script rather than a flag on build.sh because that script's whole
# body is the three-act edit: the phone bezel registration, the six title cards
# and the ten-segment join. There is nothing here for any of it to reuse.
#
# The two node/read idioms below are lifted deliberately: `process.stdout.write`
# rather than console.log, because FORCE_COLOR wraps a logged number in ANSI and
# the escape lands in a later `node -e` as a syntax error; and the trailing
# newline in the `read` heredoc, because `read` returns 1 at EOF without one and
# `set -e` then ends the script silently.
set -euo pipefail
cd "$(dirname "$0")"

W=1920; H=1080; FPS=30; SPEED=1.5; X=0.6
NAME=kgc-session-and-speaker-detail
mkdir -p work out

n () { node -e "process.stdout.write(String($1))"; }
dur () { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

SRC=$(ls -t raw/detail/*.webm | head -1)
# The capture starts a beat before the sign-in page has painted, and a white
# frame under the opening crossfade reads as a dropped shot. HEAD is the trim,
# in seconds of capture time, taken off the front.
HEAD=1.2
echo "== normalising $SRC (trimming ${HEAD}s off the front) =="
ffmpeg -v error -y -ss "$HEAD" -i "$SRC" \
  -vf "setpts=PTS/${SPEED},scale=${W}:${H}:flags=lanczos,fps=${FPS},format=yuv420p" \
  -an -c:v libx264 -preset medium -crf 19 work/detail.mp4

echo "== title cards =="
card () { # card <png> <seconds> <out>
  ffmpeg -v error -y -loop 1 -t "$2" -i "$1" \
    -vf "scale=${W}:${H}:flags=lanczos,fps=${FPS},format=yuv420p" \
    -c:v libx264 -preset medium -crf 19 "$3"
}
card cards/07-detail-open.png 4.0 work/d0.mp4
card cards/08-detail-end.png  4.6 work/d2.mp4
cp work/detail.mp4 work/d1.mp4

echo "== joining with crossfades =="
SEGS=(work/d0.mp4 work/d1.mp4 work/d2.mp4)

# xfade's `offset` is measured on the growing output, so each one is the running
# total of everything before it minus the transitions already consumed.
inputs=(); filter=""; running=""; prev="[0:v]"
for i in "${!SEGS[@]}"; do
  inputs+=(-i "${SEGS[$i]}")
  [ "$i" -eq 0 ] && { running=$(dur "${SEGS[0]}"); continue; }
  off=$(n "($running - $X).toFixed(3)")
  out="[x$i]"
  [ "$i" -eq $((${#SEGS[@]} - 1)) ] && out="[v]"
  filter+="${prev}[${i}:v]xfade=transition=fade:duration=$X:offset=$off$out;"
  running=$(n "($running + $(dur "${SEGS[$i]}") - $X).toFixed(3)")
  prev="$out"
done

ffmpeg -v error -y "${inputs[@]}" -filter_complex "${filter%;}" \
  -map "[v]" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
  -movflags +faststart work/detail-silent.mp4

echo "== scoring =="
TOTAL=$(n "Math.ceil($(dur work/detail-silent.mp4)) + 2")
./music.sh "$TOTAL" >/dev/null

ffmpeg -v error -y -i work/detail-silent.mp4 -i work/music.wav \
  -map 0:v -map 1:a -shortest \
  -c:v copy -c:a aac -b:a 160k \
  -movflags +faststart "out/${NAME}.mp4"

echo "== done =="
ffprobe -v error -show_entries format=duration,size \
  -show_entries stream=codec_type,width,height,r_frame_rate \
  -of default=noprint_wrappers=1 "out/${NAME}.mp4"
