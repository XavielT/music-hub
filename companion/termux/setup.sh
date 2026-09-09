#!/data/data/com.termux/files/usr/bin/bash
# One-time setup for the Music Hub companion inside Termux.
#
#   curl -sL https://raw.githubusercontent.com/XavielT/music-hub/main/companion/termux/setup.sh | bash
#
# Installs Python and yt-dlp, generates a token, writes a `musichub` command,
# and prints the address and token to paste into the app.
set -euo pipefail

BIN="$PREFIX/bin"
HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
APP_DIR="$HOME_DIR/.musichub"
TOKEN_FILE="$APP_DIR/token"
SERVER="$APP_DIR/companion.py"
RAW="https://raw.githubusercontent.com/XavielT/music-hub/main/companion/termux/companion.py"

echo "==> Installing what the companion needs"
# Output is deliberately not hidden. Hiding it once turned a dead mirror into
# a script that appeared to hang for ten minutes with nothing to look at.
# ffmpeg is not installed: YouTube serves m4a directly for almost everything,
# and it is by far the slowest package here.
pkg update -y || true
pkg install -y python

echo "==> Installing yt-dlp"
# Not `pip install --upgrade pip` — Termux refuses it outright ("Installing pip
# is forbidden, this will break the python-pip package") because pip is a
# system package there.
pip install --upgrade yt-dlp

mkdir -p "$APP_DIR"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "==> Generating a token"
  python -c "import secrets; print(secrets.token_hex(24))" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi

echo "==> Fetching the companion"
if [ -f "$(dirname "$0")/companion.py" ]; then
  cp "$(dirname "$0")/companion.py" "$SERVER"
else
  curl -sfL "$RAW" -o "$SERVER"
fi

cat > "$BIN/musichub" <<'LAUNCHER'
#!/data/data/com.termux/files/usr/bin/bash
# Starts the Music Hub companion. Ctrl-C stops it.
APP_DIR="$HOME/.musichub"
export MUSIC_HUB_TOKEN="$(cat "$APP_DIR/token")"
export PORT="${PORT:-8099}"
# Keeps the phone from suspending the process the moment the screen goes off,
# which would otherwise stop a download halfway.
termux-wake-lock 2>/dev/null || true
trap 'termux-wake-unlock 2>/dev/null || true' EXIT
exec python "$APP_DIR/companion.py"
LAUNCHER
chmod +x "$BIN/musichub"

TOKEN="$(cat "$TOKEN_FILE")"
cat <<BANNER

  ────────────────────────────────────────────────────────────
   Done. Start it any time by typing:  musichub

   Then in Music Hub → Settings → YouTube companion:

     Address   http://127.0.0.1:8099
     Token     $TOKEN

   The address and token never change, so this is a one-off.
  ────────────────────────────────────────────────────────────

  To have it start itself when the phone boots, install the Termux:Boot app
  from the same F-Droid repo as Termux, then run:

      curl -sLo b.sh https://raw.githubusercontent.com/XavielT/music-hub/main/companion/termux/enable-boot.sh
      bash b.sh

BANNER
