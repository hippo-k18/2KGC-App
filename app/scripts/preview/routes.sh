# The screens the preview scripts capture, and the Maestro flow that visits
# them (sourced by ios-shots.sh and android-shots.sh after config.sh).

# One document id from each collection the detail screens need, read from the
# preview emulator with the emulator's owner token (bypasses rules, local only).
first_id() {
  curl -s -H "Authorization: Bearer owner" \
    "http://127.0.0.1:$PREVIEW_FIRESTORE_PORT/v1/projects/$PREVIEW_PROJECT/databases/(default)/documents/$1?pageSize=1" |
    python3 -c 'import json,sys; d=json.load(sys.stdin).get("documents",[]); print(d[0]["name"].rsplit("/",1)[1] if d else "")'
}
SESSION=$(first_id sessions); SPEAKER=$(first_id speakers); SPONSOR=$(first_id sponsors)
ATTENDEE=$(first_id directory); POST=$(first_id communityPosts)

# Screen name and the link that opens it. Detail screens use the ids above.
ROUTES=(
  "home|kgc://home"
  "home-documents|kgc://home/documents"
  "home-logistics|kgc://home/logistics"
  "agenda|kgc://agenda"
  "agenda-session|kgc://agenda/$SESSION"
  "people|kgc://people"
  "people-attendee|kgc://people/$ATTENDEE"
  "people-speaker|kgc://people/speaker/$SPEAKER"
  "people-sponsor|kgc://people/sponsor/$SPONSOR"
  "community|kgc://community"
  "community-post|kgc://community/$POST"
  "community-announcements|kgc://community/announcements"
  "me|kgc://me"
  "me-badge|kgc://me/badge"
  "me-schedule|kgc://me/schedule"
  "me-profile|kgc://me/profile"
  "messages|kgc://messages"
)


# One Maestro flow that opens every route and screenshots it. The links go
# through Maestro rather than `simctl openurl` / `adb`: iOS 27 asks
# "Open in “KGC”?" before following a custom-scheme link, and Maestro answers
# it. One flow keeps it to a single Maestro start (about 10 s each).
write_route_flow() {
  local flow="$1" i=1 route screen url
  printf 'appId: %s\n---\n' "$BUNDLE_ID" > "$flow"
  for route in "${ROUTES[@]}"; do
    screen="${route%%|*}"; url="${route#*|}"
    printf -- '- openLink: "%s"\n- tapOn:\n    text: "Open"\n    optional: true\n- waitForAnimationToEnd:\n    timeout: %s\n- takeScreenshot: "%02d-%s"\n' \
      "$url" "${SETTLE_MS:-6000}" "$i" "$screen" >> "$flow"
    i=$((i + 1))
  done
}
