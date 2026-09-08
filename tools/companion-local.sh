#!/usr/bin/env bash
# Run the yt-dlp companion on this machine and expose it over HTTPS.
#
# Why this exists: the same service on Render works for everything except the
# one thing it is for. YouTube treats datacenter addresses as guilty and asks
# them to prove they are not a bot; a home connection it leaves alone. So the
# download happens here, and a Cloudflare quick tunnel gives it the HTTPS
# address the app needs (a plain http:// LAN address is blocked as mixed
# content, and no amount of settings will change that).
#
#   ./tools/companion-local.sh
#
# It prints a https://…trycloudflare.com address. Paste that into
# Settings → YouTube companion, with the token below. Ctrl-C stops both halves.
#
# The address changes every run — quick tunnels are anonymous, and the price of
# not needing a Cloudflare account is not getting to keep a name. The app's CSP
# allows any *.trycloudflare.com host so only the setting has to be updated.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-8099}"
VENV="companion/.venv"

if ! command -v cloudflared >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/cloudflared" ]; then
  echo "cloudflared is not installed. Get it with:" >&2
  echo "  curl -sL -o ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x ~/.local/bin/cloudflared" >&2
  exit 1
fi
CLOUDFLARED="$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")"

if [ ! -d "$VENV" ]; then
  echo "Setting up the Python environment (once)…"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -r companion/requirements.txt
fi

# Kept out of the repo and reused between runs, so the token pasted into the
# app stays valid rather than changing every time this starts.
TOKEN_FILE="companion/.token"
if [ ! -f "$TOKEN_FILE" ]; then
  openssl rand -hex 32 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
TOKEN="$(cat "$TOKEN_FILE")"

# `*` would be simpler and would also let any website on the internet make
# authenticated calls through a browser that has the token. It does not.
ORIGINS="https://music-hub-xaviel.vercel.app,http://localhost:4200,https://localhost"

cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting the companion on :$PORT…"
(cd companion && MUSIC_HUB_TOKEN="$TOKEN" ALLOWED_ORIGINS="$ORIGINS" \
  .venv/bin/uvicorn app:app --host 127.0.0.1 --port "$PORT" --log-level warning) &
API_PID=$!

until curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do
  kill -0 "$API_PID" 2>/dev/null || { echo "The companion failed to start." >&2; exit 1; }
  sleep 1
done
echo "  …up."

LOG="$(mktemp)"
"$CLOUDFLARED" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate > "$LOG" 2>&1 &
TUNNEL_PID=$!

echo "Waiting for the tunnel…"
URL=""
for _ in $(seq 1 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || { echo "The tunnel failed:" >&2; cat "$LOG" >&2; exit 1; }
  sleep 1
done
[ -z "$URL" ] && { echo "The tunnel never printed an address:" >&2; cat "$LOG" >&2; exit 1; }

cat <<BANNER

  ────────────────────────────────────────────────────────────
   Settings → YouTube companion

     Address   $URL
     Token     $TOKEN

   The token is the same every run; the address is not.
   Ctrl-C here stops both the service and the tunnel.
  ────────────────────────────────────────────────────────────

BANNER

wait "$API_PID"
