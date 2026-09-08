#!/usr/bin/env bash
# Two processes in one container: the POT provider yt-dlp talks to on
# 127.0.0.1:4416, and the API itself. A supervisor would be the tidy answer for
# anything bigger; for two processes where either dying should take the
# container down, this is the honest amount of machinery.
set -euo pipefail

node /opt/bgutil/build/main.js --port 4416 &
PROVIDER_PID=$!

# Give it a moment, then check it actually came up — a provider that is not
# there fails later as a bot check, which is a maddening way to find out.
for _ in $(seq 1 30); do
  if node -e "fetch('http://127.0.0.1:4416/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "POT provider up on 4416."
    break
  fi
  kill -0 "$PROVIDER_PID" 2>/dev/null || { echo "POT provider died on startup." >&2; exit 1; }
  sleep 1
done

exec python3 -m uvicorn app:app --host 0.0.0.0 --port "${PORT:-8080}"
