#!/bin/bash
# tools/mp/chromes.sh PORT... : one headless Chrome per debugging port, each with its own profile (its own cookies, so its
# own hub session) under ${MP_PROFILES:-/tmp/we-mp-profiles}, a 1280x800 window and fake media devices (voice checks).
# For tools/mp/visibility.mjs. Stop them with: pkill -f we-mp-profiles
C="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
D="${MP_PROFILES:-/tmp/we-mp-profiles}"
for p in "$@"; do
  mkdir -p "$D/$p"
  "$C" --headless=new --remote-debugging-port="$p" --user-data-dir="$D/$p" --window-size=1280,800 --no-first-run \
    --no-default-browser-check --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream \
    --use-fake-device-for-media-stream about:blank > "$D/$p.log" 2>&1 &
done
wait
