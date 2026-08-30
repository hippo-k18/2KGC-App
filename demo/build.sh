#!/bin/bash
# Compose the final MP4 from three captures, six title cards and the score.
#
# Everything is normalised to 1920x1080 / 30fps / yuv420p before anything is
# joined, because concat and xfade both require identical stream parameters and
# fail late and confusingly when they differ.
#
# The two desktop captures are sped up 50% here (SPEED) rather than driven
# faster during recording: the capture runs at 25fps, and pushing the page
# harder reintroduces scroll stutter. Caption holds are authored 1.5x long in
# the act scripts so they land back at their intended duration.
#
# The phone capture is 430x932 — portrait. It is registered into a drawn iPhone
# bezel (phone-frame.mjs) rather than pillarboxed: the frame PNG has a genuinely
# transparent screen, so the video is scaled to the glass rectangle, laid down
# first, and the bezel overlaid on top. The rectangle's coordinates are read out
# of phone-frame.json so the two files cannot drift apart.
#
# Arithmetic runs through node rather than python3 — node is already a hard
# dependency of this directory (Playwright), python3 was not.
set -euo pipefail
cd "$(dirname "$0")"

W=1920; H=1080; FPS=30; SPEED=1.5; X=0.6
mkdir -p work out

# `process.stdout.write(String(…))`, not `console.log(…)`: console.log runs a
# number through util.inspect, which wraps it in ANSI colour when FORCE_COLOR is
# set in the environment — and a colour-coded scale factor substituted into the
# next node -e is a syntax error several steps later, nowhere near the cause.
n () { node -e "process.stdout.write(String($1))"; }
dur () { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

BUY_SRC=$(ls -t raw/buy/*.webm | head -1)
APP_SRC=$(ls -t raw/app/*.webm | head -1)
DASH_SRC=$(ls -t raw/dash/*.webm | head -1)

desktop () { # desktop <src> <out>
  ffmpeg -v error -y -i "$1" \
    -vf "setpts=PTS/${SPEED},scale=${W}:${H}:flags=lanczos,fps=${FPS},format=yuv420p" \
    -an -c:v libx264 -preset medium -crf 19 "$2"
}

echo "== normalising the website capture =="
desktop "$BUY_SRC" work/buy.mp4
echo "== normalising the dashboard capture =="
desktop "$DASH_SRC" work/dash.mp4

echo "== registering the phone capture into the bezel =="
# The trailing newline is load-bearing: `read` returns 1 when it reaches EOF
# without one, and under `set -e` that ends the script with no error message at
# all — the build simply stops here and reports exit 1.
read -r SX SY SW SH PW PH < <(node -e '
  const m = require("./cards/phone-frame.json");
  process.stdout.write([m.screenX, m.screenY, m.screenW, m.screenH, m.pngW, m.pngH].join(" ") + "\n");')

# Fit the whole phone into the 1080 frame, then derive the on-canvas rectangle.
SCALE=$(n "Math.min(1000/$PH, 1)")
FW=$(n "Math.floor($PW*$SCALE/2)*2")
FH=$(n "Math.floor($PH*$SCALE/2)*2")
FX=$(n "Math.floor((${W}-$FW)/2)")
FY=$(n "Math.floor((${H}-$FH)/2)")
# The Expo web build has no safe-area inset, so its content starts at y=0 and
# the Dynamic Island lands on top of it. Inset the video by the island's height
# and leave that strip black, which is what a real iPhone shows there anyway.
INSET=$(n "Math.floor(46*$SCALE/2)*2")
GX=$(n "$FX+Math.round($SX*$SCALE)")
GY=$(n "$FY+Math.round($SY*$SCALE)")
VY=$(n "$GY+$INSET")
VW=$(n "Math.floor($SW*$SCALE/2)*2")
VH=$(n "Math.floor(($SH*$SCALE-$INSET)/2)*2")
echo "   phone ${FW}x${FH} at ${FX},${FY}; glass ${VW}x${VH} at ${GX},${VY} (inset ${INSET})"

# The phone act runs at 1.35x rather than 1.5x: its captions are shorter, and
# the app's own screen transitions are the slowest thing in the recording.
ffmpeg -v error -y -i "$APP_SRC" -i cards/phone-frame.png -filter_complex "\
  color=c=0x11151d:s=${W}x${H}:r=${FPS}[bg];\
  color=c=black:s=${VW}x${INSET}:r=${FPS}[strip];\
  [0:v]setpts=PTS/1.35,scale=${VW}:${VH}:flags=lanczos,fps=${FPS}[scr];\
  [1:v]scale=${FW}:${FH}:flags=lanczos[frm];\
  [bg][strip]overlay=${GX}:${GY}[bg2];\
  [bg2][scr]overlay=${GX}:${VY}:shortest=1[a];\
  [a][frm]overlay=${FX}:${FY}:format=auto,format=yuv420p[v]" \
  -map "[v]" -an -c:v libx264 -preset medium -crf 19 work/app.mp4

echo "== title cards =="
card () { # card <png> <seconds> <out>
  ffmpeg -v error -y -loop 1 -t "$2" -i "$1" \
    -vf "scale=${W}:${H}:flags=lanczos,fps=${FPS},format=yuv420p" \
    -c:v libx264 -preset medium -crf 19 "$3"
}
card cards/00-open.png   3.6 work/s0.mp4
card cards/06-caveat.png 6.0 work/s1.mp4
card cards/01-buy.png    2.6 work/s2.mp4
card cards/02-app.png    2.6 work/s4.mp4
card cards/03-dash.png   2.8 work/s6.mp4
card cards/04-end.png    4.6 work/s8.mp4
card cards/05-credit.png 4.2 work/s9.mp4
cp work/buy.mp4  work/s3.mp4
cp work/app.mp4  work/s5.mp4
cp work/dash.mp4 work/s7.mp4

echo "== joining with crossfades =="
SEGS=(work/s0.mp4 work/s1.mp4 work/s2.mp4 work/s3.mp4 work/s4.mp4 \
      work/s5.mp4 work/s6.mp4 work/s7.mp4 work/s8.mp4 work/s9.mp4)

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
  -movflags +faststart work/silent.mp4

echo "== scoring =="
TOTAL=$(n "Math.ceil($(dur work/silent.mp4)) + 2")
./music.sh "$TOTAL" >/dev/null

ffmpeg -v error -y -i work/silent.mp4 -i work/music.wav \
  -map 0:v -map 1:a -shortest \
  -c:v copy -c:a aac -b:a 160k \
  -movflags +faststart out/kgc-one-backend.mp4

echo "== done =="
ffprobe -v error -show_entries format=duration,size \
  -show_entries stream=codec_type,width,height,r_frame_rate \
  -of default=noprint_wrappers=1 out/kgc-one-backend.mp4
